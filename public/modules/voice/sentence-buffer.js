/**
 * 分句器 — 从 voice/sentence_buffer.py 移植
 * 将流式文本切成适合 TTS 的句子
 */

const HARD_BREAKS = new Set(["。", "！", "？", "；", "\n"]);
const EN_BREAKS = new Set([".", "!", "?"]);
const SOFT_BREAKS = new Set(["，", "、", ","]);
const SOFT_THRESHOLD = 40;
const FORCE_THRESHOLD = 80;

export class SentenceBuffer {
  constructor() {
    this._buf = "";
  }

  /**
   * 添加文本 token，返回完成的句子数组
   * @param {string} token
   * @returns {string[]}
   */
  add(token) {
    this._buf += token;
    const sentences = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = this._findBreak();
      if (idx < 0) break;
      const sentence = this._buf.slice(0, idx + 1).trim();
      this._buf = this._buf.slice(idx + 1);
      if (sentence) sentences.push(sentence);
    }

    // 强制截断过长的缓冲
    if (this._buf.length >= FORCE_THRESHOLD) {
      const sentence = this._buf.trim();
      this._buf = "";
      if (sentence) sentences.push(sentence);
    }

    return sentences;
  }

  /**
   * 冲刷缓冲区中的剩余文本
   * @returns {string|null}
   */
  flush() {
    const text = this._buf.trim();
    this._buf = "";
    return text || null;
  }

  _findBreak() {
    for (let i = 0; i < this._buf.length; i++) {
      const ch = this._buf[i];
      if (HARD_BREAKS.has(ch)) return i;
      if (EN_BREAKS.has(ch)) {
        // 英文句号后面必须是空格或结尾才算断句（避免缩写、小数）
        const next = this._buf[i + 1];
        if (!next || next === " " || next === "\n") return i;
      }
      if (SOFT_BREAKS.has(ch) && i >= SOFT_THRESHOLD) return i;
    }
    return -1;
  }
}
