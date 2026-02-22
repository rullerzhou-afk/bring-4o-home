import {
  state,
  messagesEl,
  welcomeEl,
  welcomeGreetingEl,
  getCurrentConv,
  randomGreeting,
} from "./state.js";
import { renderMarkdown, formatMetaTime } from "./api.js";
import { showLightbox } from "./images.js";

// ===== SVG 图标 =====
export const ICON_COPY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
export const ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const ICON_REGENERATE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>';

export function getMessageText(content) {
  if (Array.isArray(content)) {
    return content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  }
  return content;
}

export function createMsgToolbar(msg, msgIndex) {
  const toolbar = document.createElement("div");
  toolbar.className = "msg-toolbar";

  const timestamp = msg.meta?.timestamp;
  if (timestamp) {
    const timeEl = document.createElement("span");
    timeEl.className = "toolbar-time";
    timeEl.textContent = formatMetaTime(timestamp);
    toolbar.appendChild(timeEl);
  }

  const copyBtn = document.createElement("button");
  copyBtn.className = "toolbar-btn";
  copyBtn.title = "复制";
  copyBtn.dataset.msgAction = "copy";
  copyBtn.dataset.msgIndex = msgIndex;
  copyBtn.innerHTML = ICON_COPY;
  toolbar.appendChild(copyBtn);

  if (msg.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "toolbar-btn";
    editBtn.title = "编辑";
    editBtn.dataset.msgAction = "edit";
    editBtn.dataset.msgIndex = msgIndex;
    editBtn.innerHTML = ICON_EDIT;
    toolbar.appendChild(editBtn);
  } else if (msg.role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "toolbar-btn";
    regenBtn.title = "重新生成";
    regenBtn.dataset.msgAction = "regenerate";
    regenBtn.dataset.msgIndex = msgIndex;
    regenBtn.innerHTML = ICON_REGENERATE;
    toolbar.appendChild(regenBtn);
  }

  return toolbar;
}

export function renderMessages() {
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

  conv.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.className = `message ${msg.role}`;
    div.dataset.msgIndex = idx;
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (Array.isArray(msg.content)) {
      // 多模态消息（user 或 assistant 都可能有图片）
      const imgContainer = document.createElement("div");
      imgContainer.className = "message-images";
      const textParts = [];
      msg.content.forEach((part) => {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "image_url") {
          const img = document.createElement("img");
          img.src = part.image_url.url;
          img.onclick = () => showLightbox(part.image_url.url);
          imgContainer.appendChild(img);
        }
      });
      if (imgContainer.children.length > 0) bubble.appendChild(imgContainer);
      const combinedText = textParts.join("\n").trim();
      if (combinedText) {
        if (msg.role === "user") {
          const p = document.createElement("p");
          p.textContent = combinedText;
          bubble.appendChild(p);
        } else {
          const contentContainer = document.createElement("div");
          contentContainer.innerHTML = renderMarkdown(combinedText);
          bubble.appendChild(contentContainer);
        }
      }
    } else if (msg.role === "user") {
      bubble.textContent = msg.content;
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

    div.appendChild(bubble);
    div.appendChild(createMsgToolbar(msg, idx));
    messagesEl.appendChild(div);
  });

  scrollToBottom(true);
}

export function isNearBottom(threshold = 120) {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}

export function scrollToBottom(force = false) {
  if (force || isNearBottom()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

export function startStreamFollow() {
  stopStreamFollow();
  const hasSpacer = () => !!messagesEl.querySelector("#scroll-spacer");
  const follow = () => {
    if (!state.isStreaming) return;
    if (!hasSpacer() && isNearBottom(200)) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    state.streamFollowRafId = requestAnimationFrame(follow);
  };
  state.streamFollowRafId = requestAnimationFrame(follow);

  if (typeof ResizeObserver === "function") {
    state.streamFollowObserver = new ResizeObserver(() => {
      if (state.isStreaming && !hasSpacer() && isNearBottom(200)) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
    state.streamFollowObserver.observe(messagesEl);
  }
}

export function stopStreamFollow() {
  if (state.streamFollowRafId !== null) {
    cancelAnimationFrame(state.streamFollowRafId);
    state.streamFollowRafId = null;
  }
  if (state.streamFollowObserver) {
    state.streamFollowObserver.disconnect();
    state.streamFollowObserver = null;
  }
}

window.addEventListener("focus", () => {
  if (state.isStreaming) {
    scrollToBottom(true);
  }
});
