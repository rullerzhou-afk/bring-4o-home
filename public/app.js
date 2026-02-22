import {
  state,
  getCurrentConv,
  inputEl,
  sendBtn,
  newChatBtn,
  uploadBtn,
  imageInput,
  inputWrapper,
  messagesEl,
  manageBtn,
  batchCancelBtn,
  batchDeleteBtn,
  batchSelectAll,
} from "./modules/state.js";
import { apiFetch } from "./modules/api.js";
import { addImages } from "./modules/images.js";
import { sendMessage, editMessage, regenerateMessage } from "./modules/chat.js";
import { getMessageText, ICON_COPY, ICON_CHECK } from "./modules/render.js";
import {
  renderChatList,
  createConversation,
  switchConversation,
  toggleManageMode,
  updateBatchCount,
  batchDelete,
  searchResults,
  saveConversationToServer,
  saveLocalCache,
  loadConversationMessages,
} from "./modules/conversations.js";

import "./modules/settings.js";
import "./modules/theme.js";
import "./modules/import.js";

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

// ===== 批量管理事件 =====
manageBtn.addEventListener("click", toggleManageMode);
batchCancelBtn.addEventListener("click", toggleManageMode);
batchDeleteBtn.addEventListener("click", batchDelete);
batchSelectAll.addEventListener("change", () => {
  const visibleItems = searchResults.value !== null ? searchResults.value : state.conversations;
  if (batchSelectAll.checked) {
    visibleItems.forEach((c) => state.selectedIds.add(c.id));
  } else {
    visibleItems.forEach((c) => state.selectedIds.delete(c.id));
  }
  updateBatchCount();
  renderChatList();
});

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

// ===== 搜索 =====
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
let searchTimeout = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle("hidden", !q);

  if (!q || q.length < 2) {
    searchResults.value = null;
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
      searchResults.value = await res.json();
      renderChatList();
    } catch {
      // 降级到客户端标题搜索
      const lowerQ = q.toLowerCase();
      searchResults.value = state.conversations
        .filter((c) => c.title.toLowerCase().includes(lowerQ))
        .map((c) => ({ id: c.id, title: c.title, snippet: "" }));
      renderChatList();
    }
  }, 300);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchResults.value = null;
  searchClear.classList.add("hidden");
  renderChatList();
});

// ===== 消息工具栏：事件委托 =====
messagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-msg-action]");
  if (!btn) return;

  const action = btn.dataset.msgAction;
  const msgIndex = parseInt(btn.dataset.msgIndex, 10);

  if (action === "copy") {
    const conv = getCurrentConv();
    if (!conv) return;
    const msg = conv.messages[msgIndex];
    if (!msg) return;
    const text = getMessageText(msg.content);
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = ICON_CHECK;
      setTimeout(() => {
        btn.innerHTML = ICON_COPY;
      }, 1500);
    });
  } else if (action === "edit") {
    editMessage(msgIndex);
  } else if (action === "regenerate") {
    regenerateMessage(msgIndex);
  }
});

// ===== 移动端适配 =====
const sidebarCheckbox = document.getElementById("sidebar-toggle-checkbox");
const chatListEl = document.getElementById("chat-list");

if (window.matchMedia("(max-width: 768px)").matches) {
  // 小屏默认隐藏侧边栏
  if (!sidebarCheckbox.checked) sidebarCheckbox.checked = true;

  // 创建遮罩层
  const backdrop = document.createElement("div");
  backdrop.id = "sidebar-backdrop";
  backdrop.className = "hidden";
  document.getElementById("app").appendChild(backdrop);

  // 侧边栏切换时同步遮罩
  sidebarCheckbox.addEventListener("change", () => {
    backdrop.classList.toggle("hidden", sidebarCheckbox.checked);
  });

  // 点击遮罩关闭侧边栏
  backdrop.addEventListener("click", () => {
    sidebarCheckbox.checked = true;
    backdrop.classList.add("hidden");
  });

  // 选择对话后自动关闭侧边栏
  chatListEl.addEventListener("click", (e) => {
    if (e.target.closest(".chat-item") && !state.manageMode) {
      setTimeout(() => {
        sidebarCheckbox.checked = true;
        backdrop.classList.add("hidden");
      }, 100);
    }
  });
}

// ===== 初始化 =====
renderChatList();
if (state.conversations.length > 0) {
  switchConversation(state.conversations[0].id);
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
    const localOnly = state.conversations.filter((c) => !serverIds.has(c.id) && c.messages);
    for (const conv of localOnly) {
      await saveConversationToServer(conv);
    }

    // 合并：以服务器列表为主
    const mergedIds = new Set();
    const merged = [];
    for (const item of serverList) {
      mergedIds.add(item.id);
      const local = state.conversations.find((c) => c.id === item.id);
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

    state.conversations = merged;
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