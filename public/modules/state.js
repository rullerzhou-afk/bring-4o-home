export function loadLocalConversations() {
  try {
    const raw = localStorage.getItem("conversations");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("读取本地会话失败，已回退为空列表:", err);
    return [];
  }
}

export const state = {
  conversations: loadLocalConversations(),
  currentConvId: null,
  isStreaming: false,
  pendingImages: [],
  currentConfig: null,
  activeStreamAbort: null, // 当前流式请求的 AbortController
  streamAbortedBySwitch: false, // 标记是否因切换对话而中止
  streamFollowRafId: null,
  manageMode: false, // 管理模式（批量选择）
  selectedIds: new Set(), // 管理模式选中的对话 ID
  collapsedGroups: new Set(), // 折叠的分组 key（如 "2025"、"2025-3"、"cur-1"）
  streamFollowObserver: null,
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
export const inputWrapper = document.getElementById("input-wrapper");
export const modelSelector = document.getElementById("model-selector");
export const welcomeGreetingEl = document.getElementById("welcome-greeting");
export const manageBtn = document.getElementById("manage-btn");
export const batchBar = document.getElementById("batch-bar");
export const batchSelectAll = document.getElementById("batch-select-all");
export const batchCount = document.getElementById("batch-count");
export const batchDeleteBtn = document.getElementById("batch-delete-btn");
export const batchCancelBtn = document.getElementById("batch-cancel-btn");

export const WELCOME_GREETINGS = [
  "今天想聊点什么？",
  "有什么我能帮忙的？",
  "又来找我啦，说吧～",
  "有什么新鲜事想分享吗？",
  "想聊天还是想搞事情？",
  "我在呢，有话直说～",
  "来了来了，什么事？",
  "今天心情怎么样？",
  "需要我做什么尽管开口～",
  "嗨，准备好了随时开始！",
];

export const PERSONAL_GREETINGS = [
  "{name}，今天想聊点什么？",
  "{name}又来找我啦～",
  "{name}，有什么新鲜事？",
  "{name}，说吧，什么事？",
  "嗨{name}，准备好了随时开始！",
  "{name}，今天心情怎么样？",
];

export function randomGreeting() {
  const userName = state.currentConfig?.user_name;
  if (userName) {
    const tmpl = PERSONAL_GREETINGS[Math.floor(Math.random() * PERSONAL_GREETINGS.length)];
    return tmpl.replace("{name}", userName);
  }
  return WELCOME_GREETINGS[Math.floor(Math.random() * WELCOME_GREETINGS.length)];
}

export function getCurrentConv() {
  return state.conversations.find((c) => c.id === state.currentConvId);
}