import { state, getCurrentConv, messagesEl, inputEl, sendBtn } from "./state.js";
import { apiFetch, showToast, readErrorMessage, renderMarkdown, formatMetaTime } from "./api.js";
import { saveConversations, createConversation, renderChatList, saveLocalCache } from "./conversations.js";
import { renderMessages, scrollToBottom, startStreamFollow, stopStreamFollow, isNearBottom, createMsgToolbar, getMessageText, appendMemoryIndicator, getCategoryLabel, renderSummaryCard } from "./render.js";
import { renderImagePreview } from "./images.js";
import { clearPendingDocument, renderDocumentPreview } from "./files.js";
import { t } from "./i18n.js";
import { parseSseStream } from "./sse-reader.js";

function showSearchStatus(bubble, cursor, statusText) {
  let indicator = bubble.querySelector(".search-status");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "search-status";
    bubble.insertBefore(indicator, cursor);
  }
  indicator.textContent = statusText;
}

function clearSearchStatus(bubble) {
  const indicator = bubble.querySelector(".search-status");
  if (indicator) indicator.remove();
}

function showThinkingStatus(bubble, cursor, reasoningText) {
  let block = bubble.querySelector(".thinking-streaming");
  if (!block) {
    block = document.createElement("details");
    block.className = "thinking-block thinking-streaming";
    block.open = true;
    const summary = document.createElement("summary");
    summary.textContent = t("label_thinking_live");
    block.appendChild(summary);
    const body = document.createElement("div");
    body.className = "thinking-body";
    block.appendChild(body);
    bubble.insertBefore(block, cursor);
  }
  const body = block.querySelector(".thinking-body");
  body.textContent = reasoningText;
}

function clearThinkingStatus(bubble) {
  const block = bubble.querySelector(".thinking-streaming");
  if (block) block.remove();
}

export async function triggerAutoLearn(conv) {
  if (!conv || conv.messages.length < 2) return;
  const recent = conv.messages.slice(-4).map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "text").map((p) => ({ type: "text", text: p.text }))
          : "",
  }));
  try {
    const res = await apiFetch("/api/memory/auto-learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convId: conv.id, messages: recent }),
    });
    if (!res.ok) {
      const errMsg = await readErrorMessage(res).catch(() => `HTTP ${res.status}`);
      console.warn("Auto-learn failed:", errMsg);
      return;
    }
    const data = await res.json();
    if (data.skipped) {
      console.info("Auto-learn skipped:", data.skipped);
    }
    if (data.learned && data.learned.length > 0) {
      showLearnCard(data.learned);
    }
    if (data.decay?.decayed?.length > 0) {
      showToast(t("toast_decay_cleaned", { count: data.decay.decayed.length }), "success");
    }
    if (data.promotion?.promoted?.length > 0 || data.promotion?.demoted?.length > 0) {
      const parts = [];
      if (data.promotion.promoted.length > 0) parts.push(t("toast_promoted", { count: data.promotion.promoted.length }));
      if (data.promotion.demoted.length > 0) parts.push(t("toast_demoted", { count: data.promotion.demoted.length }));
      showToast(parts.join(", "), "success");
    }
    if (data.capacityWarning) {
      showToast(t("toast_capacity_warning"), "warning");
    }
  } catch {
    // 静默失败，不影响主流程
  }
}

let _activeLearnCard = null;

const OP_ICONS = { add: "+", update: "~", delete: "−", merge: "≈" };
function getOpLabel(op) { return t("label_op_" + op); }

