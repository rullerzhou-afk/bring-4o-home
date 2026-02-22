import { state, getCurrentConv, messagesEl, inputEl, sendBtn } from "./state.js";
import { apiFetch, showToast, readErrorMessage, renderMarkdown, formatMetaTime } from "./api.js";
import { saveConversations, createConversation, renderChatList } from "./conversations.js";
import { renderMessages, scrollToBottom, startStreamFollow, stopStreamFollow, isNearBottom, createMsgToolbar, getMessageText } from "./render.js";
import { renderImagePreview } from "./images.js";

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
    summary.textContent = "思考中...";
    block.appendChild(summary);
    const body = document.createElement("div");
    body.className = "thinking-body";
    block.appendChild(body);
    bubble.insertBefore(block, cursor);
  }
  const body = block.querySelector(".thinking-body");
  body.innerHTML = renderMarkdown(reasoningText);
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
      body: JSON.stringify({ messages: recent }),
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
      showLearnToast(data.learned);
    }
  } catch {
    // 静默失败，不影响主流程
  }
}

function showLearnToast(facts) {
  const toast = document.createElement("div");
  toast.className = "learn-toast";
  toast.textContent = `\uD83E\uDDE0 记住了 ${facts.length} 条新信息`;
  toast.title = facts.join("\n");
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// ===== 发送消息 =====
export async function sendMessage() {
  const text = inputEl.value.trim();
  const images = [...state.pendingImages];
  if ((!text && images.length === 0) || state.isStreaming) return;

  if (!state.currentConvId) {
    createConversation();
  }

  const conv = getCurrentConv();

  // 构造用户消息（含时间戳）
  let userMessage;
  let outboundUserContent = null;
  if (images.length > 0) {
    const contentParts = [];
    const thumbnailParts = [];
    if (text) {
      contentParts.push({ type: "text", text });
      thumbnailParts.push({ type: "text", text });
    }
    images.forEach((img) => {
      contentParts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      thumbnailParts.push({ type: "image_url", image_url: { url: img.thumbnail } });
    });
    userMessage = { role: "user", content: thumbnailParts, meta: { timestamp: new Date().toISOString() } };
    outboundUserContent = contentParts;
  } else {
    userMessage = { role: "user", content: text, meta: { timestamp: new Date().toISOString() } };
  }
  conv.messages.push(userMessage);

  if (conv.messages.length === 1) {
    const title = text || "图片对话";
    conv.title = title.slice(0, 30) + (title.length > 30 ? "..." : "");
    renderChatList();
  }

  saveConversations();
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
  if (scrollSpacer) {
    messagesEl.insertBefore(div, scrollSpacer);
    // 助手消息长大时，占位符对应缩小，总高度不变
    const initialSpacerH = parseFloat(scrollSpacer.style.height) || 0;
    const spacerObserver = new ResizeObserver(() => {
      const remaining = Math.max(0, initialSpacerH - div.offsetHeight);
      scrollSpacer.style.height = remaining + "px";
      if (remaining <= 0 && scrollSpacer.parentNode) {
        scrollSpacer.remove();
        spacerObserver.disconnect();
        // 占位符消失后立即跳到底部，让 startStreamFollow 接管后续滚动
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
    spacerObserver.observe(div);
  } else {
    messagesEl.appendChild(div);
    scrollToBottom(true);
  }

  let metaInfo = null;
  let reasoningContent = "";

  try {
    const maxCtx = state.currentConfig?.context_window ?? 50;
    const apiMessages = conv.messages.slice(0, -1).slice(-maxCtx).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 若有完整图片内容，替换最后一条 user 消息的 content
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
    let inactivityTimer = setTimeout(() => chatAbort.abort(), INACTIVITY_TIMEOUT);
    function resetInactivityTimer() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => chatAbort.abort(), INACTIVITY_TIMEOUT);
    }

    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages }),
      signal: chatAbort.signal,
    });
    resetInactivityTimer();

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    if (!response.body) {
      throw new Error("服务端未返回可读流。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamDone = false;
    let contentChanged = false;
    let reasoningChanged = false;
    let rafPending = false;
    let sseParseErrors = 0;

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

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      resetInactivityTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          streamDone = true;
          await reader.cancel();
          break;
        }

        try {
          const parsed = JSON.parse(data);
          sseParseErrors = 0;
          if (parsed.error) {
            assistantMsg.content += `\n\n**错误:** ${parsed.error}`;
            contentChanged = true;
          } else if (parsed.reasoning) {
            reasoningContent += parsed.reasoning;
            reasoningChanged = true;
          } else if (parsed.status) {
            showSearchStatus(bubble, cursor, parsed.status);
          } else if (parsed.meta) {
            metaInfo = parsed.meta;
          } else if (parsed.content) {
            clearSearchStatus(bubble);
            clearThinkingStatus(bubble);
            assistantMsg.content += parsed.content;
            contentChanged = true;
          }
        } catch (e) {
          sseParseErrors += 1;
          if (sseParseErrors >= 5) {
            showToast("流式数据解析异常，部分内容可能丢失");
            break;
          }
        }
      }

      scheduleRender();
    }

    clearTimeout(inactivityTimer);

    // 流式结束：确保纯文本是最新的（markdown 由收尾阶段处理）
    if (contentChanged) {
      streamContentEl.textContent = assistantMsg.content;
    }
    // 注意：不再调 showThinkingStatus / scrollToBottom，收尾阶段统一处理
  } catch (err) {
    // 用户主动切换对话导致的 abort，静默保存已有内容
    if (state.streamAbortedBySwitch) {
      state.streamAbortedBySwitch = false;
      saveConversations();
      stopStreamFollow();
      setStreaming(false);
      return;
    }
    const suffix = err.name === "AbortError"
      ? "**请求超时:** 服务器长时间无响应，连接已断开"
      : `**请求失败:** ${err.message}`;
    assistantMsg.content = assistantMsg.content ? `${assistantMsg.content}\n\n${suffix}` : suffix;
  }

  state.activeStreamAbort = null;

  // --- 二阶段收尾：先去光标画一帧，再做重活 ---

  // 1. 记录滚动状态（在 DOM 变动前）
  const shouldStickBottom = !messagesEl.querySelector("#scroll-spacer") && isNearBottom(200);

  // 2. 去掉光标 + 停止跟随（纯文本保持可见）
  cursor.remove();
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
    summary.textContent = "查看思考过程";
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
    metaEl.textContent = `${metaInfo.total_tokens} tokens · ${metaInfo.model} · ${timeStr}`;
  } else {
    metaEl.textContent = timeStr;
  }
  frag.appendChild(metaEl);
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

  saveConversations();
  setStreaming(false);

  // 滚动放到下一帧，避免和 DOM 更新冲突
  if (shouldStickBottom) {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // Auto-learn: fire-and-forget
  triggerAutoLearn(conv);
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
  cancelBtn.textContent = "取消";

  const submitBtn = document.createElement("button");
  submitBtn.className = "edit-submit-btn";
  submitBtn.textContent = "发送";

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

    // 截断后续消息
    conv.messages.length = msgIndex + 1;
    saveConversations();
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
export function regenerateMessage(msgIndex) {
  if (state.isStreaming) return;

  const conv = getCurrentConv();
  if (!conv) return;
  const msg = conv.messages[msgIndex];
  if (!msg || msg.role !== "assistant") return;

  // 截断从当前 assistant 消息开始的所有内容
  conv.messages.length = msgIndex;
  saveConversations();
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
  streamAssistantReply(conv, null);
}

export function setStreaming(val) {
  state.isStreaming = val;
  sendBtn.disabled = val;
}
