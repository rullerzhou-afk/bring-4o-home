import { state, getCurrentConv, messagesEl, inputEl, sendBtn } from "./state.js";
import { apiFetch, showToast, readErrorMessage, renderMarkdown, formatMetaTime } from "./api.js";
import { saveConversations, createConversation, renderChatList } from "./conversations.js";
import { renderMessages, scrollToBottom, startStreamFollow, stopStreamFollow } from "./render.js";
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

export async function sendMessage() {
  const text = inputEl.value.trim();
  const images = [...state.pendingImages];
  if ((!text && images.length === 0) || state.isStreaming) return;

  if (!state.currentConvId) {
    createConversation();
  }

  const conv = getCurrentConv();

  // 构造用户消息
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
    userMessage = { role: "user", content: thumbnailParts };
    outboundUserContent = contentParts;
  } else {
    userMessage = { role: "user", content: text };
  }
  conv.messages.push(userMessage);

  if (conv.messages.length === 1) {
    const title = text || "图片对话";
    conv.title = title.slice(0, 30) + (title.length > 30 ? "..." : "");
    renderChatList();
  }

  saveConversations();
  renderMessages();

  inputEl.value = "";
  state.pendingImages = [];
  renderImagePreview();
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
  setStreaming(true);
  startStreamFollow();

  const assistantMsg = { role: "assistant", content: "" };
  conv.messages.push(assistantMsg);

  const div = document.createElement("div");
  div.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const streamContentEl = document.createElement("div");
  streamContentEl.className = "streaming-content";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  bubble.appendChild(streamContentEl);
  bubble.appendChild(cursor);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  scrollToBottom(true);

  let metaInfo = null;
  let reasoningContent = "";

  try {
    const maxCtx = state.currentConfig?.context_window ?? 50;
    const apiMessages = conv.messages.slice(0, -1).slice(-maxCtx).map((m) => ({
      role: m.role,
      content: m === userMessage && outboundUserContent ? outboundUserContent : m.content,
    }));
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
        messagesEl.scrollTop = messagesEl.scrollHeight;
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

    // 流式结束后确保最终内容渲染
    if (contentChanged) {
      streamContentEl.textContent = assistantMsg.content;
      contentChanged = false;
    }
    if (reasoningChanged) {
      showThinkingStatus(bubble, cursor, reasoningContent);
    }
    scrollToBottom(true);
  } catch (err) {
    // 用户主动切换对话导致的 abort，静默保存已有内容
    if (state.streamAbortedBySwitch) {
      state.streamAbortedBySwitch = false;
      saveConversations();
      stopStreamFollow();
      return;
    }
    const suffix = err.name === "AbortError"
      ? "**请求超时:** 服务器长时间无响应，连接已断开"
      : `**请求失败:** ${err.message}`;
    assistantMsg.content = assistantMsg.content ? `${assistantMsg.content}\n\n${suffix}` : suffix;
  }

  state.activeStreamAbort = null;
  bubble.innerHTML = "";

  // 思考链：可折叠展示
  if (reasoningContent) {
    const details = document.createElement("details");
    details.className = "thinking-block";
    const summary = document.createElement("summary");
    summary.textContent = "查看思考过程";
    details.appendChild(summary);
    const thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingBody.innerHTML = renderMarkdown(reasoningContent);
    details.appendChild(thinkingBody);
    bubble.appendChild(details);
    assistantMsg.reasoning = reasoningContent;
  }

  // 正文
  const contentHtml = renderMarkdown(assistantMsg.content);
  const contentContainer = document.createElement("div");
  contentContainer.innerHTML = contentHtml;
  bubble.appendChild(contentContainer);

  // 显示 meta 信息（token + 模型 + 日期/时间）
  const timestamp = new Date().toISOString();
  const metaEl = document.createElement("div");
  metaEl.className = "message-meta";
  const timeStr = formatMetaTime(timestamp);
  if (metaInfo) {
    metaEl.textContent = `${metaInfo.total_tokens} tokens · ${metaInfo.model} · ${timeStr}`;
  } else {
    metaEl.textContent = timeStr;
  }
  bubble.appendChild(metaEl);
  assistantMsg.meta = metaInfo
    ? { ...metaInfo, timestamp }
    : { timestamp };

  // 流式结束后添加复制按钮
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.title = "复制";
  copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(assistantMsg.content).then(() => {
      copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 1500);
    });
  };
  div.appendChild(copyBtn);

  saveConversations();
  stopStreamFollow();
  setStreaming(false);
  scrollToBottom(true);

  // Auto-learn: fire-and-forget
  triggerAutoLearn(conv);
}

export function setStreaming(val) {
  state.isStreaming = val;
  sendBtn.disabled = val;
}