function showLearnCard(ops) {
  if (_activeLearnCard) { _activeLearnCard.remove(); _activeLearnCard = null; }

  const card = document.createElement("div");
  card.className = "learn-card";

  // header
  const header = document.createElement("div");
  header.className = "learn-card-header";
  let addUpdateCount = 0, deleteCount = 0;
  const undoableIds = [];
  for (const o of ops) {
    if (o.op === "add" || o.op === "update") {
      addUpdateCount++;
      if (o.id) undoableIds.push(o.id);
    } else if (o.op === "delete") {
      deleteCount++;
    }
  }
  const parts = [];
  if (addUpdateCount > 0) parts.push(t("label_learned", { count: addUpdateCount }));
  if (deleteCount > 0) parts.push(t("label_removed", { count: deleteCount }));
  header.textContent = `\uD83E\uDDE0 ${parts.join(", ")}`;
  header.addEventListener("click", () => card.classList.toggle("collapsed"));
  card.appendChild(header);

  // details
  const details = document.createElement("div");
  details.className = "learn-card-details";
  const detailsFrag = document.createDocumentFragment();
  for (const op of ops) {
    const row = document.createElement("div");
    const effectiveOp = op.dedupMerge ? "merge" : op.op;
    row.className = `learn-op learn-op-${effectiveOp}`;
    const icon = document.createElement("span");
    icon.className = "learn-op-icon";
    icon.textContent = OP_ICONS[effectiveOp] || "?";
    row.appendChild(icon);
    const label = document.createElement("span");
    label.className = "learn-op-label";
    label.textContent = getOpLabel(effectiveOp);
    row.appendChild(label);
    if (op.category) {
      const cat = document.createElement("span");
      cat.className = "learn-op-cat";
      cat.textContent = getCategoryLabel(op.category);
      row.appendChild(cat);
    }
    if (op.text) {
      const text = document.createElement("span");
      text.className = "learn-op-text";
      text.textContent = op.text;
      row.appendChild(text);
    }
    if (op.op === "delete" && op.oldId) {
      const idSpan = document.createElement("span");
      idSpan.className = "learn-op-text";
      idSpan.textContent = op.oldId;
      row.appendChild(idSpan);
    }
    detailsFrag.appendChild(row);
  }
  details.appendChild(detailsFrag);
  card.appendChild(details);
  const actions = document.createElement("div");
  actions.className = "learn-card-actions";

  if (undoableIds.length > 0) {
    const undoBtn = document.createElement("button");
    undoBtn.className = "learn-undo-btn";
    undoBtn.textContent = t("btn_undo");
    undoBtn.addEventListener("click", async () => {
      undoBtn.disabled = true;
      undoBtn.textContent = t("status_undoing");
      try {
        const res = await apiFetch("/api/memory/auto-learn/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: undoableIds }),
        });
        if (res.ok) {
          const data = await res.json();
          header.textContent = t("label_undo_done", { count: data.removed });
          details.remove();
          actions.remove();
          setTimeout(() => {
            card.classList.add("fade-out");
            setTimeout(() => { card.remove(); _activeLearnCard = null; }, 500);
          }, 2000);
        } else {
          undoBtn.textContent = t("btn_undo_failed");
          undoBtn.disabled = false;
        }
      } catch {
        undoBtn.textContent = t("btn_undo_failed");
        undoBtn.disabled = false;
      }
    });
    actions.appendChild(undoBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "learn-close-btn";
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", () => { card.remove(); _activeLearnCard = null; });
  actions.appendChild(closeBtn);

  card.appendChild(actions);
  document.body.appendChild(card);
  _activeLearnCard = card;

  // 3 秒后自动折叠
  setTimeout(() => {
    if (card.isConnected && !card.classList.contains("collapsed")) {
      card.classList.add("collapsed");
    }
  }, 3000);
}

// ===== 摘要压缩 =====

// 缓存容忍度：已有摘要覆盖的消息数只要在 oldCount ± 5 范围内就认为仍新鲜
const STALE_MARGIN = 5;

/** 提取消息的纯文本内容，过滤掉图片（避免发送 base64 给 compress 端点） */
function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.filter((p) => p.type === "text").map((p) => p.text);
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}

