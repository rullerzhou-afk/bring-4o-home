import { state, modelSelector, inputEl, welcomeGreetingEl, getCurrentConv, randomGreeting } from "./state.js";
import { apiFetch, readErrorMessage } from "./api.js";
import { initImportTab } from "./import.js";
import { CATEGORY_LABELS } from "./render.js";

const settingsBtn = document.getElementById("settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsClose = document.getElementById("settings-close");
const editSystem = document.getElementById("edit-system");
const editMemory = document.getElementById("edit-memory");
const memoryPanel = document.getElementById("memory-panel");
const memoryStructured = document.getElementById("memory-structured");
const editConfig = document.getElementById("edit-config");
const editImport = document.getElementById("edit-import");
const savePromptsBtn = document.getElementById("save-prompts");
const resetDefaultsBtn = document.getElementById("reset-defaults");
const saveStatus = document.getElementById("save-status");
const tabs = document.querySelectorAll("#settings-tabs .tab");

// 模型参数控件
const configModel = document.getElementById("config-model");
const configTemp = document.getElementById("config-temp");
const configTopP = document.getElementById("config-topp");
const configPP = document.getElementById("config-pp");
const configFP = document.getElementById("config-fp");
const configCtx = document.getElementById("config-ctx");
const tempVal = document.getElementById("temp-val");
const toppVal = document.getElementById("topp-val");
const ppVal = document.getElementById("pp-val");
const fpVal = document.getElementById("fp-val");
const ctxVal = document.getElementById("ctx-val");
const currentModelDisplay = document.getElementById("current-model-display");

// 个性化控件
const configAiName = document.getElementById("config-ai-name");
const configUserName = document.getElementById("config-user-name");
const showMemoryRefsCheckbox = document.getElementById("show-memory-refs");

// 衰减控件
const configAutoDecay = document.getElementById("config-auto-decay");
const configDecayDays = document.getElementById("config-decay-days");
const decayDaysVal = document.getElementById("decay-days-val");

// 摘要压缩控件
const configAutoCompress = document.getElementById("config-auto-compress");
const configKeepRecent = document.getElementById("config-keep-recent");
const keepRecentVal = document.getElementById("keep-recent-val");

// 记忆添加控件
const memoryAddCategory = document.getElementById("memory-add-category");
const memoryAddText = document.getElementById("memory-add-text");
const memoryAddBtn = document.getElementById("memory-add-btn");

// 记忆工具栏控件
const memorySearch = document.getElementById("memory-search");
const memorySearchClear = document.getElementById("memory-search-clear");
const memoryExportBtn = document.getElementById("memory-export-btn");
const memoryImportBtn = document.getElementById("memory-import-btn");
const memoryImportFile = document.getElementById("memory-import-file");

const IMPORTANCE_STARS = { 1: "\u2605", 2: "\u2605\u2605", 3: "\u2605\u2605\u2605" };
const IMPORTANCE_LABELS = { 1: "\u4e34\u65f6", 2: "\u4e00\u822c", 3: "\u6838\u5fc3" };

// 人格版本管理控件
const systemToolbar = document.getElementById("system-toolbar");
const insertTemplateBtn = document.getElementById("insert-template-btn");
const toggleVersionsBtn = document.getElementById("toggle-versions-btn");
const versionHistory = document.getElementById("version-history");
const versionList = document.getElementById("version-list");
const diffOverlay = document.getElementById("diff-overlay");
const diffCurrent = document.getElementById("diff-current");
const diffOld = document.getElementById("diff-old");
const diffVersionInfo = document.getElementById("diff-version-info");
const diffClose = document.getElementById("diff-close");
const diffRestoreBtn = document.getElementById("diff-restore-btn");
const diffCancelBtn = document.getElementById("diff-cancel-btn");

const saveVersionBtn = document.getElementById("save-version-btn");

let versionsLoaded = false;
let currentDiffTs = null;
let diffRequestSeq = 0;
let historyRequestSeq = 0;

// 滑块实时显示数值
configTemp.addEventListener("input", () => (tempVal.textContent = configTemp.value));
configTopP.addEventListener("input", () => (toppVal.textContent = configTopP.value));
configPP.addEventListener("input", () => (ppVal.textContent = configPP.value));
configFP.addEventListener("input", () => (fpVal.textContent = configFP.value));
configCtx.addEventListener("input", () => (ctxVal.textContent = configCtx.value));
configDecayDays.addEventListener("input", () => (decayDaysVal.textContent = configDecayDays.value));
configKeepRecent.addEventListener("input", () => (keepRecentVal.textContent = configKeepRecent.value));

// ===== 结构化记忆 UI =====

function renderMemoryList(store) {
  if (!store) return;
  state.memoryStore = store;

  for (const category of ["identity", "preferences", "events"]) {
    const container = memoryStructured.querySelector(`.memory-category[data-category="${category}"] .memory-items`);
    if (!container) continue;

    const items = store[category] || [];
    if (items.length === 0) {
      container.innerHTML = `<p class="memory-empty">暂无${CATEGORY_LABELS[category]}记录</p>`;
      continue;
    }

    container.innerHTML = items
      .map(
        (item) => {
          const imp = item.importance || 2;
          const stars = IMPORTANCE_STARS[imp] || IMPORTANCE_STARS[2];
          const label = IMPORTANCE_LABELS[imp] || "";
          const useCountHtml = item.useCount > 0
            ? `<span class="memory-use-count">\u00d7${item.useCount}</span>`
            : "";
          return `<div class="memory-item${item.stale ? ' memory-stale' : ''}" data-id="${item.id}" data-category="${category}">
            <span class="memory-importance" data-level="${imp}" title="${label}">${stars}</span>
            <span class="memory-text">${escapeHtml(item.text)}</span>
            ${useCountHtml}
            <span class="memory-date">${item.date}</span>
            <button class="memory-delete-btn" title="删除">&times;</button>
          </div>`;
        }
      )
      .join("");
  }

  // 如果搜索框有内容，重新触发过滤
  if (memorySearch && memorySearch.value.trim()) {
    applyMemoryFilter(memorySearch.value.trim().toLowerCase());
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 删除记忆项（事件委托）
memoryStructured.addEventListener("click", (e) => {
  const btn = e.target.closest(".memory-delete-btn");
  if (!btn) return;

  const itemEl = btn.closest(".memory-item");
  if (!itemEl || !state.memoryStore) return;

  const id = itemEl.dataset.id;
  const category = itemEl.dataset.category;

  const arr = state.memoryStore[category];
  if (!arr) return;

  const idx = arr.findIndex((item) => item.id === id);
  if (idx !== -1) {
    arr.splice(idx, 1);
    renderMemoryList(state.memoryStore);
  }
});

// 添加记忆项
function addMemoryItem() {
  const text = memoryAddText.value.trim();
  if (!text) return;
  if (Array.from(text).length > 80) {
    memoryAddText.setCustomValidity("最多80字");
    memoryAddText.reportValidity();
    return;
  }

  if (!state.memoryStore) {
    state.memoryStore = { version: 1, identity: [], preferences: [], events: [] };
  }

  const category = memoryAddCategory.value;
  const today = new Date().toISOString().slice(0, 10);

  state.memoryStore[category].push({
    id: `m_${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`,
    text,
    date: today,
    source: "user_stated",
    importance: 2,
    useCount: 0,
    lastReferencedAt: null,
  });

  memoryAddText.value = "";
  memoryAddText.setCustomValidity("");
  renderMemoryList(state.memoryStore);
}

memoryAddBtn.addEventListener("click", addMemoryItem);
memoryAddText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addMemoryItem();
  }
});

