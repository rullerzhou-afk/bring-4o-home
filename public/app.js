// ===== 时间格式化 =====
function formatMetaTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ===== 状态管理 =====
function loadLocalConversations() {
  try {
    const raw = localStorage.getItem("conversations");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("读取本地会话失败，已回退为空列表:", err);
    return [];
  }
}

let conversations = loadLocalConversations();
let currentConvId = null;
let isStreaming = false;
let pendingImages = [];
let activeStreamAbort = null; // 当前流式请求的 AbortController
let streamAbortedBySwitch = false; // 标记是否因切换对话而中止
let streamFollowRafId = null;
let streamFollowObserver = null;

const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const inputEl = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const newChatBtn = document.getElementById("new-chat");
const chatListEl = document.getElementById("chat-list");
const uploadBtn = document.getElementById("upload-btn");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const inputWrapper = document.getElementById("input-wrapper");
const modelSelector = document.getElementById("model-selector");
const welcomeGreetingEl = document.getElementById("welcome-greeting");

const WELCOME_GREETINGS = [
  "今天想聊点什么？",
  "鹿鹿，有什么我能帮忙的？",
  "又来找我啦，说吧～",
  "有什么新鲜事想分享吗？",
  "想聊天还是想搞事情？",
  "我在呢，有话直说～",
  "来了来了，什么事？",
  "鹿鹿今天心情怎么样？",
  "需要我做什么尽管开口～",
  "嗨，准备好了随时开始！",
];

function randomGreeting() {
  return WELCOME_GREETINGS[Math.floor(Math.random() * WELCOME_GREETINGS.length)];
}

// ===== Markdown 配置 =====
marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(content) {
  const source = typeof content === "string" ? content : "";
  const unsafeHtml = marked.parse(source);
  if (window.DOMPurify?.sanitize) {
    return DOMPurify.sanitize(unsafeHtml);
  }

  // DOMPurify 加载失败时，降级到纯文本渲染，避免 XSS。
  const escaped = document.createElement("div");
  escaped.textContent = source;
  return escaped.innerHTML.replace(/\n/g, "<br>");
}

function getApiToken() {
  return (localStorage.getItem("api_token") || "").trim();
}

function withAuthHeaders(headers = {}) {
  const token = getApiToken();
  if (!token) return { ...headers };
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => null);
    if (data?.error) return data.error;
  }
  const text = await response.text().catch(() => "");
  return text || `HTTP ${response.status}`;
}

async function apiFetch(url, options = {}, allowRetry = true) {
  const finalOptions = {
    ...options,
    headers: withAuthHeaders(options.headers || {}),
  };
  const response = await fetch(url, finalOptions);

  if (response.status === 401 && allowRetry) {
    const token = window.prompt("请输入 ADMIN_TOKEN 后继续");
    if (token && token.trim()) {
      localStorage.setItem("api_token", token.trim());
      return apiFetch(url, options, false);
    }
  }

  return response;
}

// ===== 对话管理 =====
let _localCacheTimer = null;
function saveLocalCache() {
  if (_localCacheTimer) return;
  _localCacheTimer = setTimeout(() => {
    _localCacheTimer = null;
    const doSave = () => {
      try {
        localStorage.setItem("conversations", JSON.stringify(conversations));
      } catch (e) {
        if (e.name === "QuotaExceededError") {
          console.warn("localStorage 空间不足，仅缓存最近 20 个对话");
          localStorage.setItem("conversations", JSON.stringify(conversations.slice(0, 20)));
        }
      }
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(doSave);
    } else {
      doSave();
    }
  }, 500);
}

const _saveQueue = new Map(); // convId -> Promise chain
async function saveConversationToServer(conv) {
  const id = conv.id;
  const prev = _saveQueue.get(id) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      await apiFetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conv.id, title: conv.title, messages: conv.messages }),
      });
    } catch (err) {
      console.error("保存到服务器失败:", err);
    }
  });
  _saveQueue.set(id, next);
  next.finally(() => {
    if (_saveQueue.get(id) === next) _saveQueue.delete(id);
  });
}

function saveConversations() {
  saveLocalCache();
  const conv = getCurrentConv();
  if (conv && conv.messages) {
    saveConversationToServer(conv);
  }
}

function createConversation() {
  // 如果当前对话是空的，直接复用，不重复创建
  const current = getCurrentConv();
  if (current && current.messages && current.messages.length === 0) {
    inputEl.focus();
    return;
  }

  const conv = {
    id: Date.now().toString(),
    title: "新对话",
    messages: [],
  };
  conversations.unshift(conv);
  saveLocalCache();
  saveConversationToServer(conv);
  switchConversation(conv.id);
  renderChatList();
}