/** 调用 compress API，返回 summary 对象或 null */
async function callCompressApi(convId, messages) {
  const originalCount = messages.length;
  // 只发纯文本，过滤图片消息
  const textMessages = [];
  for (const m of messages) {
    const text = extractTextContent(m.content);
    if (text !== null) textMessages.push({ role: m.role, content: text });
  }
  if (textMessages.length < 2) return null;

  const res = await apiFetch("/api/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ convId, messages: textMessages, originalCount }),
  });
  if (!res.ok) {
    const errMsg = await readErrorMessage(res).catch(() => `HTTP ${res.status}`);
    throw new Error(errMsg);
  }
  const data = await res.json();
  return {
    text: data.summary,
    upToIndex: data.compressedCount,
    generatedAt: data.generatedAt,
  };
}

async function ensureSummary(conv, keepRecent) {
  const totalMessages = conv.messages.length - 1; // 不含还没发的 assistant 占位
  const oldCount = totalMessages - keepRecent;
  if (oldCount < 2) return null;

  // 检查缓存新鲜度
  if (conv.summary && conv.summary.text && conv.summary.upToIndex >= oldCount - STALE_MARGIN) {
    return conv.summary.text;
  }

  // 生成新摘要
  try {
    const summary = await callCompressApi(conv.id, conv.messages.slice(0, oldCount));
    if (summary) conv.summary = summary;
    return summary?.text || null;
  } catch (err) {
    console.warn("[compress] failed:", err.message);
    showToast(t("toast_summary_failed"), "warning");
    return null;
  }
}

