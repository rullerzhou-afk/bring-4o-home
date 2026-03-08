/**
 * AudioContext 统一管理
 * STT VAD、TTS 播放、球体可视化 均通过此模块获取 AnalyserNode
 */

export class AudioSession {
  constructor() {
    this._ctx = null;
    this._micSource = null;
    this._micAnalyser = null;
    this._playAnalyser = null;
    this._unlocked = false;
  }

  /** 获取或创建 AudioContext */
  get ctx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  /** 解锁 AudioContext（必须在用户手势内调用） */
  async unlock() {
    const ctx = this.ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (!this._unlocked) {
      // iOS Safari 需要在用户手势内播放空音频来真正解锁
      const empty = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = empty;
      src.connect(ctx.destination);
      src.start();
      this._unlocked = true;
    }
  }

  /**
   * 接入麦克风流 → 创建 AnalyserNode（用于 VAD + 球体可视化）
   * @param {MediaStream} stream
   * @returns {AnalyserNode}
   */
  attachMic(stream) {
    this.detachMic();
    const ctx = this.ctx;
    this._micSource = ctx.createMediaStreamSource(stream);
    this._micAnalyser = ctx.createAnalyser();
    this._micAnalyser.fftSize = 512;
    this._micSource.connect(this._micAnalyser);
    return this._micAnalyser;
  }

  /** 获取当前麦克风 AnalyserNode（未接入时返回 null） */
  get micAnalyser() { return this._micAnalyser; }

  /** 断开麦克风 */
  detachMic() {
    this._micSource?.disconnect();
    this._micAnalyser?.disconnect();
    this._micSource = null;
    this._micAnalyser = null;
  }

  /**
   * 创建播放分析链：AnalyserNode → destination
   * TTS 播放时 BufferSource 连接到返回的 analyser
   * @returns {AnalyserNode}
   */
  getPlaybackAnalyser() {
    if (!this._playAnalyser) {
      const ctx = this.ctx;
      this._playAnalyser = ctx.createAnalyser();
      this._playAnalyser.fftSize = 256;
      this._playAnalyser.connect(ctx.destination);
    }
    return this._playAnalyser;
  }

  /**
   * 播放本地音频 buffer（如 filler sound）
   * @param {AudioBuffer} audioBuffer
   */
  playBuffer(audioBuffer) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();
    return source;
  }

  /**
   * 加载音频文件为 AudioBuffer
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async loadAudio(url) {
    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  /** 销毁所有资源 */
  destroy() {
    this.detachMic();
    this._playAnalyser?.disconnect();
    this._playAnalyser = null;
    if (this._ctx && this._ctx.state !== "closed") {
      this._ctx.close().catch(() => {});
    }
    this._ctx = null;
    this._unlocked = false;
  }
}
