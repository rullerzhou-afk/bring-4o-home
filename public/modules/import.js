import { state } from "./state.js";
import { apiFetch } from "./api.js";
import { saveLocalCache, renderChatList } from "./conversations.js";

let lastImportedConvs = []; // 本次导入解析出的对话列表
let importScope = "imported"; // "imported" | "all"
let importChecked = new Set(); // 勾选的对话 ID
let allScopeChecked = new Set(); // 「全部本地」范围的勾选状态
let summaryModelsLoaded = false;

// 导入与总结控件
const editImport = document.getElementById("edit-import");
const editSystem = document.getElementById("edit-system");
const editMemory = document.getElementById("edit-memory");
const importDropZone = document.getElementById("import-drop-zone");
const importFileInput = document.getElementById("import-file-input");
const importFolderInput = document.getElementById("import-folder-input");
const importFileBtn = document.getElementById("import-file-btn");
const importFolderBtn = document.getElementById("import-folder-btn");
const importParsingText = document.getElementById("import-parsing-text");
const importParsing = document.getElementById("import-parsing");
const importError = document.getElementById("import-error");
const importListSection = document.getElementById("import-list-section");
const importSelectAll = document.getElementById("import-select-all");
const importCount = document.getElementById("import-count");
const importConvList = document.getElementById("import-conv-list");
const importDoBtn = document.getElementById("import-do-btn");
const importProgress = document.getElementById("import-progress");
const importProgressFill = document.getElementById("import-progress-fill");
const importProgressText = document.getElementById("import-progress-text");
const importResult = document.getElementById("import-result");
const summaryModel = document.getElementById("summary-model");
const summaryGenerateBtn = document.getElementById("summary-generate-btn");
const summaryLoading = document.getElementById("summary-loading");
const importSummaryResult = document.getElementById("import-summary-result");
const summarySystemFindings = document.getElementById("summary-system-findings");
const summaryMemoryFindings = document.getElementById("summary-memory-findings");
const summaryNotes = document.getElementById("summary-notes");
const summaryNotesContent = document.getElementById("summary-notes-content");
const summaryMergeBtn = document.getElementById("summary-merge-btn");
const summaryCancelBtn = document.getElementById("summary-cancel-btn");
const summaryMergeLoading = document.getElementById("summary-merge-loading");
const importMergeResult = document.getElementById("import-merge-result");
const mergeSystemTextarea = document.getElementById("merge-system");
const mergeMemoryTextarea = document.getElementById("merge-memory");
const mergeApplyBtn = document.getElementById("merge-apply-btn");
const mergeBackBtn = document.getElementById("merge-back-btn");
const summaryApplyStatus = document.getElementById("summary-apply-status");

// 导入图片文件映射：fileId → File 对象
let importImageMap = new Map();

async function loadSummaryModelSelector() {
  if (summaryModelsLoaded) return;
  try {
    const [modelsRes, configRes] = await Promise.all([
      apiFetch("/api/models"),
      apiFetch("/api/config"),
    ]);
    if (!modelsRes.ok || !configRes.ok) return;
    const models = await modelsRes.json();
    const config = await configRes.json();
    summaryModel.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === config.model) opt.selected = true;
      summaryModel.appendChild(opt);
    });
    summaryModelsLoaded = true;
  } catch (err) {
    console.error("加载总结模型列表失败:", err);
  }
}

export function initImportTab() {
  loadSummaryModelSelector();
  // 始终显示列表区域；如果没有导入过文件，默认切到「全部本地」
  importListSection.classList.remove("hidden");
  if (lastImportedConvs.length === 0) {
    importScope = "all";
  }
  // 同步 scope 按钮状态 + 禁用逻辑
  document.querySelectorAll(".scope-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scope === importScope);
    if (btn.dataset.scope === "imported") {
      btn.disabled = lastImportedConvs.length === 0;
    }
  });
  renderImportList();
}

// --- 文件上传 ---
importFileBtn.addEventListener("click", () => importFileInput.click());
importFolderBtn.addEventListener("click", () => importFolderInput.click());

importDropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  importDropZone.classList.add("drag-over");
});
importDropZone.addEventListener("dragleave", () => {
  importDropZone.classList.remove("drag-over");
});
importDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  importDropZone.classList.remove("drag-over");

  // 检查是否拖入了文件夹
  const items = e.dataTransfer.items;
  if (items && items.length > 0) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    // 如果包含目录，按文件夹导入处理
    if (entries.some((ent) => ent.isDirectory)) {
      handleImportFolder(entries);
      return;
    }
  }
  // 普通文件拖入
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

importFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
  importFileInput.value = "";
});

importFolderInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) handleImportFolderFiles(files);
  importFolderInput.value = "";
});

// --- 文件夹导入辅助 ---
function readAllEntries(dirEntry) {
  return new Promise((resolve) => {
    const results = [];
    const reader = dirEntry.createReader();
    function readBatch() {
      reader.readEntries((entries) => {
        if (entries.length === 0) { resolve(results); return; }
        results.push(...entries);
        readBatch();
      }, () => resolve(results));
    }
    readBatch();
  });
}

async function collectFilesFromEntries(entries) {
  const files = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      files.push({ file, path: entry.fullPath });
    } else if (entry.isDirectory) {
      const children = await readAllEntries(entry);
      queue.push(...children);
    }
  }
  return files;
}

async function handleImportFolder(entries) {
  showImportParsing("正在读取文件夹...");
  try {
    const allFiles = await collectFilesFromEntries(entries);
    handleImportFolderFiles(allFiles.map((f) => f.file));
  } catch (err) {
    hideImportParsing();
    showImportError("读取文件夹失败: " + (err.message || "未知错误"));
  }
}

function handleImportFolderFiles(files) {
  // 找到 conversations.json
  const jsonFile = files.find((f) => f.name === "conversations.json");
  if (!jsonFile) {
    showImportError("文件夹中未找到 conversations.json，请确认是 ChatGPT 导出的文件夹");
    return;
  }

  // 建立图片文件映射：fileId → File
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
  importImageMap = new Map();
  for (const f of files) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!imageExts.has(ext)) continue;
    // 文件名格式: file_xxx-sanitized.png 或 file_xxx-uuid.png
    // 提取 file_xxx 作为 ID（去掉后缀部分）
    const match = f.name.match(/^(file[-_][a-f0-9]+)/i);
    if (match) {
      importImageMap.set(match[1], f);
    }
  }

  showImportParsing("正在解析 conversations.json（找到 " + importImageMap.size + " 张图片）...");
  handleImportFile(jsonFile, importImageMap.size > 0);
}

function showImportParsing(text) {
  importError.classList.add("hidden");
  importParsing.classList.remove("hidden");
  importParsingText.textContent = text || "正在解析，请稍候...";
  importDropZone.querySelector(".drop-zone-content").classList.add("hidden");
  importListSection.classList.add("hidden");
  importSummaryResult.classList.add("hidden");
}

function hideImportParsing() {
  importParsing.classList.add("hidden");
  importDropZone.querySelector(".drop-zone-content").classList.remove("hidden");
}

function handleImportFile(file, hasImages) {
  if (file.name.endsWith(".zip")) {
    showImportError("请先解压 ZIP 文件，然后上传里面的 conversations.json");
    return;
  }
  if (!file.name.endsWith(".json")) {
    showImportError("请上传 .json 格式的文件（ChatGPT 导出的 conversations.json）");
    return;
  }

  // 显示解析中（如果不是从文件夹入口调用的，才需要手动显示）
  if (!hasImages) showImportParsing();

  const reader = new FileReader();
  reader.onload = function () {
    const worker = new Worker("import-worker.js");
    worker.onmessage = function (e) {
      worker.terminate();
      hideImportParsing();

      if (e.data.error) {
        showImportError(e.data.error);
        return;
      }

      const parsed = e.data.conversations || [];
      if (parsed.length === 0) {
        showImportError("未找到有效对话，请检查文件内容");
        return;
      }

      // 处理 ID 冲突（与现有对话比对）
      const existingIds = new Set(state.conversations.map((c) => c.id));
      for (const conv of parsed) {
        while (existingIds.has(conv.id)) {
          conv.id = (parseInt(conv.id, 10) + 1).toString();
        }
        existingIds.add(conv.id);
      }

      lastImportedConvs = parsed;
      importScope = "imported";
      importChecked = new Set(parsed.map((c) => c.id));
      allScopeChecked = new Set();

      // 更新 scope 按钮（解锁「本次导入」）
      document.querySelectorAll(".scope-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.scope === "imported");
        if (btn.dataset.scope === "imported") btn.disabled = false;
      });

      renderImportList();
      importListSection.classList.remove("hidden");
      importResult.classList.add("hidden");
      importSummaryResult.classList.add("hidden");
    };
    worker.onerror = function (err) {
      worker.terminate();
      importParsing.classList.add("hidden");
      importDropZone.querySelector(".drop-zone-content").classList.remove("hidden");
      showImportError("解析失败: " + (err.message || "未知错误"));
    };
    worker.postMessage(JSON.stringify({ json: reader.result, hasImages: !!hasImages }));
  };
  reader.onerror = function () {
    hideImportParsing();
    showImportError("文件读取失败");
  };
  reader.readAsText(file);
}

