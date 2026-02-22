const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const { DEFAULT_CONFIG } = require("./clients");

const CONFIG_PATH = path.join(__dirname, "..", "prompts", "config.json");

// ===== 对话存储 =====
const CONVERSATIONS_DIR = path.join(__dirname, "..", "data", "conversations");
if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}
const IMAGES_DIR = path.join(__dirname, "..", "data", "images");
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function getConversationPath(id) {
  if (!/^\d{10,16}$/.test(id)) return null;
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

async function atomicWrite(filePath, data, encoding = "utf-8") {
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    const fd = await fsp.open(tmp, "w");
    try {
      await fd.writeFile(data, encoding);
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function pruneBackups(dir, keep = 20) {
  try {
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    if (files.length <= keep) return;
    const toDelete = files.slice(0, files.length - keep);
    await Promise.all(toDelete.map((f) => fsp.unlink(path.join(dir, f)).catch(() => {})));
  } catch { /* ignore cleanup errors */ }
}

async function readConfig() {
  try {
    return normalizeConfig(JSON.parse(await fsp.readFile(CONFIG_PATH, "utf-8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config) {
  const safeConfig = normalizeConfig(config);
  await atomicWrite(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
  return safeConfig;
}

function clampNumber(value, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(raw || {}) };
  return {
    model:
      typeof merged.model === "string" && merged.model.trim()
        ? merged.model.trim()
        : DEFAULT_CONFIG.model,
    temperature: clampNumber(merged.temperature, 0, 2, DEFAULT_CONFIG.temperature),
    presence_penalty: clampNumber(merged.presence_penalty, -2, 2, DEFAULT_CONFIG.presence_penalty),
    frequency_penalty: clampNumber(merged.frequency_penalty, -2, 2, DEFAULT_CONFIG.frequency_penalty),
    context_window: clampNumber(merged.context_window, 4, 500, 50),
    ...(merged.top_p !== undefined ? { top_p: clampNumber(merged.top_p, 0, 1, 1) } : {}),
    ...(typeof merged.ai_name === "string" ? { ai_name: merged.ai_name.trim().slice(0, 30) } : {}),
    ...(typeof merged.user_name === "string" ? { user_name: merged.user_name.trim().slice(0, 30) } : {}),
  };
}

function isPlainObject(input) {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

module.exports = {
  CONFIG_PATH,
  CONVERSATIONS_DIR,
  IMAGES_DIR,
  getConversationPath,
  atomicWrite,
  pruneBackups,
  readConfig,
  saveConfig,
  clampNumber,
  normalizeConfig,
  isPlainObject,
};
