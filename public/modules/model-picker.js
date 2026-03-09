/**
 * Model Picker — 模型搜索选择器
 *
 * 弹出面板：搜索框 + 最近使用 + 按提供商分组的完整模型列表
 * 每个条目显示 [彩色圆点] Provider · model-name
 */

import { t } from "./i18n.js";

const MAX_RECENT = 5;
const LS_KEY = "recent_models";

const PROVIDER_ORDER = ["openai", "openai-compat", "ark", "openrouter"];
const PROVIDER_LABELS = {
  openai: "OpenAI",
  "openai-compat": "OpenAI Compatible",
  ark: () => t("label_provider_ark"),
  openrouter: "OpenRouter",
};
const PROVIDER_COLORS = {
  openai: "#10a37f",
  "openai-compat": "#10a37f",
  ark: "#3b82f6",
  openrouter: "#6366f1",
};

function getProviderLabel(p) {
  const l = PROVIDER_LABELS[p];
  return typeof l === "function" ? l() : l || p;
}

/** Extract display info: { org, name, color } */
function getDisplayInfo(model) {
  const color = PROVIDER_COLORS[model.provider] || "#94a3b8";
  if (model.provider === "openrouter" && model.id.includes("/")) {
    const slash = model.id.indexOf("/");
    const org = model.id.slice(0, slash);
    const name = model.id.slice(slash + 1);
    // Capitalize org: "anthropic" → "Anthropic", "x-ai" → "X-ai"
    const displayOrg = org.charAt(0).toUpperCase() + org.slice(1);
    return { org: displayOrg, name, color };
  }
  return { org: getProviderLabel(model.provider), name: model.id, color };
}

// ===== State =====
let _models = [];        // [{ id, provider }]
let _currentModel = "";
let _onSelect = null;
let _recentModels = [];

// ===== DOM =====
let _trigger, _dropdown, _searchInput, _recentBar, _listEl;
let _isOpen = false;

// ===== Recent models =====
function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    _recentModels = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(_recentModels)) _recentModels = [];
  } catch { _recentModels = []; }
}

function saveRecent() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_recentModels.slice(0, MAX_RECENT))); }
  catch { /* ignore */ }
}

function pushRecent(modelId) {
  _recentModels = _recentModels.filter(m => m !== modelId);
  _recentModels.unshift(modelId);
  if (_recentModels.length > MAX_RECENT) _recentModels.length = MAX_RECENT;
  saveRecent();
}

// ===== Public API =====
export function initModelPicker(onSelect) {
  _onSelect = onSelect;
  loadRecent();

  _trigger = document.getElementById("model-picker-trigger");
  _dropdown = document.getElementById("model-picker-dropdown");
  _searchInput = document.getElementById("model-picker-search");
  _recentBar = document.getElementById("model-picker-recent");
  _listEl = document.getElementById("model-picker-list");
  if (!_trigger || !_dropdown) return;

  _trigger.addEventListener("click", _toggle);
  _searchInput.addEventListener("input", () => _renderList(_searchInput.value.trim().toLowerCase()));
  _searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { _close(); _trigger.focus(); }
  });
  document.addEventListener("click", (e) => {
    if (_isOpen && !_dropdown.contains(e.target) && e.target !== _trigger) _close();
  });
  document.addEventListener("keydown", (e) => {
    if (_isOpen && e.key === "Escape") { _close(); _trigger.focus(); }
  });
}

export function setModels(models) {
  // Normalize: accept both [{id,provider}] and ["string"] formats
  _models = (models || []).map(m =>
    typeof m === "string" ? { id: m, provider: "unknown" } : m
  );
  if (_isOpen) _renderList(_searchInput.value.trim().toLowerCase());
}

export function getSelectedModel() { return _currentModel; }

export function setSelectedModel(modelId, silent) {
  _currentModel = modelId;
  if (_trigger) {
    _trigger.textContent = modelId || "—";
    _trigger.title = modelId || "";
  }
  if (modelId && !silent) pushRecent(modelId);
}

