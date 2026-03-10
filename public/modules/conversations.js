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
import { t } from "./i18n.js";

let _localCacheTimer = null;

export function saveLocalCache() {
  if (_localCacheTimer) return;
  _localCacheTimer = setTimeout(() => {
    _localCacheTimer = null;
    const doSave = () => {
      try {
        // 保存为带版本号的格式
        const payload = { version: 1, data: state.conversations };
        localStorage.setItem("conversations", JSON.stringify(payload));
      } catch (e) {
        if (e.name === "QuotaExceededError") {
          const total = state.conversations.length;
          const attempts = [Math.ceil(total * 0.75), Math.ceil(total * 0.5), Math.ceil(total * 0.25), 20, 10];
          let saved = false;
          for (const count of attempts) {
            if (count >= total) continue;
            try {
              const payload = { version: 1, data: state.conversations.slice(0, count) };
              localStorage.setItem("conversations", JSON.stringify(payload));
              showToast(t("toast_storage_partial", { count }), "warning");
              saved = true;
              break;
            } catch { /* continue trying smaller */ }
          }
          if (!saved) {
            showToast(t("toast_storage_full"), "warning");
          }
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
        body: JSON.stringify({
          id: conv.id, title: conv.title, messages: conv.messages,
          ...(conv.summary !== undefined ? { summary: conv.summary } : {}),
        }),
      });
      if (res && !res.ok) {
        showToast(t("toast_save_failed"), "warning");
      }
    } catch (err) {
      console.error("Save to server failed:", err);
      showToast(t("toast_save_failed"), "warning");
    }
  });
  _saveQueue.set(id, next);
  next.finally(() => {
    if (_saveQueue.get(id) === next) _saveQueue.delete(id);
  });
}

