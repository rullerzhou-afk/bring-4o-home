import { t, tArray } from "./i18n.js";

const CACHE_VERSION = 1;

export function loadLocalConversations() {
  try {
    const raw = localStorage.getItem("conversations");
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // 带版本号的新格式: { version: 1, data: [...] }
    if (parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed) {
      if (parsed.version === CACHE_VERSION && Array.isArray(parsed.data)) {
        return parsed.data;
      }
      // 版本不匹配，清空缓存重新从服务端拉取
      console.warn(`localStorage conversations cache version mismatch (${parsed.version} vs ${CACHE_VERSION}), cleared`);
      try {
        localStorage.removeItem("conversations");
      } catch (removeErr) {
        console.warn("Failed to remove stale cache:", removeErr);
      }
      return [];
    }

    // 旧格式（直接是数组）：迁移到新格式
    if (Array.isArray(parsed)) {
      console.info("Migrating localStorage conversations to versioned format");
      return parsed;
    }

    return [];
  } catch (err) {
    console.error("读取本地会话失败，已回退为空列表:", err);
    // 尝试清除损坏缓存，但不抛出异常（兼容 localStorage 完全不可用的环境）
    try {
      localStorage.removeItem("conversations");
    } catch (removeErr) {
      console.warn("Failed to remove corrupted cache:", removeErr);
    }
    return [];
  }
}

export const state = {
  conversations: loadLocalConversations(),
  currentConvId: null,
  isStreaming: false,
  pendingImages: [],
  pendingDocument: null, // { name, text, pages, truncated, originalChars, usedChars }
  currentConfig: null,
  activeStreamAbort: null, // 当前流式请求的 AbortController
  streamAbortedBySwitch: false, // 标记是否因切换对话而中止
  streamFollowRafId: null,
  manageMode: false, // 管理模式（批量选择）
  selectedIds: new Set(), // 管理模式选中的对话 ID
  collapsedGroups: new Set(), // 折叠的分组 key（如 "2025"、"2025-3"、"cur-1"）
  streamFollowObserver: null,
  memoryStore: null, // 记忆数据（设置面板编辑用）
  _groupsInitialized: false, // 对话列表分组是否已初始化折叠状态
};

export const messagesEl = document.getElementById("messages");
export const welcomeEl = document.getElementById("welcome");
export const inputEl = document.getElementById("user-input");
export const sendBtn = document.getElementById("send-btn");
export const newChatBtn = document.getElementById("new-chat");
export const chatListEl = document.getElementById("chat-list");
export const uploadBtn = document.getElementById("upload-btn");
export const imageInput = document.getElementById("image-input");
export const imagePreview = document.getElementById("image-preview");
export const documentPreview = document.getElementById("document-preview");
export const inputWrapper = document.getElementById("input-wrapper");
// Model picker trigger (old <select> replaced by custom dropdown)
export const modelPickerTrigger = document.getElementById("model-picker-trigger");
export const welcomeGreetingEl = document.getElementById("welcome-greeting");
export const manageBtn = document.getElementById("manage-btn");
export const batchBar = document.getElementById("batch-bar");
export const batchSelectAll = document.getElementById("batch-select-all");
export const batchCount = document.getElementById("batch-count");
export const batchDeleteBtn = document.getElementById("batch-delete-btn");
export const batchCancelBtn = document.getElementById("batch-cancel-btn");
export const plusMenu = document.getElementById("plus-menu");

export function randomGreeting() {
  const userName = state.currentConfig?.user_name;
  if (userName) {
    const arr = tArray("greet_personal", 6);
    const tmpl = arr[Math.floor(Math.random() * arr.length)];
    return tmpl.replace("{name}", () => userName);
  }
  const arr = tArray("greet", 10);
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getCurrentConv() {
  return state.conversations.find((c) => c.id === state.currentConvId);
}