async function switchConversation(id) {
  // 切换对话时中止正在进行的流式请求
  if (activeStreamAbort) {
    streamAbortedBySwitch = true;
    activeStreamAbort.abort();
    activeStreamAbort = null;
    setStreaming(false);
  }
  currentConvId = id;
  const conv = getCurrentConv();
  if (conv && conv.messages === null) {
    messagesEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px">加载中...</div>';
    await loadConversationMessages(id);
  }
  renderMessages();
  renderChatList();
  inputEl.focus();
}

async function loadConversationMessages(id) {
  const conv = conversations.find((c) => c.id === id);
  if (!conv || conv.messages !== null) return;
  try {
    const res = await apiFetch(`/api/conversations/${id}`);
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    conv.messages = data.messages || [];
    conv.title = data.title || conv.title;
    saveLocalCache();
    if (currentConvId === id) {
      renderMessages();
    }
  } catch (err) {
    console.error("加载对话失败:", err);
    conv.messages = [];
  }
}

function getCurrentConv() {
  return conversations.find((c) => c.id === currentConvId);
}

function deleteConversation(id, e) {
  e.stopPropagation();
  conversations = conversations.filter((c) => c.id !== id);
  saveLocalCache();
  apiFetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  if (currentConvId === id) {
    currentConvId = conversations.length > 0 ? conversations[0].id : null;
    renderMessages();
  }
  renderChatList();
}

let searchResults = null; // null = 正常模式，数组 = 搜索模式

function renderChatList() {
  chatListEl.innerHTML = "";
  const items = searchResults !== null ? searchResults : conversations;

  if (searchResults !== null && items.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color: var(--text-secondary); font-size: 13px; text-align: center; padding: 16px;";
    empty.textContent = "没有找到匹配的对话";
    chatListEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const convId = item.id;
    const convTitle = item.title;

    const div = document.createElement("div");
    div.className = "chat-item" + (convId === currentConvId ? " active" : "");

    const title = document.createElement("span");
    title.className = "chat-item-title";
    title.textContent = convTitle;

    const delBtn = document.createElement("button");
    delBtn.className = "chat-item-delete";
    delBtn.innerHTML = "&times;";
    delBtn.title = "删除对话";
    delBtn.onclick = (e) => deleteConversation(convId, e);

    div.appendChild(title);

    if (searchResults !== null && item.snippet) {
      const snippetEl = document.createElement("div");
      snippetEl.className = "chat-item-snippet";
      snippetEl.textContent = item.snippet;
      div.appendChild(snippetEl);
    }

    div.appendChild(delBtn);
    div.onclick = () => switchConversation(convId);
    chatListEl.appendChild(div);
  });
}