export function saveConversations(explicitConv) {
  saveLocalCache();
  const conv = explicitConv || getCurrentConv();
  // 确认对话仍在列表中，防止异步回调复活已删除的对话
  if (conv && conv.messages && state.conversations.some((c) => c.id === conv.id)) {
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

  // 使用时间戳 + 随机后缀防止碰撞（若 1ms 内双击按钮）
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  const conv = {
    id: `${timestamp}${random}`,
    title: t("label_new_chat"),
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
    messagesEl.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:40px">${t("status_loading")}</div>`;
    await loadConversationMessages(id);
  }
  renderMessages();
  renderChatList();
  inputEl.focus();
  document.dispatchEvent(new Event("conversation-switched"));
}

export async function loadConversationMessages(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv || conv.messages !== null) return;
  try {
    const res = await apiFetch(`/api/conversations/${id}`);
    if (!res.ok) throw new Error(t("err_load_failed"));
    const data = await res.json();
    conv.messages = data.messages || [];
    conv.title = data.title || conv.title;
    if (data.summary) conv.summary = data.summary;
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
  const manageLabel = manageBtn.querySelector("[data-i18n]");
  const key = state.manageMode ? "btn_cancel_manage" : "btn_manage";
  manageLabel.dataset.i18n = key;
  manageLabel.textContent = t(key);
  batchSelectAll.checked = false;
  updateBatchCount();
  renderChatList();
}

export function updateBatchCount() {
  batchCount.textContent = t("label_selected_count", { count: state.selectedIds.size });
  batchDeleteBtn.disabled = state.selectedIds.size === 0;
  // 同步全选勾选框状态
  const visibleIds = (searchResults.value !== null ? searchResults.value : state.conversations).map((c) => c.id);
  batchSelectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
}

export async function batchDelete() {
  if (state.selectedIds.size === 0) return;
  const count = state.selectedIds.size;
  if (!confirm(t("confirm_batch_delete", { count }))) return;

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

export const searchResults = { value: null, truncated: false }; // null = 正常模式，数组 = 搜索模式

// ---- 分组辅助 ----

function getConvYearMonth(convId) {
  // ID 格式可能是纯时间戳或 "时间戳+3位随机数"，只取前 13 位作为 ms 时间戳
  const tsStr = String(convId).slice(0, 13);
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return null;
  const d = new Date(ts);
  return { year: d.getFullYear(), month: d.getMonth() }; // month 0-based
}

/** 构建层级分组结构，返回有序数组 */
function buildGroups(items) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3);

  // 按年月聚合
  const yearMap = new Map(); // year -> Map<month, conv[]>
  for (const item of items) {
    const ym = getConvYearMonth(item.id);
    if (!ym) continue;
    if (!yearMap.has(ym.year)) yearMap.set(ym.year, new Map());
    const mMap = yearMap.get(ym.year);
    if (!mMap.has(ym.month)) mMap.set(ym.month, []);
    mMap.get(ym.month).push(item);
  }

  const groups = []; // { type, label, key, children?, chats? }

  // 当年：按月/季度作为顶级分组
  const curYearMonths = yearMap.get(curYear);
  if (curYearMonths) {
    // 按月倒序
    const months = [...curYearMonths.keys()].sort((a, b) => b - a);
    // 先收集当前季度内的月份（单独显示）
    const curQuarterMonths = months.filter((m) => Math.floor(m / 3) === curQuarter);
    const pastQuarterMonths = months.filter((m) => Math.floor(m / 3) < curQuarter);

    for (const m of curQuarterMonths) {
      groups.push({
        type: "month",
        label: t("time_month_" + (m + 1)),
        key: `cur-${m}`,
        chats: curYearMonths.get(m),
      });
    }

    // 过去的季度按季度范围合并
    const quarterMap = new Map(); // quarter -> conv[]
    for (const m of pastQuarterMonths) {
      const q = Math.floor(m / 3);
      if (!quarterMap.has(q)) quarterMap.set(q, []);
      quarterMap.get(q).push(...curYearMonths.get(m));
    }
    const quarters = [...quarterMap.keys()].sort((a, b) => b - a);
    for (const q of quarters) {
      const start = q * 3 + 1;
      const end = start + 2;
      groups.push({
        type: "quarter",
        label: t("misc_quarter_range", { start: t("time_month_" + start), end: t("time_month_" + end) }),
        key: `cur-q${q}`,
        chats: quarterMap.get(q),
      });
    }
    yearMap.delete(curYear);
  }

  // 往年：年 -> 月两级
  const pastYears = [...yearMap.keys()].sort((a, b) => b - a);
  for (const y of pastYears) {
    const mMap = yearMap.get(y);
    const monthGroups = [];
    const sortedMonths = [...mMap.keys()].sort((a, b) => b - a);
    let totalCount = 0;
    for (const m of sortedMonths) {
      const chats = mMap.get(m);
      totalCount += chats.length;
      monthGroups.push({
        label: t("time_month_" + (m + 1)),
        key: `${y}-${m}`,
        chats,
      });
    }
    groups.push({
      type: "year",
      label: `${y}`,
      key: `${y}`,
      count: totalCount,
      children: monthGroups,
    });
  }

  return groups;
}

// ---- 渲染单个对话项 ----

function renderChatItem(item, nested) {
  const convId = item.id;
  const div = document.createElement("div");
  div.className = "chat-item" + (convId === state.currentConvId ? " active" : "") + (nested ? " nested" : "");

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
  title.textContent = item.title;
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
    delBtn.title = t("title_delete_chat");
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

  return div;
}

// ---- 创建分组标题元素 ----

function createGroupHeader(label, key, count, cssClass) {
  const collapsed = state.collapsedGroups.has(key);
  const header = document.createElement("div");
  header.className = cssClass;

  const chevron = document.createElement("span");
  chevron.className = "group-chevron" + (collapsed ? " collapsed" : "");
  chevron.textContent = "▾";
  header.appendChild(chevron);

  const text = document.createTextNode(label);
  header.appendChild(text);

  if (count != null) {
    const countEl = document.createElement("span");
    countEl.className = "group-count";
    countEl.textContent = count;
    header.appendChild(countEl);
  }

  header.onclick = () => {
    if (state.collapsedGroups.has(key)) {
      state.collapsedGroups.delete(key);
    } else {
      state.collapsedGroups.add(key);
    }
    renderChatList();
  };

  return { header, collapsed };
}