// ===== 记忆搜索过滤 =====

function applyMemoryFilter(query) {
  const items = memoryStructured.querySelectorAll(".memory-item");
  items.forEach((el) => {
    const text = el.querySelector(".memory-text")?.textContent?.toLowerCase() || "";
    el.classList.toggle("memory-filtered", !!query && !text.includes(query));
  });
  // 隐藏全部条目都被过滤的 category
  memoryStructured.querySelectorAll(".memory-category").forEach((cat) => {
    const visible = cat.querySelectorAll(".memory-item:not(.memory-filtered)");
    cat.classList.toggle("memory-filtered", !!query && visible.length === 0);
  });
}

memorySearch.addEventListener("input", () => {
  const q = memorySearch.value.trim().toLowerCase();
  memorySearchClear.classList.toggle("hidden", !q);
  applyMemoryFilter(q);
});

memorySearchClear.addEventListener("click", () => {
  memorySearch.value = "";
  memorySearchClear.classList.add("hidden");
  applyMemoryFilter("");
});

// ===== 记忆导出 =====

memoryExportBtn.addEventListener("click", () => {
  if (!state.memoryStore) {
    saveStatus.textContent = "没有记忆可导出";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
    return;
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    identity: state.memoryStore.identity || [],
    preferences: state.memoryStore.preferences || [],
    events: state.memoryStore.events || [],
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `memoria-memory-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ===== 记忆导入 =====

memoryImportBtn.addEventListener("click", () => {
  memoryImportFile.click();
});

memoryImportFile.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  memoryImportFile.value = ""; // 允许重复选同文件

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      // 校验：至少要有可解析的记忆条目
      const categories = ["identity", "preferences", "events"];
      const hasItems = categories.some((c) => Array.isArray(data[c]) && data[c].length > 0);
      if (!hasItems) {
        alert("导入失败：JSON 文件中没有找到有效的记忆条目（需要 identity / preferences / events 数组）");
        return;
      }

      // 校验每条都有 text
      for (const cat of categories) {
        if (!Array.isArray(data[cat])) continue;
        for (const item of data[cat]) {
          if (!item.text || typeof item.text !== "string") {
            alert(`导入失败：${cat} 中有条目缺少 text 字段`);
            return;
          }
        }
      }

      const replace = confirm(
        `检测到 ${categories.reduce((n, c) => n + (data[c]?.length || 0), 0)} 条记忆。\n\n「确定」= 替换现有记忆\n「取消」= 合并（追加不重复条目）`
      );

      if (!state.memoryStore) {
        state.memoryStore = { version: 1, identity: [], preferences: [], events: [] };
      }

      const normalizeItems = (items, offset) => {
        const now = Date.now();
        return items.map((item, i) => ({
          id: item.id || `m_${now + offset + i}${String(i % 1000).padStart(3, "0")}`,
          text: item.text,
          date: item.date || new Date().toISOString().slice(0, 10),
          source: item.source || "user_stated",
          importance: item.importance || 2,
          useCount: item.useCount || 0,
          lastReferencedAt: item.lastReferencedAt || null,
          stale: item.stale || false,
        }));
      };

      let counter = 0;
      for (const cat of categories) {
        const incoming = Array.isArray(data[cat]) ? normalizeItems(data[cat], counter) : [];
        counter += incoming.length;

        if (replace) {
          state.memoryStore[cat] = incoming;
        } else {
          // 合并：按 text 去重
          const existing = state.memoryStore[cat] || [];
          const existingTexts = new Set(existing.map((m) => m.text));
          const newItems = incoming.filter((m) => !existingTexts.has(m.text));
          state.memoryStore[cat] = existing.concat(newItems);
        }
      }

      renderMemoryList(state.memoryStore);
      saveStatus.textContent = replace ? "已替换记忆，请点保存生效" : "已合并记忆，请点保存生效";
    } catch (err) {
      alert("导入失败：JSON 解析错误 — " + err.message);
    }
  };
  reader.readAsText(file);
});

export async function loadConfigPanel() {
  try {
    const [modelsRes, configRes] = await Promise.all([
      apiFetch("/api/models"),
      apiFetch("/api/config"),
    ]);
    if (!modelsRes.ok) throw new Error(await readErrorMessage(modelsRes));
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));
    const models = await modelsRes.json();
    const config = await configRes.json();
    state.currentConfig = config;

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

    // 填充个性化字段
    configAiName.value = config.ai_name || "";
    configUserName.value = config.user_name || "";
    // 填充参数
    configTemp.value = config.temperature ?? 1;
    tempVal.textContent = configTemp.value;
    configTopP.value = config.top_p ?? 1;
    toppVal.textContent = configTopP.value;
    configPP.value = config.presence_penalty ?? 0;
    ppVal.textContent = configPP.value;
    configFP.value = config.frequency_penalty ?? 0;
    fpVal.textContent = configFP.value;
    configCtx.value = config.context_window ?? 50;
    ctxVal.textContent = config.context_window ?? 50;

    // 衰减设置
    configAutoDecay.checked = config.memory?.autoDecay ?? false;
    configDecayDays.value = config.memory?.decayIdleDays ?? 30;
    decayDaysVal.textContent = config.memory?.decayIdleDays ?? 30;

    // 摘要压缩设置
    configAutoCompress.checked = config.auto_compress ?? false;
    configKeepRecent.value = config.compress_keep_recent ?? 10;
    keepRecentVal.textContent = config.compress_keep_recent ?? 10;
  } catch (err) {
    console.error("加载配置失败:", err);
  }
}

// 记忆引用开关（localStorage，实时生效）
showMemoryRefsCheckbox.checked = localStorage.getItem("showMemoryRefs") !== "false";
// 页面加载时根据初始状态设置 class
if (!showMemoryRefsCheckbox.checked) {
  document.body.classList.add("hide-memory-refs");
}
showMemoryRefsCheckbox.addEventListener("change", () => {
  localStorage.setItem("showMemoryRefs", showMemoryRefsCheckbox.checked ? "true" : "false");
  document.body.classList.toggle("hide-memory-refs", !showMemoryRefsCheckbox.checked);
});

// 打开设置
settingsBtn.addEventListener("click", async () => {
  settingsOverlay.classList.remove("hidden");
  saveStatus.textContent = "";
  showMemoryRefsCheckbox.checked = localStorage.getItem("showMemoryRefs") !== "false";
  try {
    const res = await apiFetch("/api/prompts");
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    editSystem.value = data.system || "";
    editMemory.value = data.memory || "";

    // 加载结构化记忆
    if (data.memoryStore) {
      renderMemoryList(data.memoryStore);
    }
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
    const isSystem = target === "system";
    editSystem.classList.toggle("hidden", !isSystem);
    systemToolbar.classList.toggle("hidden", !isSystem);
    // 版本历史：仅在 system tab 且已展开时显示
    if (!isSystem) {
      versionHistory.classList.add("hidden");
    } else if (toggleVersionsBtn.classList.contains("active")) {
      versionHistory.classList.remove("hidden");
    }
    memoryPanel.classList.toggle("hidden", target !== "memory");
    editConfig.classList.toggle("hidden", target !== "config");
    editImport.classList.toggle("hidden", target !== "import");
    if (target === "import") initImportTab();
  });
});

// 保存
savePromptsBtn.addEventListener("click", async () => {
  saveStatus.textContent = "保存中...";
  try {
    // 保存 prompt 文件（发送 memoryStore 替代纯文本 memory）
    const promptBody = { system: editSystem.value };
    if (state.memoryStore) {
      promptBody.memoryStore = state.memoryStore;
    }

    const promptsRes = await apiFetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promptBody),
    });
    if (!promptsRes.ok) throw new Error(await readErrorMessage(promptsRes));

    // 保存模型配置（含个性化字段）
    const configBody = {
      model: configModel.value,
      temperature: parseFloat(configTemp.value),
      top_p: parseFloat(configTopP.value),
      presence_penalty: parseFloat(configPP.value),
      frequency_penalty: parseFloat(configFP.value),
      context_window: parseInt(configCtx.value, 10),
      ai_name: configAiName.value.trim(),
      user_name: configUserName.value.trim(),
      auto_compress: configAutoCompress.checked,
      compress_keep_recent: parseInt(configKeepRecent.value, 10),
      memory: {
        autoDecay: configAutoDecay.checked,
        decayIdleDays: parseInt(configDecayDays.value, 10),
      },
    };
    const configRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configBody),
    });
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));
    state.currentConfig = { ...(state.currentConfig || {}), ...configBody };

    // 同步顶栏模型选择器
    if (modelSelector.value !== configModel.value) {
      modelSelector.value = configModel.value;
    }

    applyPersonalization();
    saveStatus.textContent = "已保存";
    setTimeout(() => (saveStatus.textContent = ""), 2000);

  } catch (err) {
    saveStatus.textContent = "保存失败: " + err.message;
  }
});

// 恢复默认
resetDefaultsBtn.addEventListener("click", async () => {
  if (!confirm("确定要恢复所有设置为默认值吗？\n\n人格指令、长期记忆和模型参数将被重置，已导入的对话不受影响。")) return;
  saveStatus.textContent = "恢复中...";
  try {
    const res = await apiFetch("/api/settings/reset", { method: "POST" });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();

    // 更新 prompt 编辑器
    editSystem.value = data.system;
    editMemory.value = data.memory || "";

    // 更新结构化记忆
    if (data.memoryStore) {
      renderMemoryList(data.memoryStore);
    } else {
      renderMemoryList({ version: 1, identity: [], preferences: [], events: [] });
    }

    // 更新 config sliders
    state.currentConfig = data.config;
    configTemp.value = data.config.temperature;
    tempVal.textContent = data.config.temperature;
    configTopP.value = data.config.top_p ?? 1;
    toppVal.textContent = data.config.top_p ?? 1;
    configPP.value = data.config.presence_penalty;
    ppVal.textContent = data.config.presence_penalty;
    configFP.value = data.config.frequency_penalty;
    fpVal.textContent = data.config.frequency_penalty;
    configCtx.value = data.config.context_window;
    ctxVal.textContent = data.config.context_window;

    // 清空个性化字段
    configAiName.value = "";
    configUserName.value = "";

    // 同步模型下拉框
    configModel.value = data.config.model;
    modelSelector.value = data.config.model;
    currentModelDisplay.textContent = "当前模型: " + data.config.model;

    applyPersonalization();
    saveStatus.textContent = "已恢复默认";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    saveStatus.textContent = "重置失败: " + err.message;
  }
});

export async function loadModelSelector() {
  try {
    const [modelsRes, configRes] = await Promise.all([
      apiFetch("/api/models"),
      apiFetch("/api/config"),
    ]);
    if (!modelsRes.ok || !configRes.ok) return;
    const models = await modelsRes.json();
    const config = await configRes.json();
    state.currentConfig = config;

    modelSelector.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === config.model) opt.selected = true;
      modelSelector.appendChild(opt);
    });
    applyPersonalization();
  } catch (err) {
    console.error("加载模型列表失败:", err);
  }
}

modelSelector.addEventListener("change", async () => {
  try {
    const saveRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSelector.value }),
    });
    if (!saveRes.ok) throw new Error("保存失败");
    const data = await saveRes.json();
    state.currentConfig = data.config;

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

// ===== 人格版本管理 =====

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatAbsoluteTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderVersionList(versions) {
  if (!versions || versions.length === 0) {
    versionList.innerHTML = `<p class="version-empty">尚无历史版本，保存人格指令后自动创建</p>`;
    return;
  }

  versionList.innerHTML = versions
    .map(
      (v) =>
        `<div class="version-item" data-ts="${escapeHtml(v.ts)}">
          <div class="version-dot"></div>
          <div class="version-info">
            <div class="version-time" title="${escapeHtml(formatAbsoluteTime(v.timestamp))}">${escapeHtml(formatRelativeTime(v.timestamp))}</div>
            <div class="version-preview">${escapeHtml((v.systemPreview || "").slice(0, 60))}</div>
          </div>
          <div class="version-actions">
            <button class="version-action-btn diff-btn" data-ts="${escapeHtml(v.ts)}" type="button">对比</button>
            <button class="version-action-btn restore-btn" data-ts="${escapeHtml(v.ts)}" data-time="${escapeHtml(formatRelativeTime(v.timestamp))}" type="button">恢复</button>
            <button class="version-action-btn delete-version-btn" data-ts="${escapeHtml(v.ts)}" type="button" title="删除此版本">&times;</button>
          </div>
        </div>`
    )
    .join("");
}

async function loadVersionHistory(force = false) {
  if (versionsLoaded && !force) return;
  const seq = ++historyRequestSeq;
  versionList.innerHTML = `<p class="version-loading">加载中...</p>`;
  try {
    const res = await apiFetch("/api/prompts/versions");
    if (seq !== historyRequestSeq) return; // 被更新的请求取代
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const versions = await res.json();
    if (seq !== historyRequestSeq) return;
    renderVersionList(versions);
    versionsLoaded = true;
  } catch (err) {
    if (seq !== historyRequestSeq) return;
    versionList.innerHTML = `<p class="version-empty">加载失败: ${escapeHtml(err.message)}</p>`;
  }
}

async function showDiff(ts) {
  const seq = ++diffRequestSeq;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}`);
    if (!res.ok) throw new Error(await readErrorMessage(res));
    if (seq !== diffRequestSeq) return; // 被更新的请求取代，丢弃
    const version = await res.json();

    diffCurrent.textContent = editSystem.value || "(空)";
    diffOld.textContent = version.system || "(空)";
    diffVersionInfo.textContent = formatAbsoluteTime(version.timestamp) + " 的版本";
    currentDiffTs = ts;
    diffOverlay.classList.remove("hidden");
  } catch (err) {
    if (seq !== diffRequestSeq) return;
    alert("加载版本详情失败: " + err.message);
  }
}

