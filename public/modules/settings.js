import { state, inputEl, welcomeGreetingEl, getCurrentConv, randomGreeting } from "./state.js";
import { apiFetch, readErrorMessage, showToast, escapeHtml } from "./api.js";
import { initImportTab } from "./import.js";
import { getCategoryLabel, MEMORY_CATEGORIES } from "./render.js";
import { t, getLang, setLang, getLocale } from "./i18n.js";
import { initModelPicker, setModels as setPickerModels, getSelectedModel, setSelectedModel } from "./model-picker.js";

// 短时请求缓存：避免 loadModelSelector 和 loadConfigPanel 重复请求 /api/models + /api/config
const _apiCache = new Map();
const API_CACHE_TTL = 2000; // 2 秒

function cachedApiFetch(url) {
  const cached = _apiCache.get(url);
  if (cached && Date.now() - cached.time < API_CACHE_TTL) {
    return cached.promise;
  }
  const promise = apiFetch(url).then(async (res) => {
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return res.json();
  });
  _apiCache.set(url, { promise, time: Date.now() });
  promise.catch(() => _apiCache.delete(url));
  return promise;
}

const settingsBtn = document.getElementById("settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsClose = document.getElementById("settings-close");
const editSystem = document.getElementById("edit-system");
const editMemory = document.getElementById("edit-memory");
const memoryPanel = document.getElementById("memory-panel");
const memoryStructured = document.getElementById("memory-structured");
const editConfig = document.getElementById("edit-config");
const editImport = document.getElementById("edit-import");
const editVoice = document.getElementById("edit-voice");
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
const configLanguage = document.getElementById("config-language");
const configAiName = document.getElementById("config-ai-name");
const configUserName = document.getElementById("config-user-name");
const showMemoryRefsCheckbox = document.getElementById("show-memory-refs");

// 衰减控件
const configAutoDecay = document.getElementById("config-auto-decay");
const configDecayDays = document.getElementById("config-decay-days");
const decayDaysVal = document.getElementById("decay-days-val");

// 晋升/降级控件
const configAutoPromotion = document.getElementById("config-auto-promotion");

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
const memoryReflectBtn = document.getElementById("memory-reflect-btn");
const memoryExportBtn = document.getElementById("memory-export-btn");
const memoryImportBtn = document.getElementById("memory-import-btn");
const memoryImportFile = document.getElementById("memory-import-file");
const memoryTimelineBtn = document.getElementById("memory-timeline-btn");
const memoryTimeline = document.getElementById("memory-timeline");
const timelineList = document.getElementById("timeline-list");
const timelineClearBtn = document.getElementById("timeline-clear-btn");

const IMPORTANCE_STARS = { 1: "\u2605", 2: "\u2605\u2605", 3: "\u2605\u2605\u2605" };
function getImportanceLabel(level) { return t("label_importance_" + level); }

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

  for (const category of MEMORY_CATEGORIES) {
    const container = memoryStructured.querySelector(`.memory-category[data-category="${category}"] .memory-items`);
    if (!container) continue;

    const items = store[category] || [];
    if (items.length === 0) {
      container.innerHTML = `<p class="memory-empty">${t("label_no_memory", { cat: getCategoryLabel(category) })}</p>`;
      continue;
    }

    container.innerHTML = items
      .map(
        (item) => {
          const imp = item.importance || 2;
          const stars = IMPORTANCE_STARS[imp] || IMPORTANCE_STARS[2];
          const label = getImportanceLabel(imp);
          const useCountHtml = item.useCount > 0
            ? `<span class="memory-use-count">\u00d7${item.useCount}</span>`
            : "";
          return `<div class="memory-item${item.stale ? ' memory-stale' : ''}" data-id="${escapeHtml(String(item.id))}" data-category="${category}">
            <span class="memory-importance" data-level="${imp}" title="${label}">${stars}</span>
            <span class="memory-text">${escapeHtml(item.text)}</span>
            ${useCountHtml}
            <span class="memory-date">${item.date}</span>
            <button class="memory-delete-btn" title="${t("title_delete")}">&times;</button>
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
    memoryAddText.setCustomValidity(t("err_max_80"));
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

// ===== 记忆整合（反思） =====

memoryReflectBtn.addEventListener("click", async () => {
  if (memoryReflectBtn.classList.contains("loading")) return;
  memoryReflectBtn.classList.add("loading");
  try {
    const res = await apiFetch("/api/memory/reflect", { method: "POST" });
    if (!res.ok) {
      const errMsg = await readErrorMessage(res).catch(() => `HTTP ${res.status}`);
      showToast(errMsg);
      return;
    }
    const data = await res.json();
    if (data.skipped === "not_enough_events") {
      showToast(t("toast_reflect_not_enough"), "warning");
      return;
    }
    if (data.skipped === "no_patterns") {
      showToast(t("toast_reflect_no_patterns"), "warning");
      return;
    }
    if (data.skipped === "over_limit") {
      showToast(t("toast_reflect_over_limit"), "warning");
      return;
    }
    if (data.insights?.length > 0) {
      showToast(t("toast_reflect_success", { count: data.insights.length }), "success");
      // 刷新记忆列表
      const storeRes = await apiFetch("/api/prompts");
      if (storeRes.ok) {
        const storeData = await storeRes.json();
        if (storeData.memoryStore) {
          state.memoryStore = storeData.memoryStore;
          renderMemoryList(storeData.memoryStore);
        }
      }
    }
  } catch {
    showToast(t("toast_reflect_failed"));
  } finally {
    memoryReflectBtn.classList.remove("loading");
  }
});

// ===== 记忆时间线 =====

async function loadTimeline() {
  try {
    const res = await apiFetch("/api/memory/log?limit=200");
    if (!res.ok) throw new Error();
    const entries = await res.json();
    renderTimeline(entries);
  } catch {
    timelineList.innerHTML = `<div class="timeline-empty">${escapeHtml(t("timeline_load_failed"))}</div>`;
  }
}

function renderTimeline(entries) {
  if (!entries || entries.length === 0) {
    timelineList.innerHTML = `<div class="timeline-empty">${escapeHtml(t("timeline_empty"))}</div>`;
    return;
  }

  // Group by local date
  const groups = new Map();
  for (const entry of entries) {
    const d = new Date(entry.ts);
    const dayKey = d.toLocaleDateString(getLocale());
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey).push(entry);
  }

  let html = "";
  for (const [day, batches] of groups) {
    html += `<div class="timeline-day">${escapeHtml(day)}</div>`;
    for (const batch of batches) {
      const time = new Date(batch.ts).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
      let sourceHtml;
      if (batch.convId === "_reflect") {
        sourceHtml = `<span class="timeline-source source-reflect">${escapeHtml(t("timeline_from_reflect"))}</span>`;
      } else if (batch.convId === "_undo") {
        sourceHtml = `<span class="timeline-source source-undo">${escapeHtml(t("timeline_from_undo"))}</span>`;
      } else {
        const short = "#" + (batch.convId || "").slice(-4);
        sourceHtml = `<a class="timeline-source" href="#${escapeHtml(batch.convId)}">${escapeHtml(short)}</a>`;
      }

      let opsHtml = "";
      if (Array.isArray(batch.ops)) {
        for (const op of batch.ops) {
          const opType = op.dedupMerge ? "merge" : (op.op || "add");
          const opLabel = t("label_op_" + opType) || opType;
          const catLabel = op.category ? getCategoryLabel(op.category) : "";
          const text = op.text || op.targetId || "";
          opsHtml += `<div class="timeline-op">
            <span class="timeline-op-tag op-${escapeHtml(opType)}">${escapeHtml(opLabel)}</span>
            ${catLabel ? `<span class="timeline-cat">${escapeHtml(catLabel)}</span>` : ""}
            <span class="timeline-text">${escapeHtml(text)}</span>
          </div>`;
        }
      }

      html += `<div class="timeline-batch">
        <div class="timeline-batch-header">
          <span class="timeline-time">${escapeHtml(time)}</span>
          ${sourceHtml}
        </div>
        ${opsHtml}
      </div>`;
    }
  }

  timelineList.innerHTML = html;
}

memoryTimelineBtn.addEventListener("click", () => {
  const isHidden = memoryTimeline.classList.contains("hidden");
  memoryTimeline.classList.toggle("hidden");
  if (isHidden) {
    loadTimeline();
    // 滚动到"长期记忆"标题位置
    const sectionTitle = memoryPanel.querySelector('[data-i18n="section_long_term_memory"]');
    if (sectionTitle) {
      requestAnimationFrame(() => sectionTitle.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }
});

timelineClearBtn.addEventListener("click", async () => {
  if (!confirm(t("timeline_clear_confirm"))) return;
  try {
    await apiFetch("/api/memory/log", { method: "DELETE" });
    renderTimeline([]);
    showToast(t("timeline_clear_done"), "success");
  } catch {
    showToast(t("timeline_load_failed"));
  }
});

document.addEventListener("lang-changed", () => {
  if (memoryTimeline && !memoryTimeline.classList.contains("hidden")) {
    loadTimeline();
  }
});

// ===== 记忆导出 =====

memoryExportBtn.addEventListener("click", () => {
  if (!state.memoryStore) {
    saveStatus.textContent = t("label_no_memory_export");
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
      const hasItems = MEMORY_CATEGORIES.some((c) => Array.isArray(data[c]) && data[c].length > 0);
      if (!hasItems) {
        alert(t("mem_import_invalid"));
        return;
      }

      // 校验每条都有 text
      for (const cat of MEMORY_CATEGORIES) {
        if (!Array.isArray(data[cat])) continue;
        for (const item of data[cat]) {
          if (!item.text || typeof item.text !== "string") {
            alert(t("mem_import_missing_text", { cat }));
            return;
          }
        }
      }

      const totalCount = MEMORY_CATEGORIES.reduce((n, c) => n + (data[c]?.length || 0), 0);
      const replace = confirm(t("mem_import_confirm", { count: totalCount }));

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
      for (const cat of MEMORY_CATEGORIES) {
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
      saveStatus.textContent = replace ? t("label_memory_replaced") : t("label_memory_merged");
    } catch (err) {
      alert(t("mem_import_parse_error", { msg: err.message }));
    }
  };
  reader.readAsText(file);
});

export async function loadConfigPanel() {
  try {
    const [models, config] = await Promise.all([
      cachedApiFetch("/api/models"),
      cachedApiFetch("/api/config"),
    ]);
    state.currentConfig = config;

    // 显示当前模型
    currentModelDisplay.textContent = t("label_current_model", { model: config.model });

    // 填充模型下拉框
    const ids = modelIdsFromList(models);
    configModel.innerHTML = "";
    ids.forEach((m) => {
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

    // 晋升/降级设置
    configAutoPromotion.checked = config.memory?.autoPromotion ?? false;

    // 摘要压缩设置
    configAutoCompress.checked = config.auto_compress ?? false;
    configKeepRecent.value = config.compress_keep_recent ?? 10;
    keepRecentVal.textContent = config.compress_keep_recent ?? 10;

    // 语音设置
    _fillVoicePanel(config.voice || {});
  } catch (err) {
    console.error("加载配置失败:", err);
  }
}

// ===== 语音设置面板 =====
const voiceSttProvider = document.getElementById("voice-stt-provider");
const voiceTtsProvider = document.getElementById("voice-tts-provider");
const voiceTtsVoice = document.getElementById("voice-tts-voice");
const voiceTtsSpeed = document.getElementById("voice-tts-speed");
const voiceSpeedVal = document.getElementById("voice-speed-val");

const EDGE_VOICES = [
  { value: "zh-CN-YunxiNeural", label: "云溪 (男)" },
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女)" },
  { value: "zh-CN-YunyangNeural", label: "云扬 (男·新闻)" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 (女)" },
  { value: "zh-CN-YunjianNeural", label: "云健 (男)" },
  { value: "en-US-AndrewNeural", label: "Andrew (M)" },
  { value: "en-US-AriaNeural", label: "Aria (F)" },
  { value: "en-US-GuyNeural", label: "Guy (M)" },
  { value: "en-US-JennyNeural", label: "Jenny (F)" },
  { value: "ja-JP-NanamiNeural", label: "七海 (女)" },
];

const API_VOICES = [
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "fable", label: "Fable" },
  { value: "nova", label: "Nova" },
  { value: "onyx", label: "Onyx" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
];

function _updateVoiceOptions(provider, currentVoice) {
  const voices = provider === "edge" ? EDGE_VOICES : API_VOICES;
  voiceTtsVoice.innerHTML = "";
  for (const v of voices) {
    const opt = document.createElement("option");
    opt.value = v.value;
    opt.textContent = v.label;
    if (v.value === currentVoice) opt.selected = true;
    voiceTtsVoice.appendChild(opt);
  }
}

function _fillVoicePanel(voice) {
  if (voiceSttProvider) voiceSttProvider.value = voice.stt_provider || "browser";
  if (voiceTtsProvider) voiceTtsProvider.value = voice.tts_provider || "edge";
  if (voiceTtsSpeed) {
    voiceTtsSpeed.value = voice.tts_speed || 1.0;
    voiceSpeedVal.textContent = voiceTtsSpeed.value;
  }
  _updateVoiceOptions(voice.tts_provider || "edge", voice.tts_voice || "");
}

function _collectVoiceConfig() {
  return {
    stt_provider: voiceSttProvider?.value || "browser",
    tts_provider: voiceTtsProvider?.value || "edge",
    tts_voice: voiceTtsVoice?.value || "",
    tts_speed: parseFloat(voiceTtsSpeed?.value || "1.0"),
  };
}

function loadVoicePanel() {
  const voice = state.currentConfig?.voice || {};
  _fillVoicePanel(voice);
}

if (voiceTtsProvider) {
  voiceTtsProvider.addEventListener("change", () => {
    const currentVoice = voiceTtsVoice?.value || "";
    _updateVoiceOptions(voiceTtsProvider.value, currentVoice);
  });
}

if (voiceTtsSpeed) {
  voiceTtsSpeed.addEventListener("input", () => {
    voiceSpeedVal.textContent = voiceTtsSpeed.value;
  });
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
    editVoice.classList.toggle("hidden", target !== "voice");
    editImport.classList.toggle("hidden", target !== "import");
    if (target === "import") initImportTab();
    if (target === "voice") loadVoicePanel();
  });
});

// 保存
savePromptsBtn.addEventListener("click", async () => {
  saveStatus.textContent = t("status_saving");
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
      ...(configModel.value ? { model: configModel.value } : {}),
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
        autoPromotion: configAutoPromotion.checked,
        decayIdleDays: parseInt(configDecayDays.value, 10),
      },
      voice: _collectVoiceConfig(),
    };
    const configRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configBody),
    });
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));
    state.currentConfig = { ...(state.currentConfig || {}), ...configBody };

    // 同步顶栏 model picker
    if (getSelectedModel() !== configModel.value) {
      setSelectedModel(configModel.value);
    }

    applyPersonalization();
    saveStatus.textContent = t("status_saved");
    setTimeout(() => (saveStatus.textContent = ""), 2000);

  } catch (err) {
    saveStatus.textContent = t("status_save_failed", { msg: err.message });
  }
});

// 恢复默认
resetDefaultsBtn.addEventListener("click", async () => {
  if (!confirm(t("confirm_reset"))) return;
  saveStatus.textContent = t("status_restoring");
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
    setSelectedModel(data.config.model);
    currentModelDisplay.textContent = t("label_current_model", { model: data.config.model });

    applyPersonalization();
    saveStatus.textContent = t("status_restored");
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    saveStatus.textContent = t("status_reset_failed", { msg: err.message });
  }
});

// ===== Model picker (顶栏) =====

// models API 现在返回 [{ id, provider }]，提取 id 数组给 <select>
function modelIdsFromList(models) {
  if (!Array.isArray(models) || models.length === 0) return [];
  // 兼容旧格式（纯字符串数组）和新格式（对象数组）
  return models.map(m => typeof m === "string" ? m : m.id);
}

initModelPicker(async (modelId) => {
  try {
    const saveRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
    });
    if (!saveRes.ok) throw new Error(t("err_save_failed"));
    const data = await saveRes.json();
    state.currentConfig = data.config;

    // 同步设置面板的模型下拉框
    if (configModel.value !== modelId) configModel.value = modelId;
    currentModelDisplay.textContent = t("label_current_model", { model: modelId });
  } catch (err) {
    console.error("切换模型失败:", err);
  }
});

export async function loadModelSelector() {
  try {
    const [models, config] = await Promise.all([
      cachedApiFetch("/api/models"),
      cachedApiFetch("/api/config"),
    ]);
    state.currentConfig = config;

    // 顶栏 picker
    setPickerModels(models);
    setSelectedModel(config.model, true);

    // 设置面板 <select>
    const ids = modelIdsFromList(models);
    configModel.innerHTML = "";
    ids.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === config.model) opt.selected = true;
      configModel.appendChild(opt);
    });

    applyPersonalization();
  } catch (err) {
    console.error("加载模型列表失败:", err);
  }
}

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

  if (minutes < 1) return t("time_just_now");
  if (minutes < 60) return t("time_minutes_ago", { n: minutes });
  if (hours < 24) return t("time_hours_ago", { n: hours });
  if (days < 7) return t("time_days_ago", { n: days });
  if (days < 30) return t("time_weeks_ago", { n: Math.floor(days / 7) });
  return date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

function formatAbsoluteTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderVersionList(versions) {
  if (!versions || versions.length === 0) {
    versionList.innerHTML = `<p class="version-empty">${t("label_no_versions")}</p>`;
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
            <button class="version-action-btn diff-btn" data-ts="${escapeHtml(v.ts)}" type="button">${t("btn_diff")}</button>
            <button class="version-action-btn restore-btn" data-ts="${escapeHtml(v.ts)}" data-time="${escapeHtml(formatRelativeTime(v.timestamp))}" type="button">${t("btn_restore")}</button>
            <button class="version-action-btn delete-version-btn" data-ts="${escapeHtml(v.ts)}" type="button" title="${t("title_delete_version")}">&times;</button>
          </div>
        </div>`
    )
    .join("");
}

async function loadVersionHistory(force = false) {
  if (versionsLoaded && !force) return;
  const seq = ++historyRequestSeq;
  versionList.innerHTML = `<p class="version-loading">${t("label_version_loading")}</p>`;
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
    versionList.innerHTML = `<p class="version-empty">${t("label_version_load_failed", { msg: escapeHtml(err.message) })}</p>`;
  }
}

async function showDiff(ts) {
  const seq = ++diffRequestSeq;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}`);
    if (!res.ok) throw new Error(await readErrorMessage(res));
    if (seq !== diffRequestSeq) return; // 被更新的请求取代，丢弃
    const version = await res.json();

    diffCurrent.textContent = editSystem.value || t("label_empty");
    diffOld.textContent = version.system || t("label_empty");
    diffVersionInfo.textContent = t("label_version_time", { time: formatAbsoluteTime(version.timestamp) });
    currentDiffTs = ts;
    diffOverlay.classList.remove("hidden");
  } catch (err) {
    if (seq !== diffRequestSeq) return;
    alert(t("err_load_version", { msg: err.message }));
  }
}

async function restoreVersion(ts, label) {
  if (!confirm(t("confirm_restore_version", { label: label || t("misc_this") }))) return;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}/restore`, { method: "POST" });
    if (!res.ok) throw new Error(await readErrorMessage(res));

    // 重新加载当前人格指令 + 记忆（同步 memoryStore 防止下次保存覆盖）
    const promptsRes = await apiFetch("/api/prompts");
    if (!promptsRes.ok) throw new Error(t("err_restore_refresh"));
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

    saveStatus.textContent = t("status_restored_version");
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    alert(t("err_restore_failed", { msg: err.message }));
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

    saveStatus.textContent = t("status_version_saved");
    setTimeout(() => (saveStatus.textContent = ""), 2000);

    // 刷新版本列表
    if (toggleVersionsBtn.classList.contains("active")) {
      loadVersionHistory(true);
    } else {
      versionsLoaded = false;
    }
  } catch (err) {
    saveStatus.textContent = t("status_version_save_failed", { msg: err.message });
  } finally {
    saveVersionBtn.disabled = false;
  }
});

async function deleteVersion(ts) {
  if (!confirm(t("confirm_delete_version"))) return;
  try {
    const res = await apiFetch(`/api/prompts/versions/${ts}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    loadVersionHistory(true);
  } catch (err) {
    alert(t("err_delete_version", { msg: err.message }));
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
  if (editSystem.value.trim() && !confirm(t("confirm_insert_template"))) return;
  try {
    const res = await apiFetch(`/api/prompts/template?lang=${getLang()}`);
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    editSystem.value = data.system || "";
    editSystem.focus();
  } catch (err) {
    alert(t("err_load_template", { msg: err.message }));
  }
});

// ===== 语言选择 =====
configLanguage.value = getLang();
configLanguage.addEventListener("change", () => setLang(configLanguage.value));

// ===== 个性化：实时应用 =====
export function applyPersonalization() {
  const aiName = state.currentConfig?.ai_name;
  inputEl.placeholder = aiName ? t("ph_input_with_name", { name: aiName }) : t("ph_input_default");

  const conv = getCurrentConv();
  if (!conv || !conv.messages?.length) {
    welcomeGreetingEl.textContent = randomGreeting();
  }
}