function showImportError(msg) {
  importError.textContent = msg;
  importError.classList.remove("hidden");
}

// --- 范围切换 ---
document.querySelectorAll(".scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".scope-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    importScope = btn.dataset.scope;
    renderImportList();
  });
});

// --- 对话列表渲染 ---
function getImportListData() {
  if (importScope === "imported") {
    return lastImportedConvs;
  }
  // 「全部本地」: 已有对话（含已导入的）
  return state.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    messageCount: c.messages ? c.messages.length : "?",
    createTime: parseInt(c.id, 10) / 1000,
  }));
}

function getCheckedSet() {
  return importScope === "imported" ? importChecked : allScopeChecked;
}

function renderImportList() {
  const items = getImportListData();
  const checked = getCheckedSet();
  importConvList.innerHTML = "";

  items.forEach((conv) => {
    const div = document.createElement("div");
    div.className = "import-conv-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked.has(conv.id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        checked.add(conv.id);
      } else {
        checked.delete(conv.id);
      }
      updateImportSelectAll();
    });

    const title = document.createElement("span");
    title.className = "import-conv-title";
    title.textContent = conv.title;

    const meta = document.createElement("span");
    meta.className = "import-conv-meta";
    const msgCount = conv.messageCount != null ? conv.messageCount : "?";
    const dateStr = conv.createTime ? formatImportDate(conv.createTime) : "";
    meta.textContent = msgCount + "条" + (dateStr ? " " + dateStr : "");

    div.appendChild(cb);
    div.appendChild(title);
    div.appendChild(meta);

    // 点击行也切换勾选
    div.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });

    importConvList.appendChild(div);
  });

  importCount.textContent = "共 " + items.length + " 条对话";
  updateImportSelectAll();

  // 「全部本地」模式下隐藏导入按钮（已经在本地了）
  importDoBtn.style.display = importScope === "all" ? "none" : "";
}

function updateImportSelectAll() {
  const items = getImportListData();
  const checked = getCheckedSet();
  importSelectAll.checked = items.length > 0 && items.every((c) => checked.has(c.id));
}

importSelectAll.addEventListener("change", () => {
  const items = getImportListData();
  const checked = getCheckedSet();
  if (importSelectAll.checked) {
    items.forEach((c) => checked.add(c.id));
  } else {
    checked.clear();
  }
  renderImportList();
});

