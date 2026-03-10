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
import { t } from "./i18n.js";

export const MEMORY_CATEGORIES = ["identity", "preferences", "events"];

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

const DOC_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

function renderDocCard(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toUpperCase();
  return `<div class="doc-card"><div class="doc-card-icon">${DOC_ICON}</div><div class="doc-card-info"><span class="doc-card-name">${fileName.replace(/</g, "&lt;")}</span><span class="doc-card-ext">${ext}</span></div></div>`;
}

/** 将消息文本中的 📎 filename 标记替换为文件卡片 HTML，返回 { html, rest } */
function extractDocMarker(text) {
  const match = text.match(/^📎\s*(.+)$/m);
  if (!match) return null;
  const fileName = match[1].trim();
  const rest = text.replace(match[0], "").trim();
  return { fileName, rest };
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
  copyBtn.title = t("title_copy");
  copyBtn.dataset.msgAction = "copy";
  copyBtn.dataset.msgIndex = msgIndex;
  copyBtn.innerHTML = ICON_COPY;
  toolbar.appendChild(copyBtn);

  if (msg.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "toolbar-btn";
    editBtn.title = t("title_edit");
    editBtn.dataset.msgAction = "edit";
    editBtn.dataset.msgIndex = msgIndex;
    editBtn.innerHTML = ICON_EDIT;
    toolbar.appendChild(editBtn);
  } else if (msg.role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "toolbar-btn";
    regenBtn.title = t("title_regenerate");
    regenBtn.dataset.msgAction = "regenerate";
    regenBtn.dataset.msgIndex = msgIndex;
    regenBtn.innerHTML = ICON_REGENERATE;
    toolbar.appendChild(regenBtn);
  }

  return toolbar;
}

// ===== 记忆引用指示器 =====
export function getCategoryLabel(cat) { return t("mem_cat_" + cat); }
const STARS = { 1: "★", 2: "★★", 3: "★★★" };

export function appendMemoryIndicator(container, metaEl, memories) {
  if (!memories || memories.length === 0) return;
  if (localStorage.getItem("showMemoryRefs") === "false") return;

  const badge = document.createElement("span");
  badge.className = "memory-ref-badge";
  badge.textContent = t("label_memory_badge", { count: memories.length });
  metaEl.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "memory-ref-panel hidden";

  for (const cat of MEMORY_CATEGORIES) {
    const items = memories.filter((m) => m.category === cat);
    if (items.length === 0) continue;
    const heading = document.createElement("div");
    heading.className = "memory-ref-category";
    heading.textContent = getCategoryLabel(cat);
    panel.appendChild(heading);
    for (const item of items) {
      const line = document.createElement("div");
      line.className = "memory-ref-item";
      line.textContent = `${STARS[item.importance] || "★★"} ${item.text}`;
      panel.appendChild(line);
    }
  }

  container.insertBefore(panel, metaEl.nextSibling);

  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
  });
}

// ===== 摘要卡片 =====

const ICON_SUMMARY = '<svg class="summary-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

function createSummaryCardEl(summary) {
  const details = document.createElement("details");
  details.className = "summary-card";

  const summaryEl = document.createElement("summary");

  // SVG 图标
  const iconSpan = document.createElement("span");
  iconSpan.innerHTML = ICON_SUMMARY;
  summaryEl.appendChild(iconSpan.firstChild);

  const title = document.createElement("span");
  title.textContent = t("label_summary_card", { count: summary.upToIndex });
  summaryEl.appendChild(title);

  // 折叠时的预览文本
  const preview = document.createElement("span");
  preview.className = "summary-preview";
  const previewText = summary.text.replace(/\n/g, " ").slice(0, 60);
  preview.textContent = previewText + (summary.text.length > 60 ? "..." : "");
  summaryEl.appendChild(preview);

  details.appendChild(summaryEl);

  const body = document.createElement("div");
  body.className = "summary-card-body";
  body.textContent = summary.text;
  details.appendChild(body);

  return details;
}

export function renderSummaryCard(conv) {
  // 移除已有的摘要卡片
  const existing = messagesEl.querySelector(".summary-card");
  if (existing) existing.remove();

  if (!conv?.summary?.text) return;

  const card = createSummaryCardEl(conv.summary);
  const upToIndex = conv.summary.upToIndex;

  // 找到被压缩的最后一条消息，在其后插入卡片
  // 如果 upToIndex >= 消息总数（全量压缩），放在末尾
  const anchorEl = messagesEl.querySelector(`.message[data-msg-index="${upToIndex - 1}"]`);
  if (anchorEl && anchorEl.nextSibling) {
    messagesEl.insertBefore(card, anchorEl.nextSibling);
  } else {
    // 末尾或找不到锚点 → append
    messagesEl.appendChild(card);
  }
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
          const docInfo = extractDocMarker(combinedText);
          if (docInfo) {
            const cardWrapper = document.createElement("div");
            cardWrapper.innerHTML = renderDocCard(docInfo.fileName);
            div.appendChild(cardWrapper.firstChild);
            if (docInfo.rest) {
              const p = document.createElement("p");
              p.textContent = docInfo.rest;
              bubble.appendChild(p);
            }
          } else {
            const p = document.createElement("p");
            p.textContent = combinedText;
            bubble.appendChild(p);
          }
        } else {
          const contentContainer = document.createElement("div");
          contentContainer.innerHTML = renderMarkdown(combinedText);
          bubble.appendChild(contentContainer);
        }
      }
    } else if (msg.role === "user") {
      const docInfo = extractDocMarker(msg.content);
      if (docInfo) {
        const cardWrapper = document.createElement("div");
        cardWrapper.innerHTML = renderDocCard(docInfo.fileName);
        div.appendChild(cardWrapper.firstChild);
        if (docInfo.rest) bubble.textContent = docInfo.rest;
      } else {
        bubble.textContent = msg.content;
      }
    } else {
      // 历史消息的思考链折叠块
      if (msg.reasoning) {
        const details = document.createElement("details");
        details.className = "thinking-block";
        const summary = document.createElement("summary");
        summary.textContent = t("label_thinking");
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
          const tokenStr = msg.meta.total_tokens ? `${msg.meta.total_tokens} tokens · ` : "";
          metaEl.textContent = `${tokenStr}${msg.meta.model}${timeStr ? " · " + timeStr : ""}`;
        } else if (timeStr) {
          metaEl.textContent = timeStr;
        } else if (msg.meta.elapsed) {
          metaEl.textContent = `${msg.meta.elapsed}s`;
        }
        bubble.appendChild(metaEl);
        appendMemoryIndicator(bubble, metaEl, msg.meta.memories);
      }
    }

    if (bubble.childNodes.length > 0 || bubble.textContent) {
      div.appendChild(bubble);
    }
    div.appendChild(createMsgToolbar(msg, idx));
    messagesEl.appendChild(div);
  });

  // 插入摘要卡片
  if (conv.summary?.text) {
    renderSummaryCard(conv);
  }

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