// ---- 主渲染函数 ----

// ---- 跨标签页同步 ----

export function initStorageSync() {
  window.addEventListener("storage", (e) => {
    if (e.key !== "conversations" || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);

      // 支持新的版本化格式 {version:1, data:[]} 和旧的裸数组格式
      let incoming;
      if (parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed) {
        // 版本不匹配时忽略同步,避免不兼容的数据覆盖当前状态
        if (parsed.version !== 1) {
          console.warn(`[initStorageSync] Ignoring incompatible cache version ${parsed.version}`);
          return;
        }
        incoming = parsed.data;
      } else if (Array.isArray(parsed)) {
        incoming = parsed; // 旧格式兼容
      } else {
        return; // 无效格式
      }

      if (!Array.isArray(incoming)) return;

      // 保留当前标签页已加载的消息内容
      const loaded = new Map();
      for (const c of state.conversations) {
        if (c.messages && c.messages.length > 0) loaded.set(c.id, c.messages);
      }

      for (const c of incoming) {
        if ((!c.messages || c.messages.length === 0) && loaded.has(c.id)) {
          c.messages = loaded.get(c.id);
        }
      }

      state.conversations = incoming;

      // 当前对话被其他标签页删除
      if (state.currentConvId && !incoming.some((c) => c.id === state.currentConvId)) {
        state.currentConvId = incoming.length > 0 ? incoming[0].id : null;
        renderMessages();
      }
      renderChatList();
    } catch { /* 解析失败静默忽略 */ }
  });
}

// ---- 主渲染函数 ----

export function renderChatList() {
  chatListEl.innerHTML = "";
  let items = searchResults.value !== null ? searchResults.value : state.conversations;

  // 搜索模式：扁平列表，无分组
  if (searchResults.value !== null) {
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color: var(--text-secondary); font-size: 13px; text-align: center; padding: 16px;";
      empty.textContent = t("label_search_empty");
      chatListEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      chatListEl.appendChild(renderChatItem(item, false));
    }
    if (searchResults.truncated) {
      const notice = document.createElement("div");
      notice.style.cssText = "color: var(--text-secondary); font-size: 12px; text-align: center; padding: 8px 16px;";
      notice.textContent = t("label_search_truncated");
      chatListEl.appendChild(notice);
    }
    return;
  }

  // 非搜索模式：按时间倒序，层级分组
  items = [...items].sort((a, b) => b.id.length - a.id.length || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  const groups = buildGroups(items);

  // 初始化：只展开当月，其余默认折叠
  if (!state._groupsInitialized && groups.length > 0) {
    const curMonthKey = `cur-${new Date().getMonth()}`;
    for (const g of groups) {
      if (g.key !== curMonthKey) state.collapsedGroups.add(g.key);
    }
    state._groupsInitialized = true;
  }

  for (const g of groups) {
    if (g.type === "month" || g.type === "quarter") {
      // 当年的月份/季度：单级折叠
      const { header, collapsed } = createGroupHeader(g.label, g.key, g.chats.length, "chat-list-group");
      chatListEl.appendChild(header);
      if (!collapsed) {
        for (const item of g.chats) {
          chatListEl.appendChild(renderChatItem(item, false));
        }
      }
    } else if (g.type === "year") {
      // 往年：年 -> 月两级
      const { header, collapsed } = createGroupHeader(g.label, g.key, g.count, "chat-list-group");
      chatListEl.appendChild(header);
      if (!collapsed) {
        for (const sub of g.children) {
          const { header: subHeader, collapsed: subCollapsed } = createGroupHeader(sub.label, sub.key, sub.chats.length, "chat-list-subgroup");
          chatListEl.appendChild(subHeader);
          if (!subCollapsed) {
            for (const item of sub.chats) {
              chatListEl.appendChild(renderChatItem(item, true));
            }
          }
        }
      }
    }
  }
}