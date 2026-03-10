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
    this._ready = new Map();   // seq → { text, audioBuffer }
    this._nextEnqueue = 0;     // 下一个入队序号
    this._nextPlay = 0;        // 下一个应该播放的序号
    this._pendingFetches = [];
    this._playing = false;
    this._playbackGen = 0;
    this._currentSource = null;
    this._started = false;
    this._sealed = false;  // true = 不会再有新句子入队
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
    const seq = this._nextEnqueue++;
    const abort = new AbortController();
    this._pendingFetches.push(abort);
    const gen = this._playbackGen;

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
      if (gen !== this._playbackGen) return;

      const arrayBuffer = await resp.arrayBuffer();
      if (gen !== this._playbackGen) return;

      const audioBuffer = await this._audioSession.ctx.decodeAudioData(arrayBuffer);
      if (gen !== this._playbackGen) return;

      // 按序号存入 ready map，不直接 push queue
      this._ready.set(seq, { text, audioBuffer });
      this._tryPlayNext();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn(`[TTS] sentence failed, skipping: "${text.slice(0, 20)}..."`, err);
      // 跳过失败的句子，推进序号
      if (gen === this._playbackGen) {
        this._ready.set(seq, null); // 标记为跳过
        this._tryPlayNext();
      }
    } finally {
      const idx = this._pendingFetches.indexOf(abort);
      if (idx >= 0) {
        this._pendingFetches.splice(idx, 1);
        // Re-check completion: catch may have called _tryPlayNext before
        // this fetch was removed, so the end-event condition was missed.
        if (gen === this._playbackGen && !this._playing) this._tryPlayNext();
      }
    }
  }

  _tryPlayNext() {
    if (this._playing) return;
    // 按序号顺序消费
    while (this._ready.has(this._nextPlay)) {
      const item = this._ready.get(this._nextPlay);
      this._ready.delete(this._nextPlay);
      this._nextPlay++;
      if (item) {
        // 有效音频，播放它
        this._playItem(item);
        return;
      }
      // null = 跳过的句子，继续检查下一个
    }
    // 没有连续就绪的了；只有在 seal() 被调用后才判断全部完成
    if (this._sealed && this._pendingFetches.length === 0 && this._ready.size === 0 && this._started) {
      this._playing = false;
      this._currentSource = null;
      this._started = false;
      this.dispatchEvent(new Event("end"));
    }
  }

  _playItem({ text, audioBuffer }) {
    this._playing = true;
    const gen = this._playbackGen;

    const source = this._audioSession.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this._analyser);
    source.onended = () => {
      if (gen !== this._playbackGen) return;
      this._playing = false;
      this._currentSource = null;
      this._tryPlayNext();
    };
    this._currentSource = source;
    source.start();

    if (!this._started) {
      this._started = true;
      this.dispatchEvent(new Event("start"));
    }
    this.dispatchEvent(new CustomEvent("sentence", { detail: { text } }));
  }

  /** 标记不会再有新句子入队，当前队列播完后触发 end */
  seal() {
    this._sealed = true;
    if (!this._playing) this._tryPlayNext();
  }

  /** 停止播放，清空队列，取消进行中的 TTS 请求 */
  stop() {
    this._playbackGen++;
    try { this._currentSource?.stop(); } catch (e) { /* already stopped */ }
    this._currentSource = null;
    this._ready.clear();
    this._nextEnqueue = 0;
    this._nextPlay = 0;
    this._pendingFetches.forEach(c => c.abort());
    this._pendingFetches = [];
    const wasActive = this._playing || this._started;
    this._playing = false;
    this._started = false;
    this._sealed = false;
    // 通知调用方播放已终止，让 once: true 的 end 监听器能正常触发
    if (wasActive) {
      this.dispatchEvent(new Event("end"));
    }
  }

  destroy() {
    this.stop();
  }
}
