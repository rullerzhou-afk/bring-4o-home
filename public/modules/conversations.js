import {
  state,
  getCurrentConv,
  messagesEl,
  inputEl,
  chatListEl,
  batchBar,
  manageBtn,
  batchSelectAll,
  batchCount,
  batchDeleteBtn,
  sendBtn,
} from "./state.js";
import { apiFetch, showToast } from "./api.js";
import { renderMessages } from "./render.js";

let _localCacheTimer = null;

export function saveLocalCache() {
  if (_localCacheTimer) return;
  _localCacheTimer = setTimeout(() => {
    _localCacheTimer = null;
    const doSave = () => {
      try {
        localStorage.setItem("conversations", JSON.stringify(state.conversations));
      } catch (e) {
        if (e.name === "QuotaExceededError") {
          console.warn("localStorage 空间不足，仅缓存最近 20 个对话");
          localStorage.setItem("conversations", JSON.stringify(state.conversations.slice(0, 20)));
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

export async function saveConversationToServer(conv) {
  const id = conv.id;
  const prev = _saveQueue.get(id) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const res = await apiFetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conv.id, title: conv.title, messages: conv.messages }),
      });
      if (res && !res.ok) {
        showToast("对话保存失败，将在下次操作时重试", "warning");
      }
    } catch (err) {
      console.error("保存到服务器失败:", err);
      showToast("对话保存失败，将在下次操作时重试", "warning");
    }
  });
  _saveQueue.set(id, next);
  next.finally(() => {
    if (_saveQueue.get(id) === next) _saveQueue.delete(id);
  });
}

export function saveConversations() {
  saveLocalCache();
  const conv = getCurrentConv();
  if (conv && conv.messages) {
    saveConversationToServer(conv);
  }
}

export function createConversation() {
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
  state.conversations.unshift(conv);
  saveLocalCache();
  saveConversationToServer(conv);
  switchConversation(conv.id);
  renderChatList();
}

export async function switchConversation(id) {
  // 切换对话时中止正在进行的流式请求
  if (state.activeStreamAbort) {
    state.streamAbortedBySwitch = true;
    state.activeStreamAbort.abort();
    state.activeStreamAbort = null;
    state.isStreaming = false;
    sendBtn.disabled = false;
  }
  state.currentConvId = id;
  const conv = getCurrentConv();
  if (conv && conv.messages === null) {
    messagesEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px">加载中...</div>';
    await loadConversationMessages(id);
  }
  renderMessages();
  renderChatList();
  inputEl.focus();
}

export async function loadConversationMessages(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv || conv.messages !== null) return;
  try {
    const res = await apiFetch(`/api/conversations/${id}`);
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    conv.messages = data.messages || [];
    conv.title = data.title || conv.title;
    saveLocalCache();
    if (state.currentConvId === id) {
      renderMessages();
    }
  } catch (err) {
    console.error("加载对话失败:", err);
    conv.messages = [];
  }
}

export function deleteConversation(id, e) {
  e.stopPropagation();
  state.conversations = state.conversations.filter((c) => c.id !== id);
  saveLocalCache();
  apiFetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  if (state.currentConvId === id) {
    state.currentConvId = state.conversations.length > 0 ? state.conversations[0].id : null;
    renderMessages();
  }
  renderChatList();
}

export function toggleManageMode() {
  state.manageMode = !state.manageMode;
  state.selectedIds.clear();
  batchBar.classList.toggle("hidden", !state.manageMode);
  manageBtn.textContent = state.manageMode ? "取消管理" : "管理";
  batchSelectAll.checked = false;
  updateBatchCount();
  renderChatList();
}

export function updateBatchCount() {
  batchCount.textContent = `已选 ${state.selectedIds.size} 个`;
  batchDeleteBtn.disabled = state.selectedIds.size === 0;
  // 同步全选勾选框状态
  const visibleIds = (searchResults.value !== null ? searchResults.value : state.conversations).map((c) => c.id);
  batchSelectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
}