function renderMessages() {
  const conv = getCurrentConv();
  if (!conv || !conv.messages || conv.messages.length === 0) {
    messagesEl.innerHTML = "";
    messagesEl.appendChild(welcomeEl);
    welcomeEl.style.display = "flex";
    welcomeGreetingEl.textContent = randomGreeting();
    return;
  }

  welcomeEl.style.display = "none";
  messagesEl.innerHTML = "";

  conv.messages.forEach((msg) => {
    const div = document.createElement("div");
    div.className = `message ${msg.role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const imgContainer = document.createElement("div");
        imgContainer.className = "message-images";
        let textContent = "";
        msg.content.forEach((part) => {
          if (part.type === "text") {
            textContent = part.text;
          } else if (part.type === "image_url") {
            const img = document.createElement("img");
            img.src = part.image_url.url;
            img.onclick = () => showLightbox(part.image_url.url);
            imgContainer.appendChild(img);
          }
        });
        if (imgContainer.children.length > 0) bubble.appendChild(imgContainer);
        if (textContent) {
          const p = document.createElement("p");
          p.textContent = textContent;
          bubble.appendChild(p);
        }
      } else {
        bubble.textContent = msg.content;
      }
    } else {
      // 历史消息的思考链折叠块
      if (msg.reasoning) {
        const details = document.createElement("details");
        details.className = "thinking-block";
        const summary = document.createElement("summary");
        summary.textContent = "查看思考过程";
        details.appendChild(summary);
        const thinkingBody = document.createElement("div");
        thinkingBody.className = "thinking-body";
        thinkingBody.innerHTML = renderMarkdown(msg.reasoning);
        details.appendChild(thinkingBody);
        bubble.appendChild(details);
      }
      const contentContainer = document.createElement("div");
      contentContainer.innerHTML = renderMarkdown(msg.content || "");
      bubble.appendChild(contentContainer);
      if (msg.meta) {
        const metaEl = document.createElement("div");
        metaEl.className = "message-meta";
        const timeStr = formatMetaTime(msg.meta.timestamp);
        if (msg.meta.model) {
          metaEl.textContent = `${msg.meta.total_tokens} tokens · ${msg.meta.model}${timeStr ? " · " + timeStr : ""}`;
        } else if (timeStr) {
          metaEl.textContent = timeStr;
        } else if (msg.meta.elapsed) {
          metaEl.textContent = `${msg.meta.elapsed}s`;
        }
        bubble.appendChild(metaEl);
      }
    }

    const copyText = getMessageText(msg.content);
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.title = "复制";
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(copyText).then(() => {
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 1500);
      });
    };

    div.appendChild(bubble);
    div.appendChild(copyBtn);
    messagesEl.appendChild(div);
  });

  scrollToBottom(true);
}

function isNearBottom(threshold = 120) {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}

function scrollToBottom(force = false) {
  if (force || isNearBottom()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function startStreamFollow() {
  stopStreamFollow();
  const follow = () => {
    if (!isStreaming) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    streamFollowRafId = requestAnimationFrame(follow);
  };
  streamFollowRafId = requestAnimationFrame(follow);

  if (typeof ResizeObserver === "function") {
    streamFollowObserver = new ResizeObserver(() => {
      if (isStreaming) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
    streamFollowObserver.observe(messagesEl);
  }
}

function stopStreamFollow() {
  if (streamFollowRafId !== null) {
    cancelAnimationFrame(streamFollowRafId);
    streamFollowRafId = null;
  }
  if (streamFollowObserver) {
    streamFollowObserver.disconnect();
    streamFollowObserver = null;
  }
}

window.addEventListener("focus", () => {
  if (isStreaming) {
    scrollToBottom(true);
  }
});

// ===== 图片处理 =====
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createThumbnail(dataUrl, maxSize = 150) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.src = dataUrl;
  });
}

function compressImage(dataUrl, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    if (dataUrl.length * 0.75 < maxBytes) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxDim = 2048;
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  });
}

async function addImages(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (pendingImages.length >= 5) break;
    const dataUrl = await readFileAsDataUrl(file);
    const compressed = await compressImage(dataUrl);
    const thumbnail = await createThumbnail(dataUrl);
    pendingImages.push({ dataUrl: compressed, thumbnail });
  }
  renderImagePreview();
}

function renderImagePreview() {
  imagePreview.innerHTML = "";
  if (pendingImages.length === 0) {
    imagePreview.classList.add("hidden");
    return;
  }
  imagePreview.classList.remove("hidden");
  pendingImages.forEach((img, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    const imgEl = document.createElement("img");
    imgEl.src = img.thumbnail;
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.innerHTML = "&times;";
    removeBtn.onclick = () => {
      pendingImages.splice(idx, 1);
      renderImagePreview();
    };
    thumb.appendChild(imgEl);
    thumb.appendChild(removeBtn);
    imagePreview.appendChild(thumb);
  });
}

function showLightbox(src) {
  const overlay = document.createElement("div");
  overlay.id = "image-lightbox";
  const img = document.createElement("img");
  img.src = src;
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function getMessageText(content) {
  if (Array.isArray(content)) {
    return content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  }
  return content;
}

// ===== 搜索状态指示器 =====
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

// ===== 思考链流式指示器 =====
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

// ===== Auto-learn =====
async function triggerAutoLearn(conv) {
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
    if (!res.ok) return;
    const data = await res.json();
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
async function sendMessage() {
  const text = inputEl.value.trim();
  const images = [...pendingImages];
  if ((!text && images.length === 0) || isStreaming) return;

  if (!currentConvId) {
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
  pendingImages = [];
  renderImagePreview();
  autoResize();
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
    const apiMessages = conv.messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m === userMessage && outboundUserContent ? outboundUserContent : m.content,
    }));
    const chatAbort = new AbortController();
    activeStreamAbort = chatAbort;

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
          // 忽略解析错误
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
    if (streamAbortedBySwitch) {
      streamAbortedBySwitch = false;
      saveConversations();
      stopStreamFollow();
      return;
    }
    const suffix = err.name === "AbortError"
      ? "**请求超时:** 服务器长时间无响应，连接已断开"
      : `**请求失败:** ${err.message}`;
    assistantMsg.content = assistantMsg.content ? `${assistantMsg.content}\n\n${suffix}` : suffix;
  }

  activeStreamAbort = null;
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

function setStreaming(val) {
  isStreaming = val;
  sendBtn.disabled = val;
}

// ===== 输入框自动高度 =====
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
}

inputEl.addEventListener("input", autoResize);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);
newChatBtn.addEventListener("click", createConversation);

// ===== 图片上传事件 =====
uploadBtn.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    addImages(Array.from(e.target.files));
    imageInput.value = "";
  }
});

document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length > 0) {
    e.preventDefault();
    addImages(imageFiles);
  }
});

inputWrapper.addEventListener("dragover", (e) => {
  e.preventDefault();
  inputWrapper.classList.add("drag-over");
});

inputWrapper.addEventListener("dragleave", (e) => {
  e.preventDefault();
  inputWrapper.classList.remove("drag-over");
});

inputWrapper.addEventListener("drop", (e) => {
  e.preventDefault();
  inputWrapper.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
  if (files.length > 0) addImages(files);
});

// ===== 设置面板 =====
const settingsBtn = document.getElementById("settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsClose = document.getElementById("settings-close");
const editSystem = document.getElementById("edit-system");
const editMemory = document.getElementById("edit-memory");
const editConfig = document.getElementById("edit-config");
const savePromptsBtn = document.getElementById("save-prompts");
const saveStatus = document.getElementById("save-status");
const tabs = document.querySelectorAll("#settings-tabs .tab");

// 模型参数控件
const configModel = document.getElementById("config-model");
const configTemp = document.getElementById("config-temp");
const configPP = document.getElementById("config-pp");
const configFP = document.getElementById("config-fp");
const tempVal = document.getElementById("temp-val");
const ppVal = document.getElementById("pp-val");
const fpVal = document.getElementById("fp-val");

// 滑块实时显示数值
configTemp.addEventListener("input", () => (tempVal.textContent = configTemp.value));
configPP.addEventListener("input", () => (ppVal.textContent = configPP.value));
configFP.addEventListener("input", () => (fpVal.textContent = configFP.value));

const currentModelDisplay = document.getElementById("current-model-display");

// 加载模型列表和配置
async function loadConfigPanel() {
  try {
    const [modelsRes, configRes] = await Promise.all([
      apiFetch("/api/models"),
      apiFetch("/api/config"),
    ]);
    if (!modelsRes.ok) throw new Error(await readErrorMessage(modelsRes));
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));
    const models = await modelsRes.json();
    const config = await configRes.json();

    // 显示当前模型
    currentModelDisplay.textContent = "当前模型: " + config.model;

    // 填充模型下拉框
    configModel.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === config.model) opt.selected = true;
      configModel.appendChild(opt);
    });

    // 填充参数
    configTemp.value = config.temperature ?? 1;
    tempVal.textContent = configTemp.value;
    configPP.value = config.presence_penalty ?? 0;
    ppVal.textContent = configPP.value;
    configFP.value = config.frequency_penalty ?? 0;
    fpVal.textContent = configFP.value;
  } catch (err) {
    console.error("加载配置失败:", err);
  }
}

// 打开设置
settingsBtn.addEventListener("click", async () => {
  settingsOverlay.classList.remove("hidden");
  saveStatus.textContent = "";
  try {
    const res = await apiFetch("/api/prompts");
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    editSystem.value = data.system || "";
    editMemory.value = data.memory || "";
  } catch (err) {
    editSystem.value = "// 加载失败: " + err.message;
  }
  loadConfigPanel();
});

// 关闭设置
settingsClose.addEventListener("click", () => {
  settingsOverlay.classList.add("hidden");
});

settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) {
    settingsOverlay.classList.add("hidden");
  }
});

// Tab 切换
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    editSystem.classList.toggle("hidden", target !== "system");
    editMemory.classList.toggle("hidden", target !== "memory");
    editConfig.classList.toggle("hidden", target !== "config");
  });
});

// 保存
savePromptsBtn.addEventListener("click", async () => {
  saveStatus.textContent = "保存中...";
  try {
    // 保存 prompt 文件
    const promptsRes = await apiFetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: editSystem.value,
        memory: editMemory.value,
      }),
    });
    if (!promptsRes.ok) throw new Error(await readErrorMessage(promptsRes));

    // 保存模型配置
    const configRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configModel.value,
        temperature: parseFloat(configTemp.value),
        presence_penalty: parseFloat(configPP.value),
        frequency_penalty: parseFloat(configFP.value),
      }),
    });
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));

    // 同步顶栏模型选择器
    if (modelSelector.value !== configModel.value) {
      modelSelector.value = configModel.value;
    }

    saveStatus.textContent = "已保存";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    saveStatus.textContent = "保存失败: " + err.message;
  }
});

// ===== 顶栏模型选择器 =====
async function loadModelSelector() {
  try {
    const [modelsRes, configRes] = await Promise.all([
      apiFetch("/api/models"),
      apiFetch("/api/config"),
    ]);
    if (!modelsRes.ok || !configRes.ok) return;
    const models = await modelsRes.json();
    const config = await configRes.json();

    modelSelector.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === config.model) opt.selected = true;
      modelSelector.appendChild(opt);
    });
  } catch (err) {
    console.error("加载模型列表失败:", err);
  }
}

modelSelector.addEventListener("change", async () => {
  try {
    const configRes = await apiFetch("/api/config");
    if (!configRes.ok) return;
    const config = await configRes.json();
    config.model = modelSelector.value;

    const saveRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!saveRes.ok) throw new Error("保存失败");

    // 同步设置面板的模型下拉框
    if (configModel.value !== modelSelector.value) {
      configModel.value = modelSelector.value;
    }
    currentModelDisplay.textContent = "当前模型: " + modelSelector.value;
  } catch (err) {
    console.error("切换模型失败:", err);
  }
});

loadModelSelector();

// ===== 搜索 =====
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
let searchTimeout = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle("hidden", !q);

  if (!q || q.length < 2) {
    searchResults = null;
    renderChatList();
    return;
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const res = await apiFetch("/api/conversations/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) throw new Error();
      searchResults = await res.json();
      renderChatList();
    } catch {
      // 降级到客户端标题搜索
      const lowerQ = q.toLowerCase();
      searchResults = conversations
        .filter((c) => c.title.toLowerCase().includes(lowerQ))
        .map((c) => ({ id: c.id, title: c.title, snippet: "" }));
      renderChatList();
    }
  }, 300);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchResults = null;
  searchClear.classList.add("hidden");
  renderChatList();
});

// ===== 主题切换 =====
const themeToggle = document.getElementById("theme-toggle");
const THEME_KEY = "theme_preference";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(preference) {
  const effective = preference === "system" ? getSystemTheme() : preference;
  if (effective === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const labels = { light: "\u2600\uFE0F \u4EAE\u8272", dark: "\uD83C\uDF19 \u6697\u8272", system: "\uD83D\uDCBB \u8DDF\u968F\u7CFB\u7EDF" };
  themeToggle.textContent = labels[preference] || labels.dark;
}

function cycleTheme() {
  const order = ["dark", "light", "system"];
  const current = localStorage.getItem(THEME_KEY) || "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

themeToggle.addEventListener("click", cycleTheme);

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if ((localStorage.getItem(THEME_KEY) || "system") === "system") {
    applyTheme("system");
  }
});

applyTheme(localStorage.getItem(THEME_KEY) || "system");

// ===== 初始化 =====
renderChatList();
if (conversations.length > 0) {
  switchConversation(conversations[0].id);
}
inputEl.focus();

// 启动时从服务器同步对话列表
(async function syncFromServer() {
  try {
    const res = await apiFetch("/api/conversations");
    if (!res.ok) return;
    const serverList = await res.json();

    // 本地迁移：localStorage 中独有的对话上传到服务器
    const serverIds = new Set(serverList.map((c) => c.id));
    const localOnly = conversations.filter((c) => !serverIds.has(c.id) && c.messages);
    for (const conv of localOnly) {
      await saveConversationToServer(conv);
    }

    // 合并：以服务器列表为主
    const mergedIds = new Set();
    const merged = [];
    for (const item of serverList) {
      mergedIds.add(item.id);
      const local = conversations.find((c) => c.id === item.id);
      if (local && local.messages) {
        merged.push(local);
      } else {
        merged.push({ id: item.id, title: item.title, messages: null });
      }
    }
    for (const conv of localOnly) {
      if (!mergedIds.has(conv.id)) {
        merged.push(conv);
      }
    }

    conversations = merged;
    saveLocalCache();
    renderChatList();

    // 如果当前对话需要延迟加载
    const current = getCurrentConv();
    if (current && current.messages === null) {
      await loadConversationMessages(current.id);
    }
  } catch (err) {
    console.error("服务器同步失败，使用本地缓存:", err);
  }
})();