function formatImportDate(ts) {
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// --- 上传图片到服务端 ---
async function uploadImportImage(fileId) {
  const file = importImageMap.get(fileId);
  if (!file) return null;
  const formData = new FormData();
  formData.append("image", file);
  try {
    const res = await apiFetch("/api/images", { method: "POST", body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url; // "/images/xxx.png"
  } catch {
    return null;
  }
}

// 处理对话消息中的图片引用：上传图片并替换 asset_pointer 为 image_url
async function processConvImages(conv, progressCb) {
  const imageIds = conv.imageFileIds || [];
  if (imageIds.length === 0 || importImageMap.size === 0) return conv.messages;

  // 批量上传该对话引用的图片，建立 fileId → serverUrl 映射
  const urlMap = new Map();
  for (let i = 0; i < imageIds.length; i++) {
    const fid = imageIds[i];
    if (urlMap.has(fid)) continue;
    const url = await uploadImportImage(fid);
    if (url) urlMap.set(fid, url);
    if (progressCb) progressCb(i + 1, imageIds.length);
  }

  // 替换消息中的 image_asset_pointer
  return conv.messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const newParts = m.content.map((part) => {
      if (part.type === "image_asset_pointer" && part.file_id) {
        const url = urlMap.get(part.file_id);
        if (url) {
          return { type: "image_url", image_url: { url } };
        }
        // 图片上传失败，显示占位文本
        return { type: "text", text: "[图片: 上传失败，文件不可用]" };
      }
      return part;
    });
    return { role: m.role, content: newParts };
  });
}

// --- 导入选中对话 ---
importDoBtn.addEventListener("click", async () => {
  const selected = lastImportedConvs.filter((c) => importChecked.has(c.id));
  if (selected.length === 0) {
    showImportError("请至少选择一条对话");
    return;
  }

  importDoBtn.disabled = true;
  importProgress.classList.remove("hidden");
  importResult.classList.add("hidden");
  importError.classList.add("hidden");

  let success = 0;
  let failed = 0;

  for (let i = 0; i < selected.length; i++) {
    const conv = selected[i];

    // 上传该对话引用的图片并替换引用
    let msgs;
    try {
      msgs = await processConvImages(conv, (done, total) => {
        importProgressText.textContent = (i + 1) + "/" + selected.length + " 上传图片 " + done + "/" + total;
      });
    } catch {
      msgs = conv.messages;
    }

    // 截断消息到 500 条
    msgs = msgs.slice(-500).map((m) => {
      if (typeof m.content === "string" && m.content.length > 30000) {
        return { role: m.role, content: m.content.slice(0, 30000) };
      }
      return m;
    });

    try {
      const res = await apiFetch(`/api/conversations/${conv.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conv.id, title: conv.title, messages: msgs }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (!state.conversations.find((c) => c.id === conv.id)) {
        state.conversations.unshift({ id: conv.id, title: conv.title, messages: null });
      }
      success++;
    } catch {
      failed++;
    }

    const pct = ((i + 1) / selected.length) * 100;
    importProgressFill.style.width = pct + "%";
    importProgressText.textContent = (i + 1) + "/" + selected.length + " 导入中...";
  }

  importDoBtn.disabled = false;
  importProgressText.textContent = "";
  importProgress.classList.add("hidden");
  importProgressFill.style.width = "0%";
  importImageMap = new Map(); // 释放图片文件引用

  saveLocalCache();
  renderChatList();

  importResult.textContent = "导入完成：" + success + " 条成功" + (failed > 0 ? "，" + failed + " 条失败" : "");
  importResult.className = failed > 0 ? "error" : "";
  importResult.classList.remove("hidden");
});

// --- 总结生成 ---
summaryGenerateBtn.addEventListener("click", async () => {
  const checked = getCheckedSet();
  const selectedIds = [];
  const items = getImportListData();
  items.forEach((c) => {
    if (checked.has(c.id)) selectedIds.push(c.id);
  });

  if (selectedIds.length === 0) {
    showImportError("请至少选择一条对话进行总结");
    return;
  }
  if (selectedIds.length > 50) {
    showImportError("最多选择 50 条对话进行总结，当前已选 " + selectedIds.length + " 条");
    return;
  }

  // 「本次导入」范围下，未导入的对话需要先导入才能总结
  if (importScope === "imported") {
    const notImported = selectedIds.filter((id) => !state.conversations.find((c) => c.id === id));
    if (notImported.length > 0) {
      showImportError("请先导入选中的对话，再进行总结");
      return;
    }
  }

  summaryGenerateBtn.disabled = true;
  summaryGenerateBtn.dataset.origText = summaryGenerateBtn.textContent;
  summaryGenerateBtn.textContent = "正在分析中...";
  summaryLoading.classList.remove("hidden");
  importSummaryResult.classList.add("hidden");
  importError.classList.add("hidden");
  summaryApplyStatus.classList.add("hidden");

  try {
    const res = await apiFetch("/api/conversations/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationIds: selectedIds,
        model: summaryModel.value,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "请求失败 (HTTP " + res.status + ")");
    }

    const data = await res.json();
    summarySystemFindings.value = data.newSystemFindings || "";
    summaryMemoryFindings.value = data.newMemoryFindings || "";

    // 告知用户哪些对话因超限未被分析
    if (data.skippedTitles && data.skippedTitles.length > 0) {
      const names = data.skippedTitles.map((t) => "\u300c" + t + "\u300d").join("\u3001");
      showImportError(
        "已分析 " + data.analyzedCount + "/" + data.totalSelected +
        " 条对话。以下对话因内容总量超限未纳入：" + names +
        "。可减少选择数量或单独总结这些对话。"
      );
    }

    if (data.notes) {
      summaryNotesContent.textContent = data.notes;
      summaryNotes.classList.remove("hidden");
    } else {
      summaryNotes.classList.add("hidden");
    }

    importSummaryResult.classList.remove("hidden");
    importMergeResult.classList.add("hidden");
    setTimeout(() => editImport.scrollTo({ top: editImport.scrollHeight, behavior: "smooth" }), 100);
  } catch (err) {
    showImportError("总结失败: " + err.message);
  } finally {
    summaryGenerateBtn.disabled = false;
    summaryGenerateBtn.textContent = summaryGenerateBtn.dataset.origText || "总结选中对话，生成 Prompt 建议";
    summaryLoading.classList.add("hidden");
  }
});

// --- 第二步：融合到现有 Prompt ---
summaryMergeBtn.addEventListener("click", async () => {
  const sysFindings = summarySystemFindings.value.trim();
  const memFindings = summaryMemoryFindings.value.trim();
  if (!sysFindings && !memFindings) {
    showImportError("没有需要融合的新发现");
    return;
  }

  summaryMergeBtn.disabled = true;
  summaryMergeBtn.textContent = "融合中...";
  summaryMergeLoading.classList.remove("hidden");
  summaryApplyStatus.classList.add("hidden");

  try {
    const res = await apiFetch("/api/conversations/merge-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newSystemFindings: sysFindings,
        newMemoryFindings: memFindings,
        model: summaryModel.value,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "融合失败 (HTTP " + res.status + ")");
    }

    const data = await res.json();
    mergeSystemTextarea.value = data.mergedSystem || "";
    mergeMemoryTextarea.value = data.mergedMemory || "";

    importSummaryResult.classList.add("hidden");
    importMergeResult.classList.remove("hidden");
    setTimeout(() => editImport.scrollTo({ top: editImport.scrollHeight, behavior: "smooth" }), 100);
  } catch (err) {
    showImportError("融合失败: " + err.message);
  } finally {
    summaryMergeBtn.disabled = false;
    summaryMergeBtn.textContent = "融合到现有 Prompt";
    summaryMergeLoading.classList.add("hidden");
  }
});

// --- 第三步：应用融合结果 ---
mergeApplyBtn.addEventListener("click", async () => {
  if (!confirm("确定应用？当前 Prompt 将被覆盖（服务端会自动备份旧版本）")) {
    return;
  }

  mergeApplyBtn.disabled = true;
  summaryApplyStatus.textContent = "应用中...";
  summaryApplyStatus.classList.remove("hidden");

  try {
    const res = await apiFetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: mergeSystemTextarea.value,
        memory: mergeMemoryTextarea.value,
        backup: true,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "保存失败");
    }

    editSystem.value = mergeSystemTextarea.value;
    editMemory.value = mergeMemoryTextarea.value;

    summaryApplyStatus.textContent = "已应用，旧 Prompt 已备份";
    setTimeout(() => summaryApplyStatus.classList.add("hidden"), 3000);
  } catch (err) {
    summaryApplyStatus.textContent = "应用失败: " + err.message;
  } finally {
    mergeApplyBtn.disabled = false;
  }
});

// --- 返回修改发现 ---
mergeBackBtn.addEventListener("click", () => {
  importMergeResult.classList.add("hidden");
  importSummaryResult.classList.remove("hidden");
});

// --- 取消 ---
summaryCancelBtn.addEventListener("click", () => {
  importSummaryResult.classList.add("hidden");
  importMergeResult.classList.add("hidden");
});