export async function batchDelete() {
  if (state.selectedIds.size === 0) return;
  const count = state.selectedIds.size;
  if (!confirm(`确定要删除选中的 ${count} 个对话吗？此操作不可撤销。`)) return;

  const ids = [...state.selectedIds];
  // 乐观更新：先从前端移除
  state.conversations = state.conversations.filter((c) => !state.selectedIds.has(c.id));
  if (state.selectedIds.has(state.currentConvId)) {
    state.currentConvId = state.conversations.length > 0 ? state.conversations[0].id : null;
    renderMessages();
  }
  saveLocalCache();
  state.selectedIds.clear();
  toggleManageMode();

  // 后端批量删除
  apiFetch("/api/conversations/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }).catch(() => {});
}

export const searchResults = { value: null }; // null = 正常模式，数组 = 搜索模式

export function getTimeGroupLabel(convId) {
  const ts = parseInt(convId, 10);
  if (isNaN(ts)) return "";
  const date = new Date(ts);
  const now = new Date();
  const curYear = now.getFullYear();
  const convYear = date.getFullYear();

  if (convYear < curYear) return `${convYear}`;

  const convMonth = date.getMonth();
  const curQuarter = Math.floor(now.getMonth() / 3);
  const convQuarter = Math.floor(convMonth / 3);

  if (convQuarter < curQuarter) {
    const start = convQuarter * 3 + 1;
    const end = start + 2;
    return `${start}-${end}月`;
  }
  return `${convMonth + 1}月`;
}

export function renderChatList() {
  chatListEl.innerHTML = "";
  let items = searchResults.value !== null ? searchResults.value : state.conversations;

  if (searchResults.value !== null && items.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color: var(--text-secondary); font-size: 13px; text-align: center; padding: 16px;";
    empty.textContent = "没有找到匹配的对话";
    chatListEl.appendChild(empty);
    return;
  }

  // 非搜索模式下确保按时间倒序
  if (searchResults.value === null) {
    items = [...items].sort((a, b) => Number(b.id) - Number(a.id));
  }

  let lastGroup = null;

  items.forEach((item) => {
    const convId = item.id;
    const convTitle = item.title;

    // 非搜索模式下插入时间分组标题
    if (searchResults.value === null) {
      const group = getTimeGroupLabel(convId);
      if (group && group !== lastGroup) {
        lastGroup = group;
        const header = document.createElement("div");
        header.className = "chat-list-group";
        header.textContent = group;
        chatListEl.appendChild(header);
      }
    }

    const div = document.createElement("div");
    div.className = "chat-item" + (convId === state.currentConvId ? " active" : "");

    if (state.manageMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "batch-checkbox";
      cb.checked = state.selectedIds.has(convId);
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => {
        if (cb.checked) state.selectedIds.add(convId);
        else state.selectedIds.delete(convId);
        updateBatchCount();
      };
      div.appendChild(cb);
    }

    const title = document.createElement("span");
    title.className = "chat-item-title";
    title.textContent = convTitle;

    div.appendChild(title);

    if (searchResults.value !== null && item.snippet) {
      const snippetEl = document.createElement("div");
      snippetEl.className = "chat-item-snippet";
      snippetEl.textContent = item.snippet;
      div.appendChild(snippetEl);
    }

    if (!state.manageMode) {
      const delBtn = document.createElement("button");
      delBtn.className = "chat-item-delete";
      delBtn.innerHTML = "&times;";
      delBtn.title = "删除对话";
      delBtn.onclick = (e) => deleteConversation(convId, e);
      div.appendChild(delBtn);
    }

    div.onclick = () => {
      if (state.manageMode) {
        const cb = div.querySelector(".batch-checkbox");
        cb.checked = !cb.checked;
        if (cb.checked) state.selectedIds.add(convId);
        else state.selectedIds.delete(convId);
        updateBatchCount();
      } else {
        switchConversation(convId);
      }
    };
    chatListEl.appendChild(div);
  });
}