async function restoreVersion(ts, label) {
  const msg = `确定恢复到${label || "此"}版本吗？\n\n当前状态会自动备份，恢复后可随时找回。`;
  if (!confirm(msg)) return;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}/restore`, { method: "POST" });
    if (!res.ok) throw new Error(await readErrorMessage(res));

    // 重新加载当前人格指令 + 记忆（同步 memoryStore 防止下次保存覆盖）
    const promptsRes = await apiFetch("/api/prompts");
    if (!promptsRes.ok) throw new Error("恢复成功但刷新数据失败，请刷新页面");
    const data = await promptsRes.json();
    editSystem.value = data.system || "";
    if (data.memoryStore) {
      renderMemoryList(data.memoryStore);
    }

    // 刷新版本列表
    loadVersionHistory(true);

    // 关闭 diff overlay（如果是从 diff 里点的恢复）
    diffOverlay.classList.add("hidden");
    currentDiffTs = null;

    saveStatus.textContent = "已恢复";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    alert("恢复失败: " + err.message);
  }
}

// 手动保存版本
saveVersionBtn.addEventListener("click", async () => {
  saveVersionBtn.disabled = true;
  try {
    // 先保存当前内容到服务端
    const promptBody = { system: editSystem.value };
    if (state.memoryStore) promptBody.memoryStore = state.memoryStore;
    const saveRes = await apiFetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promptBody),
    });
    if (!saveRes.ok) throw new Error(await readErrorMessage(saveRes));

    // 再调用备份接口
    const res = await apiFetch("/api/prompts/backup", { method: "POST" });
    if (!res.ok) throw new Error(await readErrorMessage(res));

    saveStatus.textContent = "版本已保存";
    setTimeout(() => (saveStatus.textContent = ""), 2000);

    // 刷新版本列表
    if (toggleVersionsBtn.classList.contains("active")) {
      loadVersionHistory(true);
    } else {
      versionsLoaded = false;
    }
  } catch (err) {
    saveStatus.textContent = "保存版本失败: " + err.message;
  } finally {
    saveVersionBtn.disabled = false;
  }
});

async function deleteVersion(ts) {
  if (!confirm("确定删除此版本？删除后无法恢复。")) return;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    loadVersionHistory(true);
  } catch (err) {
    alert("删除失败: " + err.message);
  }
}

// 版本历史展开/收起
toggleVersionsBtn.addEventListener("click", () => {
  const isExpanding = !toggleVersionsBtn.classList.contains("active");
  toggleVersionsBtn.classList.toggle("active", isExpanding);
  versionHistory.classList.toggle("hidden", !isExpanding);
  if (isExpanding) loadVersionHistory();
});

// 版本列表事件委托（对比 / 恢复）
versionList.addEventListener("click", (e) => {
  const diffBtn = e.target.closest(".diff-btn");
  if (diffBtn) {
    showDiff(diffBtn.dataset.ts);
    return;
  }
  const restoreBtn = e.target.closest(".restore-btn");
  if (restoreBtn) {
    restoreVersion(restoreBtn.dataset.ts, restoreBtn.dataset.time);
    return;
  }
  const deleteBtn = e.target.closest(".delete-version-btn");
  if (deleteBtn) {
    deleteVersion(deleteBtn.dataset.ts);
  }
});

// Diff overlay 关闭
function closeDiffOverlay() {
  diffOverlay.classList.add("hidden");
  currentDiffTs = null;
  diffRequestSeq++; // 作废飞行中的 showDiff 请求
}

diffClose.addEventListener("click", closeDiffOverlay);
diffCancelBtn.addEventListener("click", closeDiffOverlay);
diffOverlay.addEventListener("click", (e) => {
  if (e.target === diffOverlay) closeDiffOverlay();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!diffOverlay.classList.contains("hidden")) {
      closeDiffOverlay();
      e.stopPropagation();
    }
  }
});

// Diff overlay 恢复按钮
diffRestoreBtn.addEventListener("click", () => {
  if (currentDiffTs) restoreVersion(currentDiffTs);
});

// ===== 插入模板 =====

insertTemplateBtn.addEventListener("click", async () => {
  if (editSystem.value.trim() && !confirm("这会覆盖你现在写的人格指令，要继续吗？")) return;
  try {
    const res = await apiFetch("/api/prompts/template");
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    editSystem.value = data.system || "";
    editSystem.focus();
  } catch (err) {
    alert("加载模板失败: " + err.message);
  }
});

// ===== 个性化：实时应用 =====
export function applyPersonalization() {
  const aiName = state.currentConfig?.ai_name;
  inputEl.placeholder = aiName ? `给 ${aiName} 发消息...` : "给 4o 发消息...";

  const conv = getCurrentConv();
  if (!conv || !conv.messages?.length) {
    welcomeGreetingEl.textContent = randomGreeting();
  }
}
