/**
 * 球体可视化 — Canvas 2D
 * 根据状态和音量脉动的动态球体
 */

const COLORS = {
  idle:       { main: [59, 130, 246],  glow: "rgba(59,130,246,0.3)"  },
  listening:  { main: [34, 197, 94],   glow: "rgba(34,197,94,0.4)"   },
  processing: { main: [245, 158, 11],  glow: "rgba(245,158,11,0.3)"  },
  speaking:   { main: [168, 85, 247],  glow: "rgba(168,85,247,0.4)"  },
};

const BASE_RADIUS = 80;
const MAX_OFFSET = 25;
const BREATH_AMPLITUDE = 3;
const LERP_SPEED = 0.15;

export class OrbVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx2d = canvas.getContext("2d");
    this._state = "idle";
    this._analyser = null;
    this._analyserData = null;
    this._currentRadius = BASE_RADIUS;
    this._targetRadius = BASE_RADIUS;
    this._currentColor = [...COLORS.idle.main];
    this._targetColor = [...COLORS.idle.main];
    this._rafId = null;
    this._startTime = performance.now();
    this._running = false;
  }

  /**
   * @param {"idle"|"listening"|"processing"|"speaking"} state
   */
  setState(state) {
    this._state = state;
    const colorDef = COLORS[state] || COLORS.idle;
    this._targetColor = [...colorDef.main];
  }

  /**
   * @param {AnalyserNode|null} analyser
   */
  setAnalyser(analyser) {
    this._analyser = analyser;
    if (analyser) {
      this._analyserData = new Uint8Array(analyser.frequencyBinCount);
    } else {
      this._analyserData = null;
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now();
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._tick());
    this._render();
  }

  _render() {
    const ctx = this._ctx2d;
    const w = this._canvas.width;
    const h = this._canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const now = performance.now();

    // 计算音量 (0~1)
    let volume = 0;
    if (this._analyser && this._analyserData) {
      this._analyser.getByteFrequencyData(this._analyserData);
      let sum = 0;
      for (let i = 0; i < this._analyserData.length; i++) {
        sum += this._analyserData[i];
      }
      volume = sum / (this._analyserData.length * 255);
    }

    // 目标半径
    if (this._state === "idle") {
      const breathOffset = Math.sin((now - this._startTime) * 0.002) * BREATH_AMPLITUDE;
      this._targetRadius = BASE_RADIUS + breathOffset;
    } else if (this._state === "listening" && !this._analyser) {
      // browser STT 无真实 analyser，模拟脉冲
      const pulse = Math.sin((now - this._startTime) * 0.006) * 0.5 + 0.5;
      this._targetRadius = BASE_RADIUS + pulse * MAX_OFFSET * 0.6;
    } else if (this._state === "processing") {
      // 等待中缓慢脉动
      const pulse = Math.sin((now - this._startTime) * 0.003) * 0.3 + 0.7;
      this._targetRadius = BASE_RADIUS + pulse * MAX_OFFSET * 0.3;
    } else {
      this._targetRadius = BASE_RADIUS + volume * MAX_OFFSET;
    }

    // Lerp 半径
    this._currentRadius += (this._targetRadius - this._currentRadius) * LERP_SPEED;

    // Lerp 颜色
    for (let i = 0; i < 3; i++) {
      this._currentColor[i] += (this._targetColor[i] - this._currentColor[i]) * LERP_SPEED;
    }

    const r = Math.round(this._currentColor[0]);
    const g = Math.round(this._currentColor[1]);
    const b = Math.round(this._currentColor[2]);

    // 清除
    ctx.clearRect(0, 0, w, h);

    // 外发光
    ctx.save();
    ctx.shadowColor = `rgba(${r},${g},${b},0.4)`;
    ctx.shadowBlur = 40 + volume * 30;

    // 径向渐变
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, this._currentRadius);
    gradient.addColorStop(0, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},1)`);
    gradient.addColorStop(0.7, `rgba(${r},${g},${b},0.9)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0.3)`);

    ctx.beginPath();
    ctx.arc(cx, cy, this._currentRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }
}
