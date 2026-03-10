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

const EDGE_VOICES = [
  { value: "zh-CN-YunxiNeural", label: "云溪 (男)" },
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女)" },
  { value: "zh-CN-YunyangNeural", label: "云扬 (男·新闻)" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 (女)" },
  { value: "zh-CN-YunjianNeural", label: "云健 (男)" },
  { value: "en-US-AndrewNeural", label: "Andrew (M)" },
  { value: "en-US-AriaNeural", label: "Aria (F)" },
  { value: "en-US-GuyNeural", label: "Guy (M)" },
  { value: "en-US-JennyNeural", label: "Jenny (F)" },
  { value: "ja-JP-NanamiNeural", label: "七海 (女)" },
];

const API_VOICES = [
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "fable", label: "Fable" },
  { value: "nova", label: "Nova" },
  { value: "onyx", label: "Onyx" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
];

const VOICE_SYSTEM_MSGS = {
  zh: "你正在语音对话中，请用口语化、简短、像真人说话的纯文本回复。" +
      "禁止使用任何 Markdown 格式（加粗、斜体、列表、代码块、标题等）。" +
      "不要输出代码。回复尽量简洁。",
  en: "You are in a voice conversation. Reply in short, natural, spoken-style plain text. " +
      "Do NOT use any Markdown formatting (bold, italic, lists, code blocks, headings, etc). " +
      "Do not output code. Keep replies concise. Reply in the same language the user speaks.",
};

