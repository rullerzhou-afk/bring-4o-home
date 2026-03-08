/**
 * TTS 播放器 — 文本排队合成 + 播放
 *
 * 事件:
 *   "start"    → 开始播放第一段
 *   "end"      → 全部播放完毕
 *   "sentence" → detail: { text } 当前播放的句子
 */

import { apiFetch } from "../api.js";

export class TtsPlayer extends EventTarget {
  /**
   * @param {import("./audio-session.js").AudioSession} audioSession
   */
  constructor(audioSession) {
    super();
    this._audioSession = audioSession;
    this._analyser = audioSession.getPlaybackAnalyser();
    this._queue = [];
    this._pendingFetches = [];
    this._playing = false;
    this._playbackGen = 0;
    this._currentSource = null;
    this._started = false;
  }

  /** 暴露给球体可视化的 AnalyserNode */
  get analyserNode() { return this._analyser; }

  get playing() { return this._playing; }

  /**
   * 合成并排队播放一句文本
   * @param {string} text
   * @param {{provider: string, voice: string, speed: number}} options
   */
  async enqueue(text, options = {}) {
    const abort = new AbortController();
    this._pendingFetches.push(abort);
    const gen = this._playbackGen; // 记录当前 gen，stop() 会递增使其失效

    try {
      const resp = await apiFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          provider: options.provider || "edge",
          voice: options.voice || "",
          speed: options.speed || 1.0,
        }),
        signal: abort.signal,
      });

      if (!resp.ok) throw new Error(`TTS failed: ${resp.status}`);
      if (gen !== this._playbackGen) return; // 已被 stop()

      const arrayBuffer = await resp.arrayBuffer();
      if (gen !== this._playbackGen) return;

      const audioBuffer = await this._audioSession.ctx.decodeAudioData(arrayBuffer);
      if (gen !== this._playbackGen) return;

      this._queue.push({ text, audioBuffer });
      if (!this._playing) this._playNext();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn(`[TTS] sentence failed, skipping: "${text.slice(0, 20)}..."`, err);
      if (!this._playing && this._queue.length === 0) {
        this.dispatchEvent(new Event("end"));
      }
    } finally {
      const idx = this._pendingFetches.indexOf(abort);
      if (idx >= 0) this._pendingFetches.splice(idx, 1);
    }
  }

  _playNext() {
    if (this._queue.length === 0) {
      this._playing = false;
      this._currentSource = null;
      this._started = false;
      this.dispatchEvent(new Event("end"));
      return;
    }

    this._playing = true;
    const gen = this._playbackGen;
    const { text, audioBuffer } = this._queue.shift();

    const source = this._audioSession.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this._analyser);
    source.onended = () => {
      if (gen === this._playbackGen) this._playNext();
    };
    this._currentSource = source;
    source.start();

    if (!this._started) {
      this._started = true;
      this.dispatchEvent(new Event("start"));
    }
    this.dispatchEvent(new CustomEvent("sentence", { detail: { text } }));
  }

  /** 停止播放，清空队列，取消进行中的 TTS 请求 */
  stop() {
    this._playbackGen++;
    try { this._currentSource?.stop(); } catch (e) { /* already stopped */ }
    this._currentSource = null;
    this._queue = [];
    this._pendingFetches.forEach(c => c.abort());
    this._pendingFetches = [];
    this._playing = false;
    this._started = false;
  }

  destroy() {
    this.stop();
  }
}
