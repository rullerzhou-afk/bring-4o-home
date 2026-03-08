/**
 * 语音对话控制器 — 状态机 + 流程编排
 *
 * 状态: IDLE → STARTING → LISTENING → PROCESSING → SPEAKING → IDLE
 * 打断: 任何状态 → STOPPING → STARTING → LISTENING
 */

import { apiFetch, escapeHtml } from "../api.js";
import { t } from "../i18n.js";
import { parseSseStream } from "../sse-reader.js";
import { AudioSession } from "./audio-session.js";
import { SttManager } from "./stt-manager.js";
import { TtsPlayer } from "./tts-player.js";
import { SentenceBuffer } from "./sentence-buffer.js";
import { OrbVisualizer } from "./orb-visualizer.js";

const STATES = ["idle", "starting", "listening", "processing", "speaking", "stopping"];

const VOICE_SYSTEM_MSG = {
  role: "system",
  content:
    "你正在语音对话中，请用口语化、简短、像真人说话的纯文本回复。" +
    "禁止使用任何 Markdown 格式（加粗、斜体、列表、代码块、标题等）。" +
    "不要输出代码。回复尽量简洁。",
};

export class VoiceController {
  constructor() {
    this._state = "idle";
    this._sessionId = 0;
    this._audioSession = new AudioSession();
    this._sttManager = null;
    this._ttsPlayer = null;
    this._orb = null;
    this._config = {};
    this._voiceConfig = {};
    this._conversationId = null;
    this._messages = [];
    this._abortController = null;
    this._fillerBuffer = null;
    this._initialized = false;

    // DOM
    this._micBtn = null;
    this._statusEl = null;
    this._userTextEl = null;
    this._aiTextEl = null;
    this._modelBadge = null;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // DOM 元素
    this._micBtn = document.getElementById("voice-mic-btn");
    this._statusEl = document.getElementById("voice-status");
    this._userTextEl = document.getElementById("voice-user-text");
    this._aiTextEl = document.getElementById("voice-ai-text");
    this._modelBadge = document.getElementById("voice-model-badge");
    const canvas = document.getElementById("voice-orb");

    // 球体可视化
    this._orb = new OrbVisualizer(canvas);
    this._orb.start();

    // 并行加载配置和恢复对话
    const savedConvId = sessionStorage.getItem("voice_conv_id");
    const [configResult, convResult] = await Promise.allSettled([
      apiFetch("/api/config").then(r => r.ok ? r.json() : null),
      savedConvId
        ? apiFetch(`/api/conversations/${savedConvId}`).then(r => r.ok ? r.json() : null)
        : Promise.resolve(null),
    ]);

    if (configResult.status === "fulfilled" && configResult.value) {
      this._config = configResult.value;
      this._voiceConfig = this._config.voice || {};
    } else if (configResult.status === "rejected") {
      console.warn("[voice] Failed to load config:", configResult.reason);
    }

    // 显示模型名
    this._modelBadge.textContent = this._config.model || "gpt-4o";

    if (savedConvId && convResult.status === "fulfilled" && convResult.value) {
      this._conversationId = savedConvId;
      this._messages = convResult.value.messages || [];
    } else if (savedConvId && convResult.status === "rejected") {
      console.warn("[voice] Failed to load conversation:", convResult.reason);
    }

    if (!this._conversationId) {
      await this._createConversation();
    }

    // 绑定事件
    this._micBtn.addEventListener("click", () => this._onMicClick());

    // 设置按钮 → 回主页设置
    const settingsBtn = document.getElementById("voice-settings-btn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        window.location.href = "/#settings";
      });
    }

    // 返回按钮 → 带对话 ID 回主页
    const backBtn = document.getElementById("voice-back");
    if (backBtn) {
      backBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = this._conversationId ? `/#${this._conversationId}` : "/";
      });
    }

    // 预加载 filler sound（静默失败）
    this._loadFiller();
  }

  async _createConversation() {
    const now = new Date();
    const title = `${t("voice_title")} ${now.toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })}`;
    const id = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");

    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title, messages: [] }),
      });
      if (res.ok) {
        this._conversationId = id;
        sessionStorage.setItem("voice_conv_id", id);
      }
    } catch (err) {
      console.error("[voice] Failed to create conversation:", err);
    }
  }

  async _loadFiller() {
    try {
      // 生成一个短促的提示音（440Hz, 150ms）
      const ctx = this._audioSession.ctx;
      const sr = ctx.sampleRate;
      const duration = 0.15;
      const len = Math.floor(sr * duration);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // 440Hz 正弦波 + 指数衰减
        data[i] = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 20) * 0.3;
      }
      this._fillerBuffer = buf;
    } catch (err) {
      console.warn("[voice] Failed to generate filler sound:", err);
    }
  }

  // ---- 状态管理 ----

  _setState(newState) {
    this._state = newState;

    // 更新 UI
    const btn = this._micBtn;
    btn.classList.remove("listening", "processing", "speaking");
    btn.disabled = newState === "starting" || newState === "stopping";

    if (newState === "listening") btn.classList.add("listening");
    else if (newState === "processing") btn.classList.add("processing");
    else if (newState === "speaking") btn.classList.add("speaking");

    // 状态文字
    const statusKey = {
      idle: "voice_status_idle",
      starting: "voice_status_listening",
      listening: "voice_status_listening",
      processing: "voice_status_processing",
      speaking: "voice_status_speaking",
      stopping: "voice_status_processing",
    };
    this._statusEl.textContent = t(statusKey[newState] || "voice_status_idle");

    // 球体状态
    const orbState = (newState === "starting" || newState === "stopping") ? "processing" : newState;
    this._orb.setState(orbState);
  }

  // ---- 麦克风按钮 ----

  async _onMicClick() {
    // 过渡态：忽略重复点击
    if (this._state === "starting" || this._state === "stopping") return;

    // 打断 AI（processing/speaking 时）
    if (this._state === "processing" || this._state === "speaking") {
      await this._bargeIn();
      return;
    }

    // 手动结束录音
    if (this._state === "listening") {
      this._sttManager?.stop();
      return;
    }

    // 从 IDLE 开始
    await this._startSession();
  }

  async _bargeIn() {
    this._setState("stopping");
    const sessionId = this._sessionId;

    // 停止 TTS 和 SSE
    this._ttsPlayer?.stop();
    this._abortController?.abort();

    // 保存 partial response
    await this._saveMessages();

    if (sessionId !== this._sessionId) return; // 被更新的 session 覆盖

    // 重新开始录音
    await this._startSession();
  }

  async _startSession() {
    this._setState("starting");
    this._sessionId++;
    const sessionId = this._sessionId;

    // 确保 AudioContext 解锁
    await this._audioSession.unlock();
    if (sessionId !== this._sessionId) return;

    // 确定 STT provider
    let provider = this._voiceConfig.stt_provider || "browser";
    if (provider === "browser" && !SttManager.isWebSpeechSupported()) {
      provider = "api";
    }

    // 创建 STT Manager
    this._sttManager = new SttManager(provider, this._audioSession);

    this._sttManager.addEventListener("interim", (e) => {
      if (sessionId !== this._sessionId) return;
      this._showUserText(e.detail.text, true);
    });

    this._sttManager.addEventListener("final", (e) => {
      if (sessionId !== this._sessionId) return;
      this._onSttFinal(e.detail.text, sessionId);
    });

    this._sttManager.addEventListener("error", (e) => {
      if (sessionId !== this._sessionId) return;
      console.warn("[voice] STT error:", e.detail.error);
      if (e.detail.error === "mic-permission-denied") {
        this._showError(t("voice_err_no_mic"));
      } else if (e.detail.error === "not-allowed") {
        this._showError(t("voice_err_no_mic"));
      }
      this._setState("idle");
    });

    this._sttManager.addEventListener("end", () => {
      if (sessionId !== this._sessionId) return;
      // 如果在 listening 状态结束，说明用户没说话或 browser STT 自然结束
      if (this._state === "listening") {
        this._setState("idle");
      }
    });

    this._sttManager.start();
    this._setState("listening");

    // 设置球体可视化
    if (provider === "api") {
      // API 模式：有真实麦克风 analyser
      const micAnalyser = this._audioSession.micAnalyser;
      if (micAnalyser) this._orb.setAnalyser(micAnalyser);
    }
    // browser 模式：orb 用模拟脉冲（已在 OrbVisualizer 内部处理）
  }

  async _onSttFinal(text, sessionId) {
    if (!text.trim()) {
      this._setState("idle");
      return;
    }

    this._showUserText(text, false);
    this._setState("processing");
    this._orb.setAnalyser(null);

    // 播放 filler sound
    if (this._fillerBuffer) {
      this._audioSession.playBuffer(this._fillerBuffer);
    }

    // 追加 user message
    this._messages.push({ role: "user", content: text });

    // 创建 TTS Player
    if (!this._ttsPlayer) {
      this._ttsPlayer = new TtsPlayer(this._audioSession);
    }

    this._ttsPlayer.addEventListener("start", () => {
      if (sessionId !== this._sessionId) return;
      this._setState("speaking");
      this._orb.setAnalyser(this._ttsPlayer.analyserNode);
    }, { once: true });

    this._ttsPlayer.addEventListener("end", () => {
      if (sessionId !== this._sessionId) return;
      this._orb.setAnalyser(null);
      this._saveMessages();
      this._setState("idle");
    }, { once: true });

    // 发起 SSE Chat
    await this._streamChat(sessionId);
  }

  async _streamChat(sessionId) {
    this._abortController = new AbortController();
    const sentenceBuffer = new SentenceBuffer();
    const aiParts = [];

    const messagesWithVoice = [VOICE_SYSTEM_MSG, ...this._messages];

    let resp;
    try {
      resp = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this._config.model,
          conversationId: this._conversationId,
          messages: messagesWithVoice,
        }),
        signal: this._abortController.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      this._showError(err.message);
      this._setState("idle");
      return;
    }

    if (!resp.ok || !resp.body) {
      const errMsg = await resp.text().catch(() => "Unknown error");
      this._showError(errMsg);
      this._setState("idle");
      return;
    }

    const ttsOptions = {
      provider: this._voiceConfig.tts_provider || "edge",
      voice: this._voiceConfig.tts_voice || "",
      speed: this._voiceConfig.tts_speed || 1.0,
    };

    try {
      await parseSseStream(resp.body, {
        onContent: (text) => {
          if (sessionId !== this._sessionId) return;
          aiParts.push(text);
          this._updateAiText(aiParts.join(""));

          for (const sentence of sentenceBuffer.add(text)) {
            this._ttsPlayer.enqueue(sentence, ttsOptions);
          }
        },
        onMeta: () => {},
        onError: (err) => {
          if (sessionId !== this._sessionId) return;
          this._showError(err);
        },
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[voice] SSE error:", err);
    }

    if (sessionId !== this._sessionId) return;

    // flush 剩余文字
    const tail = sentenceBuffer.flush();
    if (tail) {
      this._ttsPlayer.enqueue(tail, ttsOptions);
    }

    // 追加 assistant message
    const fullText = aiParts.join("");
    if (fullText) {
      this._messages.push({ role: "assistant", content: fullText });
    }

    // 如果没有任何 TTS 内容（空回复），手动回到 idle
    if (!fullText && !this._ttsPlayer.playing) {
      this._setState("idle");
    }
  }

  // ---- 对话持久化 ----

  async _saveMessages() {
    if (!this._conversationId || this._messages.length === 0) return;
    try {
      await apiFetch(`/api/conversations/${this._conversationId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this._messages }),
      });
    } catch (err) {
      console.warn("[voice] Failed to save messages:", err);
    }
  }

  // ---- UI 更新 ----

  _showUserText(text, interim = false) {
    if (interim) {
      this._userTextEl.innerHTML = `<span class="voice-interim">${escapeHtml(text)}</span>`;
    } else {
      this._userTextEl.textContent = text;
    }
    this._scrollTextArea();
  }

  _updateAiText(text) {
    this._aiTextEl.textContent = text;
    this._scrollTextArea();
  }

  _showError(msg) {
    const errorEl = document.createElement("div");
    errorEl.className = "voice-error";
    errorEl.textContent = typeof msg === "string" ? msg : "Error";
    this._aiTextEl.parentElement.appendChild(errorEl);
    setTimeout(() => errorEl.remove(), 5000);
  }

  _scrollTextArea() {
    const area = document.getElementById("voice-text-area");
    if (area) area.scrollTop = area.scrollHeight;
  }

  // ---- 清理 ----

  destroy() {
    this._sttManager?.abort();
    this._ttsPlayer?.destroy();
    this._orb?.stop();
    this._abortController?.abort();
    this._audioSession.destroy();
    this._sessionId++;
  }
}
