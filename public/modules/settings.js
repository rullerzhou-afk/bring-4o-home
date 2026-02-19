import { state, modelSelector } from "./state.js";
import { apiFetch, readErrorMessage } from "./api.js";
import { initImportTab } from "./import.js";

const settingsBtn = document.getElementById("settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsClose = document.getElementById("settings-close");
const editSystem = document.getElementById("edit-system");
const editMemory = document.getElementById("edit-memory");
const editConfig = document.getElementById("edit-config");
const editImport = document.getElementById("edit-import");
const savePromptsBtn = document.getElementById("save-prompts");
const saveStatus = document.getElementById("save-status");
const tabs = document.querySelectorAll("#settings-tabs .tab");

// 模型参数控件
const configModel = document.getElementById("config-model");
const configTemp = document.getElementById("config-temp");
const configPP = document.getElementById("config-pp");
const configFP = document.getElementById("config-fp");
const configCtx = document.getElementById("config-ctx");
const tempVal = document.getElementById("temp-val");
const ppVal = document.getElementById("pp-val");
const fpVal = document.getElementById("fp-val");
const ctxVal = document.getElementById("ctx-val");
const currentModelDisplay = document.getElementById("current-model-display");

// 滑块实时显示数值
configTemp.addEventListener("input", () => (tempVal.textContent = configTemp.value));
configPP.addEventListener("input", () => (ppVal.textContent = configPP.value));
configFP.addEventListener("input", () => (fpVal.textContent = configFP.value));
configCtx.addEventListener("input", () => (ctxVal.textContent = configCtx.value));

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

    // 填充参数
    configTemp.value = config.temperature ?? 1;
    tempVal.textContent = configTemp.value;
    configPP.value = config.presence_penalty ?? 0;
    ppVal.textContent = configPP.value;
    configFP.value = config.frequency_penalty ?? 0;
    fpVal.textContent = configFP.value;
    configCtx.value = config.context_window ?? 50;
    ctxVal.textContent = config.context_window ?? 50;
  } catch (err) {
    console.error("加载配置失败:", err);
  }
}

// 打开设置
settingsBtn.addEventListener("click", async () => {
  settingsOverlay.classList.remove("hidden");
  saveStatus.textContent = "";
  try {
    const res = await apiFetch("/api/prompts");
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    editSystem.value = data.system || "";
    editMemory.value = data.memory || "";
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
    editSystem.classList.toggle("hidden", target !== "system");
    editMemory.classList.toggle("hidden", target !== "memory");
    editConfig.classList.toggle("hidden", target !== "config");
    editImport.classList.toggle("hidden", target !== "import");
    if (target === "import") initImportTab();
  });
});

// 保存
savePromptsBtn.addEventListener("click", async () => {
  saveStatus.textContent = "保存中...";
  try {
    // 保存 prompt 文件
    const promptsRes = await apiFetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: editSystem.value,
        memory: editMemory.value,
      }),
    });
    if (!promptsRes.ok) throw new Error(await readErrorMessage(promptsRes));

    // 保存模型配置
    const configRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configModel.value,
        temperature: parseFloat(configTemp.value),
        presence_penalty: parseFloat(configPP.value),
        frequency_penalty: parseFloat(configFP.value),
        context_window: parseInt(configCtx.value, 10),
      }),
    });
    if (!configRes.ok) throw new Error(await readErrorMessage(configRes));
    state.currentConfig = {
      ...(state.currentConfig || {}),
      model: configModel.value,
      temperature: parseFloat(configTemp.value),
      presence_penalty: parseFloat(configPP.value),
      frequency_penalty: parseFloat(configFP.value),
      context_window: parseInt(configCtx.value, 10),
    };

    // 同步顶栏模型选择器
    if (modelSelector.value !== configModel.value) {
      modelSelector.value = configModel.value;
    }

    saveStatus.textContent = "已保存";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  } catch (err) {
    saveStatus.textContent = "保存失败: " + err.message;
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
  } catch (err) {
    console.error("加载模型列表失败:", err);
  }
}

modelSelector.addEventListener("change", async () => {
  try {
    const configRes = await apiFetch("/api/config");
    if (!configRes.ok) return;
    const config = await configRes.json();
    config.model = modelSelector.value;

    const saveRes = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!saveRes.ok) throw new Error("保存失败");
    state.currentConfig = config;

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