// ===== Dropdown =====
function _toggle(e) {
  e.stopPropagation();
  _isOpen ? _close() : _open();
}

function _open() {
  _isOpen = true;
  _dropdown.classList.remove("hidden");
  _searchInput.value = "";
  _renderRecentBar();
  _renderList("");
  requestAnimationFrame(() => _searchInput.focus());
}

function _close() {
  _isOpen = false;
  _dropdown.classList.add("hidden");
}

// ===== Render =====

/** Chips bar below search — always visible, not affected by search query */
function _renderRecentBar() {
  if (!_recentBar) return;
  _recentBar.innerHTML = "";
  const modelIds = new Set(_models.map(m => m.id));
  const visible = _recentModels.filter(id => modelIds.has(id));
  if (visible.length === 0) {
    _recentBar.classList.add("hidden");
    return;
  }
  _recentBar.classList.remove("hidden");
  for (const id of visible) {
    const model = _models.find(m => m.id === id);
    if (!model) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-picker-chip";
    if (id === _currentModel) chip.classList.add("active");
    // Short display name
    const { name } = getDisplayInfo(model);
    chip.textContent = name;
    chip.title = id;
    chip.addEventListener("click", () => {
      _currentModel = id;
      _trigger.textContent = id;
      _trigger.title = id;
      pushRecent(id);
      _close();
      if (_onSelect) _onSelect(id);
    });
    _recentBar.appendChild(chip);
  }
}

function _renderList(query) {
  _listEl.innerHTML = "";

  const filtered = query
    ? _models.filter(m => m.id.toLowerCase().includes(query))
    : _models;

  // Group by provider
  const groups = new Map();
  for (const m of filtered) {
    if (!groups.has(m.provider)) groups.set(m.provider, []);
    groups.get(m.provider).push(m);
  }

  for (const provider of PROVIDER_ORDER) {
    const items = groups.get(provider);
    if (!items || items.length === 0) continue;
    const sec = _createSection(getProviderLabel(provider));
    for (const m of items) sec.appendChild(_createItem(m));
    _listEl.appendChild(sec);
  }

  // Any unlisted providers
  for (const [provider, items] of groups) {
    if (PROVIDER_ORDER.includes(provider)) continue;
    const sec = _createSection(getProviderLabel(provider));
    for (const m of items) sec.appendChild(_createItem(m));
    _listEl.appendChild(sec);
  }

  if (_listEl.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "model-picker-empty";
    empty.textContent = query ? t("label_no_models_found") : t("label_no_models");
    _listEl.appendChild(empty);
  }
}

function _createSection(label) {
  const sec = document.createElement("div");
  sec.className = "model-picker-section";
  const h = document.createElement("div");
  h.className = "model-picker-section-header";
  h.textContent = label;
  sec.appendChild(h);
  return sec;
}

function _createItem(model) {
  const { org, name, color } = getDisplayInfo(model);

  const el = document.createElement("div");
  el.className = "model-picker-item";
  if (model.id === _currentModel) el.classList.add("selected");
  el.title = model.id;

  // [colored dot]
  const dot = document.createElement("span");
  dot.className = "model-picker-dot";
  dot.style.background = color;
  el.appendChild(dot);

  // Provider label
  const orgEl = document.createElement("span");
  orgEl.className = "model-picker-org";
  orgEl.textContent = org;
  el.appendChild(orgEl);

  // Model name
  const nameEl = document.createElement("span");
  nameEl.className = "model-picker-name";
  nameEl.textContent = name;
  el.appendChild(nameEl);

  el.addEventListener("click", () => {
    _currentModel = model.id;
    _trigger.textContent = model.id;
    _trigger.title = model.id;
    pushRecent(model.id);
    _close();
    if (_onSelect) _onSelect(model.id);
  });
  return el;
}