function getVoiceSystemMsg() {
  const lang = document.documentElement.lang === "en" ? "en" : "zh";
  return { role: "system", content: VOICE_SYSTEM_MSGS[lang] };
}

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
    this._savedCount = 0;
    this._pendingAiText = "";  // partial AI text accumulated during SSE streaming

    // DOM
    this._micBtn = null;
    this._statusEl = null;
    this._textArea = null;
    this._currentAiBubble = null;
    this._interimBubble = null;
    this._modelSelect = null;
    this._ttsSelect = null;
    this._autoLearnTimer = null;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // DOM 元素
    this._micBtn = document.getElementById("voice-mic-btn");
    this._statusEl = document.getElementById("voice-status");
    this._textArea = document.getElementById("voice-text-area");
    this._modelSelect = document.getElementById("voice-model-select");
    this._ttsSelect = document.getElementById("voice-tts-select");
    const canvas = document.getElementById("voice-orb");

    // 球体可视化
    this._orb = new OrbVisualizer(canvas);
    this._orb.start();

    // 并行加载配置和恢复对话（不等模型列表，它要调外部 API 很慢）
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
    }

    // 先用 config 里的模型名占位，模型列表异步加载
    this._populateModelSelect([this._config.model || "gpt-4o"]);
    apiFetch("/api/models").then(r => r.ok ? r.json() : null).then(models => {
      if (!models) return;
      // API returns [{ id, provider }] — extract ids for <select>
      const ids = models.map(m => typeof m === "string" ? m : m.id);
      this._populateModelSelect(ids);
    }).catch(() => {});

    // 填充音色下拉框
    this._populateTtsSelect();

    if (savedConvId && convResult.status === "fulfilled" && convResult.value) {
      this._conversationId = savedConvId;
      this._messages = convResult.value.messages || [];
      this._savedCount = this._messages.length;
      this._renderHistory();
    } else if (savedConvId && convResult.status === "rejected") {
      console.warn("[voice] Failed to load conversation:", convResult.reason);
    }

    if (!this._conversationId) {
      await this._createConversation();
    }

    // 绑定事件
    this._micBtn.addEventListener("click", () => this._onMicClick());

    this._modelSelect.addEventListener("change", () => this._onModelChange());
    this._ttsSelect.addEventListener("change", () => this._onTtsVoiceChange());

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

    // 离开页面时立即触发自动记忆（不走 debounce）
    // 防御性：先移除旧监听器再注册（虽然 _initialized 守卫已防重复 init）
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
    }
    this._beforeUnloadHandler = () => this._doAutoLearn();
    window.addEventListener("beforeunload", this._beforeUnloadHandler);

    // 预加载 filler sound（静默失败）
    this._loadFiller();
  }

  async _createConversation() {
    const now = new Date();
    const title = `${t("voice_title")} ${now.toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })}`;

    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const data = await res.json();
        this._conversationId = data.id;
        sessionStorage.setItem("voice_conv_id", data.id);
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

  // ---- 下拉框填充 & 切换 ----

  _populateModelSelect(models) {
    this._modelSelect.innerHTML = "";
    const current = this._config.model || "gpt-4o";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === current) opt.selected = true;
      this._modelSelect.appendChild(opt);
    }
    // 如果列表为空，至少显示当前模型
    if (models.length === 0) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = current;
      opt.selected = true;
      this._modelSelect.appendChild(opt);
    }
  }

  _populateTtsSelect() {
    const provider = this._voiceConfig.tts_provider || "edge";
    const voices = provider === "edge" ? EDGE_VOICES : API_VOICES;
    const currentVoice = this._voiceConfig.tts_voice || "";
    this._ttsSelect.innerHTML = "";
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = v.label;
      if (v.value === currentVoice) opt.selected = true;
      this._ttsSelect.appendChild(opt);
    }
  }

  async _onModelChange() {
    const model = this._modelSelect.value;
    this._config.model = model;
    try {
      await apiFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
    } catch (err) {
      console.warn("[voice] Failed to save model:", err);
    }
  }

  async _onTtsVoiceChange() {
    const voice = this._ttsSelect.value;
    this._voiceConfig.tts_voice = voice;
    try {
      await apiFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: { ...this._voiceConfig, tts_voice: voice } }),
      });
    } catch (err) {
      console.warn("[voice] Failed to save voice:", err);
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

    // Finalize partial assistant response before saving — the SSE abort
    // causes _streamChat to return early, skipping the normal message push.
    this._finalizePartialAssistant();

    // 保存 partial response
    await this._saveMessages();

    if (sessionId !== this._sessionId) return; // 被更新的 session 覆盖

    // 重新开始录音
    await this._startSession();
  }

  /**
   * Flush any accumulated AI tokens into this._messages so that
   * a barge-in does not discard the partial assistant response.
   */
  _finalizePartialAssistant() {
    const text = this._pendingAiText;
    this._pendingAiText = "";
    if (text) {
      this._messages.push({ role: "assistant", content: text });
    }
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

    await this._sttManager.start();
    this._setState("listening");

    // 设置球体可视化
    if (provider !== "browser") {
      // API / Local 模式：有真实麦克风 analyser
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
    this._currentAiBubble = null;
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
    this._pendingAiText = "";

    const messagesWithVoice = [getVoiceSystemMsg(), ...this._messages];

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
          this._pendingAiText += text;
          this._updateAiText(this._pendingAiText);

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

    // 标记 TTS 不会再有新句子
    this._ttsPlayer.seal();

    // Finalize assistant message (moves _pendingAiParts → this._messages)
    this._finalizePartialAssistant();

    this._triggerAutoLearn();

    // 如果没有任何 TTS 内容（空回复），手动回到 idle
    const lastMsg = this._messages[this._messages.length - 1];
    const hasContent = lastMsg?.role === "assistant" && lastMsg.content;
    if (!hasContent && !this._ttsPlayer.playing) {
      this._setState("idle");
    }
  }

  // ---- 自动记忆 ----

  /** debounce 自动记忆：等对话停顿 15 秒后再触发，避免快速对话烧掉冷却期 */
  _triggerAutoLearn() {
    clearTimeout(this._autoLearnTimer);
    if (!this._conversationId || this._messages.length < 4) return;
    this._autoLearnTimer = setTimeout(() => this._doAutoLearn(), 15_000);
  }

  /** 立即执行自动记忆（beforeunload 等场景） */
  _doAutoLearn() {
    clearTimeout(this._autoLearnTimer);
    if (!this._conversationId || this._messages.length < 4) return;
    const recent = this._messages.slice(-6).map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content
        : Array.isArray(m.content)
          ? m.content.filter(p => p.type === "text").map(p => ({ type: "text", text: p.text }))
          : "",
    }));
    apiFetch("/api/memory/auto-learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convId: this._conversationId, messages: recent }),
    }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (data.learned && data.learned.length > 0) {
        this._showLearnNotification(data.learned);
      }
    }).catch(err => console.warn("[voice] auto-learn failed:", err));
  }

  // ---- 对话持久化 ----

  async _saveMessages() {
    if (!this._conversationId || this._messages.length === 0) return;
    const unsaved = this._messages.slice(this._savedCount);
    if (unsaved.length === 0) return;
    try {
      const res = await apiFetch(`/api/conversations/${this._conversationId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: unsaved }),
      });
      if (res.ok) {
        this._savedCount = this._messages.length;
      }
    } catch (err) {
      console.warn("[voice] Failed to save messages:", err);
    }
  }

  // ---- UI 更新 ----

  _renderHistory() {
    if (this._messages.length === 0) return;
    for (const msg of this._messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter(p => p.type === "text").map(p => p.text).join("")
          : "";
      if (!text) continue;
      const bubble = this._addBubble(msg.role);
      bubble.textContent = text;
    }
    this._scrollTextArea();
  }

  _addBubble(role) {
    const row = document.createElement("div");
    row.className = `voice-msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    row.appendChild(bubble);
    this._textArea.appendChild(row);
    this._scrollTextArea();
    return bubble;
  }

  _showUserText(text, interim = false) {
    if (interim) {
      // 临时识别文字：复用或创建临时气泡
      if (!this._interimBubble) {
        this._interimBubble = this._addBubble("user");
        this._interimBubble.classList.add("voice-interim");
      }
      this._interimBubble.textContent = text;
      this._scrollTextArea();
    } else {
      // 最终文字：移除临时气泡，创建正式气泡
      if (this._interimBubble) {
        this._interimBubble.closest(".voice-msg")?.remove();
        this._interimBubble = null;
      }
      const bubble = this._addBubble("user");
      bubble.textContent = text;
    }
  }

  _updateAiText(text) {
    if (!this._currentAiBubble) {
      this._currentAiBubble = this._addBubble("assistant");
    }
    this._currentAiBubble.textContent = text;
    this._scrollTextArea();
  }

  _showLearnNotification(ops) {
    const OP_ICONS = { add: "+", update: "~", delete: "−", merge: "≈" };
    let addUpdateCount = 0, deleteCount = 0;
    for (const o of ops) {
      if (o.op === "add" || o.op === "update") addUpdateCount++;
      else if (o.op === "delete") deleteCount++;
    }
    const parts = [];
    if (addUpdateCount > 0) parts.push(t("label_learned", { count: addUpdateCount }));
    if (deleteCount > 0) parts.push(t("label_removed", { count: deleteCount }));

    const row = document.createElement("div");
    row.className = "voice-msg system";
    const bubble = document.createElement("div");
    bubble.className = "bubble voice-learn-bubble";

    const header = document.createElement("div");
    header.className = "voice-learn-header";
    header.textContent = `🧠 ${parts.join(", ")}`;
    bubble.appendChild(header);

    const list = document.createElement("div");
    list.className = "voice-learn-list";
    for (const op of ops) {
      const item = document.createElement("div");
      item.className = "voice-learn-item";
      const icon = OP_ICONS[op.dedupMerge ? "merge" : op.op] || "?";
      item.textContent = `${icon} ${op.text || op.oldId || ""}`;
      list.appendChild(item);
    }
    bubble.appendChild(list);
    row.appendChild(bubble);
    this._textArea.appendChild(row);
    this._scrollTextArea();

    // 8 秒后淡出移除
    setTimeout(() => {
      row.classList.add("voice-learn-fadeout");
      row.addEventListener("animationend", () => row.remove());
    }, 8000);
  }

  _showError(msg) {
    const errorEl = document.createElement("div");
    errorEl.className = "voice-error";
    errorEl.textContent = typeof msg === "string" ? msg : "Error";
    this._textArea.appendChild(errorEl);
    setTimeout(() => errorEl.remove(), 5000);
  }

  _scrollTextArea() {
    this._textArea.scrollTop = this._textArea.scrollHeight;
  }

  // ---- 清理 ----

  destroy() {
    clearTimeout(this._autoLearnTimer);
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
    }
    this._sttManager?.abort();
    this._ttsPlayer?.destroy();
    this._orb?.stop();
    this._abortController?.abort();
    this._audioSession.destroy();
    this._sessionId++;
  }
}
