/**
 * STT 管理器 — 语音识别
 * 支持 browser (Web Speech API) 和 api (录音上传 Whisper) 两种模式
 *
 * 事件:
 *   "interim"  → detail: { text }   实时中间结果
 *   "final"    → detail: { text }   最终识别结果
 *   "error"    → detail: { error }  错误
 *   "end"      → 识别/录音结束
 */

import { apiFetch } from "../api.js";

export class SttManager extends EventTarget {
  /**
   * @param {"browser"|"api"|"local"} provider
   * @param {import("./audio-session.js").AudioSession} audioSession
   */
  constructor(provider, audioSession) {
    super();
    this._provider = provider;
    this._audioSession = audioSession;
    this._recognition = null;
    this._mediaRecorder = null;
    this._chunks = [];
    this._stream = null;
    this._micSource = null;
    this._vadInterval = null;
    this._active = false;
  }

  static isWebSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /** 获取麦克风 AnalyserNode（仅 API 模式有真实音量数据） */
  get micAnalyser() {
    return this._provider !== "browser" ? this._audioSession.micAnalyser : null;
  }

  async start() {
    if (this._active) return;
    this._active = true;
    if (this._provider === "browser") {
      this._startBrowser();
    } else {
      await this._startApi();
    }
  }

  stop() {
    if (!this._active) return;
    if (this._provider === "browser" && this._recognition) {
      this._recognition.stop();
    } else if (this._mediaRecorder?.state === "recording") {
      this._mediaRecorder.stop();
    }
  }

  abort() {
    if (this._provider === "browser" && this._recognition) {
      this._recognition.abort();
    }
    this._cleanup();
    this._active = false;
  }

  // ---- Browser (Web Speech API) ----

  _startBrowser() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SR();
    this._recognition.continuous = false;
    this._recognition.interimResults = true;
    // 默认中文，但 maxAlternatives 提高混合语言识别容错
    const htmlLang = document.documentElement.lang;
    this._recognition.lang = htmlLang === "en" ? "en-US" : "zh-CN";
    this._recognition.maxAlternatives = 3;

    this._recognition.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (finalText) {
        this.dispatchEvent(new CustomEvent("final", { detail: { text: finalText } }));
      } else if (interimText) {
        this.dispatchEvent(new CustomEvent("interim", { detail: { text: interimText } }));
      }
    };

    this._recognition.onerror = (e) => {
      if (e.error === "aborted") return;
      if (e.error === "no-speech") {
        this._cleanup();
        this._active = false;
        this.dispatchEvent(new Event("end"));
        return;
      }
      this.dispatchEvent(new CustomEvent("error", {
        detail: { error: e.error || "speech-recognition-error" },
      }));
    };

    this._recognition.onend = () => {
      this._cleanup();
      this._active = false;
      this.dispatchEvent(new Event("end"));
    };

    this._recognition.start();
  }

  // ---- API (录音 → Whisper) ----

  async _startApi() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this._active = false;
      this.dispatchEvent(new CustomEvent("error", {
        detail: { error: "mic-permission-denied" },
      }));
      return;
    }

    // MIME 兼容性探测
    const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const supportedMime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m));
    if (!supportedMime) {
      this._cleanup();
      this._active = false;
      this.dispatchEvent(new CustomEvent("error", {
        detail: { error: "no-compatible-audio-format" },
      }));
      return;
    }

    this._mediaRecorder = new MediaRecorder(this._stream, { mimeType: supportedMime });
    this._chunks = [];
    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._mediaRecorder.onstop = () => this._uploadAndTranscribe();
    this._mediaRecorder.start();

    // 接入 AudioSession 的麦克风分析（VAD + 可视化）
    const analyser = this._audioSession.attachMic(this._stream);
    this._setupVad(analyser);
  }

  _setupVad(analyser) {
    const data = new Float32Array(analyser.fftSize);
    const SPEECH_THRESHOLD = 0.02;
    const SILENCE_THRESHOLD = 0.01;
    const SILENCE_MS = 800;
    const MIN_SPEECH_MS = 300;
    let silentSince = null;
    let speechDetected = false;
    let speechStart = 0;

    this._vadInterval = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);

      if (rms >= SPEECH_THRESHOLD) {
        silentSince = null;
        if (!speechDetected) {
          speechDetected = true;
          speechStart = Date.now();
        }
      } else if (rms < SILENCE_THRESHOLD && speechDetected) {
        if (!silentSince) {
          silentSince = Date.now();
        } else if (
          Date.now() - silentSince > SILENCE_MS &&
          Date.now() - speechStart > MIN_SPEECH_MS
        ) {
          this.stop(); // 自动停止录音 → 触发上传
        }
      }
    }, 50);
  }

  async _uploadAndTranscribe() {
    const mimeType = this._mediaRecorder?.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(this._chunks, { type: mimeType });
    this._cleanup();

    try {
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      if (this._provider === "local") form.append("provider", "local");
      const resp = await apiFetch("/api/voice/stt", { method: "POST", body: form });
      if (!resp.ok) throw new Error(`STT failed: ${resp.status}`);
      const { text } = await resp.json();
      if (text && text.trim()) {
        this.dispatchEvent(new CustomEvent("final", { detail: { text: text.trim() } }));
      }
    } catch (err) {
      this.dispatchEvent(new CustomEvent("error", { detail: { error: err.message } }));
    } finally {
      this._active = false;
      this.dispatchEvent(new Event("end"));
    }
  }

  _cleanup() {
    clearInterval(this._vadInterval);
    this._vadInterval = null;
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null;
    this._audioSession.detachMic();
    if (this._recognition) {
      this._recognition.onresult = null;
      this._recognition.onerror = null;
      this._recognition.onend = null;
      this._recognition = null;
    }
    this._mediaRecorder = null;
    this._chunks = [];
  }
}