export async function manualCompress() {
  const conv = getCurrentConv();
  if (!conv || conv.messages.length < 4) {
    showToast(t("toast_too_few"), "warning");
    return;
  }

  // 手动压缩：总结整个对话（全部消息）
  showToast(t("toast_compressing"), "info");
  try {
    const summary = await callCompressApi(conv.id, conv.messages);
    if (summary) {
      conv.summary = summary;
      saveLocalCache();
      renderSummaryCard(conv);
      // 滚动到摘要卡片让用户看到
      requestAnimationFrame(() => {
        const card = messagesEl.querySelector(".summary-card");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      showToast(t("toast_compressed", { count: summary.upToIndex }), "success");
    } else {
      showToast(t("toast_nothing_compress"), "warning");
    }
  } catch (err) {
    showToast(t("toast_compress_failed", { msg: err.message }), "error");
  }
}

// ===== 发送消息 =====
export async function sendMessage() {
  const text = inputEl.value.trim();
  const images = [...state.pendingImages];
  const doc = state.pendingDocument;
  if ((!text && images.length === 0 && !doc) || state.isStreaming) return;

  if (!state.currentConvId) {
    createConversation();
  }

  const conv = getCurrentConv();

  // 构造用户消息（含时间戳）
  let userMessage;
  let outboundUserContent = null;

  // 文档注入：本地存标记，outbound 发全文
  let localText = text;
  let outboundText = text;
  if (doc) {
    const marker = `📎 ${doc.name}`;
    localText = localText ? `${marker}\n${localText}` : marker;
    // 动态计算文档可用空间
    // - 纯文档：validator 限制 string content ≤ 30000 字符
    // - 图片+文档：validator 限制 multipart text part ≤ 10000 字符
    const maxLen = images.length > 0 ? 10_000 : 30_000;
    const prefix = `\n\n---\n📎 ${doc.name} 内容:\n`;
    const budget = maxLen - text.length - prefix.length;
    const docText = budget > 0 ? doc.text.slice(0, budget) : "";
    const docBlock = prefix + docText;
    outboundText = outboundText ? `${outboundText}${docBlock}` : docBlock.trimStart();
  }

  if (images.length > 0) {
    const contentParts = [];
    const thumbnailParts = [];
    if (outboundText) {
      contentParts.push({ type: "text", text: outboundText });
    }
    if (localText) {
      thumbnailParts.push({ type: "text", text: localText });
    }
    images.forEach((img) => {
      contentParts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      thumbnailParts.push({ type: "image_url", image_url: { url: img.thumbnail } });
    });
    userMessage = { role: "user", content: thumbnailParts, meta: { timestamp: new Date().toISOString() } };
    outboundUserContent = contentParts;
  } else if (doc) {
    // 有文档但无图片：本地存 localText，outbound 发 outboundText
    userMessage = { role: "user", content: localText, meta: { timestamp: new Date().toISOString() } };
    outboundUserContent = outboundText;
  } else {
    userMessage = { role: "user", content: text, meta: { timestamp: new Date().toISOString() } };
  }
  conv.messages.push(userMessage);

  if (conv.messages.length === 1) {
    const title = text || (doc ? doc.name : t("label_image_chat"));
    conv.title = title.slice(0, 30) + (title.length > 30 ? "..." : "");
    renderChatList();
  }

  saveConversations(conv);
  renderMessages();

  // 添加占位符撑开底部，使用户消息可以滚动到视口顶部
  const scrollSpacer = document.createElement("div");
  scrollSpacer.id = "scroll-spacer";
  scrollSpacer.style.height = messagesEl.clientHeight + "px";
  messagesEl.appendChild(scrollSpacer);

  const userMsgDiv = messagesEl.querySelector(`.message[data-msg-index="${conv.messages.length - 1}"]`);
  if (userMsgDiv) {
    userMsgDiv.scrollIntoView({ block: "start", behavior: "instant" });
  }

  inputEl.value = "";
  state.pendingImages = [];
  renderImagePreview();
  if (doc) clearPendingDocument();
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";

  setStreaming(true);
  startStreamFollow();
  await streamAssistantReply(conv, outboundUserContent);
}

// ===== 流式获取助手回复（sendMessage / editMessage / regenerateMessage 共用） =====
export async function streamAssistantReply(conv, outboundUserContent = null) {
  const assistantMsg = { role: "assistant", content: "" };
  conv.messages.push(assistantMsg);
  const assistantIndex = conv.messages.length - 1;

  const div = document.createElement("div");
  div.className = "message assistant";
  div.dataset.msgIndex = assistantIndex;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const streamContentEl = document.createElement("div");
  streamContentEl.className = "streaming-content";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  bubble.appendChild(streamContentEl);
  bubble.appendChild(cursor);
  div.appendChild(bubble);

  // 在占位符前插入助手消息，保持用户消息在视口顶部
  const scrollSpacer = messagesEl.querySelector("#scroll-spacer");
  let _spacerObserver = null;           // 引用提升，收尾阶段保底 disconnect
  if (scrollSpacer) {
    messagesEl.insertBefore(div, scrollSpacer);
    // 助手消息长大时，占位符对应缩小，总高度不变
    const initialSpacerH = parseFloat(scrollSpacer.style.height) || 0;
    _spacerObserver = new ResizeObserver(() => {
      const remaining = Math.max(0, initialSpacerH - div.offsetHeight);
      scrollSpacer.style.height = remaining + "px";
      if (remaining <= 0 && scrollSpacer.parentNode) {
        scrollSpacer.remove();
        _spacerObserver.disconnect();
        _spacerObserver = null;
        // 占位符消失后立即跳到底部，让 startStreamFollow 接管后续滚动
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
    _spacerObserver.observe(div);
  } else {
    messagesEl.appendChild(div);
    scrollToBottom(true);
  }

  let metaInfo = null;
  let reasoningContent = "";
  let inactivityTimer;

  try {
    const maxCtx = state.currentConfig?.context_window ?? 50;
    const autoCompress = state.currentConfig?.auto_compress ?? false;
    const keepRecent = state.currentConfig?.compress_keep_recent ?? 10;

    let summaryText = null;
    if (autoCompress && conv.messages.length - 1 > maxCtx) {
      summaryText = await ensureSummary(conv, keepRecent);
    }
    const sliceCount = summaryText ? keepRecent : maxCtx;
    const apiMessages = conv.messages.slice(0, -1).slice(-sliceCount)
      .map((m) => ({ role: m.role, content: m.content }));

    // 若有完整内容（图片原图 / 文档全文），替换最后一条 user 消息的 content
    if (outboundUserContent) {
      for (let i = apiMessages.length - 1; i >= 0; i--) {
        if (apiMessages[i].role === "user") {
          apiMessages[i].content = outboundUserContent;
          break;
        }
      }
    }

    const chatAbort = new AbortController();
    state.activeStreamAbort = chatAbort;

    // 无活动超时：60 秒内没收到任何数据就 abort
    const INACTIVITY_TIMEOUT = 60_000;
    inactivityTimer = setTimeout(() => chatAbort.abort(), INACTIVITY_TIMEOUT);
    function resetInactivityTimer() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => chatAbort.abort(), INACTIVITY_TIMEOUT);
    }

    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        ...(summaryText ? { summary: summaryText } : {}),
      }),
      signal: chatAbort.signal,
    });
    resetInactivityTimer();

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    if (!response.body) {
      throw new Error(t("err_no_stream"));
    }

    let contentChanged = false;
    let reasoningChanged = false;
    let rafPending = false;

    function scheduleRender() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (reasoningChanged) {
          showThinkingStatus(bubble, cursor, reasoningContent);
          reasoningChanged = false;
        }
        if (contentChanged) {
          streamContentEl.textContent = assistantMsg.content;
          contentChanged = false;
        }
        if (!messagesEl.querySelector("#scroll-spacer") && isNearBottom(200)) {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      });
    }

    const { parseErrors } = await parseSseStream(response.body, {
      onChunk: () => {
        resetInactivityTimer();
        scheduleRender();
      },
      onContent: (text) => {
        clearSearchStatus(bubble);
        clearThinkingStatus(bubble);
        assistantMsg.content += text;
        contentChanged = true;
      },
      onReasoning: (text) => {
        reasoningContent += text;
        reasoningChanged = true;
      },
      onStatus: (status) => {
        showSearchStatus(bubble, cursor, status);
      },
      onMeta: (meta) => {
        metaInfo = meta;
      },
      onError: (errMsg) => {
        assistantMsg.content += "\n\n" + t("err_stream_error", { msg: errMsg });
        contentChanged = true;
      },
    });

    clearTimeout(inactivityTimer);
    if (parseErrors >= 3) showToast(t("toast_stream_parse"));

    // 流式结束：确保纯文本是最新的（markdown 由收尾阶段处理）
    if (contentChanged) {
      streamContentEl.textContent = assistantMsg.content;
    }
    // 注意：不再调 showThinkingStatus / scrollToBottom，收尾阶段统一处理
  } catch (err) {
    clearTimeout(inactivityTimer);
    // 用户主动切换对话导致的 abort，静默保存已有内容
    if (state.streamAbortedBySwitch) {
      state.streamAbortedBySwitch = false;
      if (_spacerObserver) { _spacerObserver.disconnect(); _spacerObserver = null; }
      saveConversations(conv);
      stopStreamFollow();
      setStreaming(false);
      return;
    }
    const suffix = err.name === "AbortError"
      ? t("err_timeout")
      : t("err_request_failed", { msg: err.message });
    assistantMsg.content = assistantMsg.content ? `${assistantMsg.content}\n\n${suffix}` : suffix;
  }

  state.activeStreamAbort = null;

  // --- 二阶段收尾：先去光标画一帧，再做重活 ---

  // 1. 记录滚动状态（在 DOM 变动前）
  const shouldStickBottom = !messagesEl.querySelector("#scroll-spacer") && isNearBottom(200);

  // 2. 去掉光标 + 停止跟随（纯文本保持可见）
  cursor.remove();
  // 保底：短回复时 spacerObserver 可能永远不会自行 disconnect
  if (_spacerObserver) {
    _spacerObserver.disconnect();
    _spacerObserver = null;
    const leftoverSpacer = messagesEl.querySelector("#scroll-spacer");
    if (leftoverSpacer) leftoverSpacer.remove();
  }
  stopStreamFollow();

  // 3. 让无光标的纯文本先画一帧（视觉过渡自然）
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (!div.isConnected) return; // 用户已切换对话

  // 4. 构建最终 DOM（DocumentFragment 减少重排次数）
  const frag = document.createDocumentFragment();

  if (reasoningContent) {
    const details = document.createElement("details");
    details.className = "thinking-block";
    const summary = document.createElement("summary");
    summary.textContent = t("label_thinking");
    details.appendChild(summary);
    const thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingBody.textContent = reasoningContent;
    // 懒渲染：折叠状态跳过 markdown，展开时再渲染
    let reasoningRendered = false;
    details.addEventListener("toggle", () => {
      if (details.open && !reasoningRendered) {
        thinkingBody.innerHTML = renderMarkdown(reasoningContent);
        reasoningRendered = true;
      }
    });
    details.appendChild(thinkingBody);
    frag.appendChild(details);
    assistantMsg.reasoning = reasoningContent;
  }

  const contentContainer = document.createElement("div");
  contentContainer.innerHTML = renderMarkdown(assistantMsg.content);
  frag.appendChild(contentContainer);

  // meta 信息（token + 模型 + 日期/时间）
  const timestamp = new Date().toISOString();
  const metaEl = document.createElement("div");
  metaEl.className = "message-meta";
  const timeStr = formatMetaTime(timestamp);
  if (metaInfo) {
    const tokenStr = metaInfo.total_tokens ? `${metaInfo.total_tokens} tokens · ` : "";
    metaEl.textContent = `${tokenStr}${metaInfo.model} · ${timeStr}`;
  } else {
    metaEl.textContent = timeStr;
  }
  frag.appendChild(metaEl);
  if (metaInfo?.memories) {
    appendMemoryIndicator(frag, metaEl, metaInfo.memories);
  }
  assistantMsg.meta = metaInfo
    ? { ...metaInfo, timestamp }
    : { timestamp };

  // 5. 一次性替换 bubble 内容（避免 innerHTML="" + 多次 append）
  bubble.replaceChildren(frag);

  // 悬浮工具栏
  div.appendChild(createMsgToolbar(assistantMsg, assistantIndex));

  // 6. 占位符处理：不主动移除
  // 短回复：spacer 保留，维持"最新对话在顶部、下方留空"的布局（类似 Claude.ai）
  // 长回复：spacer 已被 ResizeObserver 在流式阶段移除，此处无操作
  // spacer 会在下次 renderMessages()（发新消息/切换对话）时自然清理

  saveConversations(conv);
  setStreaming(false);

  // 滚动放到下一帧，避免和 DOM 更新冲突
  if (shouldStickBottom) {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // Auto-learn: fire-and-forget
  triggerAutoLearn(conv);

  // 自动压缩成功后渲染摘要卡片
  if (conv.summary?.text) {
    renderSummaryCard(conv);
  }

  // 首次对话：AI 生成标题替代截断文本
  if (conv.messages.length === 2) {
    generateTitle(conv);
  }
}

async function generateTitle(conv) {
  try {
    const res = await apiFetch(`/api/conversations/${conv.id}/generate-title`, {
      method: "POST",
    });
    if (!res.ok) return;
    const { title } = await res.json();
    if (title) {
      conv.title = title;
      saveConversations(conv);
      renderChatList();
    }
  } catch {
    // 静默失败，保留截断标题
  }
}

// ===== 编辑用户消息（截断后续消息并重新生成） =====
export function editMessage(msgIndex) {
  if (state.isStreaming) return;

  const conv = getCurrentConv();
  if (!conv) return;
  const msg = conv.messages[msgIndex];
  if (!msg || msg.role !== "user") return;

  const msgDiv = messagesEl.querySelector(`.message[data-msg-index="${msgIndex}"]`);
  if (!msgDiv) return;

  const bubble = msgDiv.querySelector(".bubble");
  const currentText = getMessageText(msg.content);

  // 隐藏工具栏
  const toolbar = msgDiv.querySelector(".msg-toolbar");
  if (toolbar) toolbar.style.display = "none";

  // 保存原始内容
  const originalHTML = bubble.innerHTML;
  const originalBg = bubble.style.background;
  const originalShadow = bubble.style.boxShadow;

  // 替换为编辑 UI
  bubble.innerHTML = "";
  bubble.style.background = "none";
  bubble.style.boxShadow = "none";

  const textarea = document.createElement("textarea");
  textarea.className = "edit-textarea";
  textarea.value = currentText;
  bubble.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "edit-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "edit-cancel-btn";
  cancelBtn.textContent = t("btn_edit_cancel");

  const submitBtn = document.createElement("button");
  submitBtn.className = "edit-submit-btn";
  submitBtn.textContent = t("btn_edit_submit");

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  bubble.appendChild(actions);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // 自适应高度
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 300) + "px";
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + "px";
  });

  cancelBtn.onclick = () => {
    bubble.innerHTML = originalHTML;
    bubble.style.background = originalBg;
    bubble.style.boxShadow = originalShadow;
    if (toolbar) toolbar.style.display = "";
  };

  submitBtn.onclick = async () => {
    const newText = textarea.value.trim();
    if (!newText) return;

    // 更新消息内容
    if (Array.isArray(msg.content)) {
      const textPart = msg.content.find((p) => p.type === "text");
      if (textPart) {
        textPart.text = newText;
      } else {
        msg.content.unshift({ type: "text", text: newText });
      }
    } else {
      msg.content = newText;
    }
    msg.meta = { ...(msg.meta || {}), timestamp: new Date().toISOString() };

    // 截断后续消息（清除可能过时的摘要缓存）
    conv.messages.length = msgIndex + 1;
    conv.summary = null;
    saveConversations(conv);
    renderMessages();

    // 添加占位符并滚动到编辑的消息
    const editSpacer = document.createElement("div");
    editSpacer.id = "scroll-spacer";
    editSpacer.style.height = messagesEl.clientHeight + "px";
    messagesEl.appendChild(editSpacer);

    const editedDiv = messagesEl.querySelector(`.message[data-msg-index="${msgIndex}"]`);
    if (editedDiv) editedDiv.scrollIntoView({ block: "start", behavior: "instant" });

    setStreaming(true);
    startStreamFollow();
    await streamAssistantReply(conv, null);
  };
}

// ===== 重新生成助手回复 =====
export async function regenerateMessage(msgIndex) {
  if (state.isStreaming) return;

  const conv = getCurrentConv();
  if (!conv) return;
  const msg = conv.messages[msgIndex];
  if (!msg || msg.role !== "assistant") return;

  // 截断从当前 assistant 消息开始的所有内容（清除可能过时的摘要缓存）
  conv.messages.length = msgIndex;
  conv.summary = null;
  saveConversations(conv);
  renderMessages();

  // 添加占位符并滚动到最后一条消息
  const regenSpacer = document.createElement("div");
  regenSpacer.id = "scroll-spacer";
  regenSpacer.style.height = messagesEl.clientHeight + "px";
  messagesEl.appendChild(regenSpacer);

  const lastIdx = conv.messages.length - 1;
  const lastDiv = messagesEl.querySelector(`.message[data-msg-index="${lastIdx}"]`);
  if (lastDiv) lastDiv.scrollIntoView({ block: "start", behavior: "instant" });

  setStreaming(true);
  startStreamFollow();
  await streamAssistantReply(conv, null);
}

export function setStreaming(val) {
  state.isStreaming = val;
  sendBtn.disabled = val;
}
