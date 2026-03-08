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

const INDEX_PATH = path.join(CONVERSATIONS_DIR, "_index.json");

function getConversationPath(id) {
  if (!/^\d{10,16}$/.test(id)) return null;
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

// ===== 互斥锁工具 =====

function createMutex() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
}

const withIndexLock = createMutex();

const _convLocks = new Map();
const CONV_LOCKS_MAX = 1000;
function withConvLock(convId, fn) {
  // 淘汰式清理：只删最旧的一半，保留当前 convId（避免破坏活跃锁）
  if (_convLocks.size > CONV_LOCKS_MAX && !_convLocks.has(convId)) {
    const target = Math.floor(CONV_LOCKS_MAX / 2);
    for (const key of _convLocks.keys()) {
      if (key !== convId) _convLocks.delete(key);
      if (_convLocks.size <= target) break;
    }
  }
  if (!_convLocks.has(convId)) _convLocks.set(convId, createMutex());
  return _convLocks.get(convId)(fn);
}

// ===== 会话索引（避免全量磁盘扫描） =====

// 内部读取函数（不带锁，仅供锁内调用）
async function _readIndexUnsafe() {
  try {
    return JSON.parse(await fsp.readFile(INDEX_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// 内部写入函数（不带锁，仅供锁内调用）
async function _writeIndexUnsafe(index) {
  await atomicWrite(INDEX_PATH, JSON.stringify(index));
}

// 公开接口：带锁的读写
async function readIndex() {
  return withIndexLock(() => _readIndexUnsafe());
}

async function writeIndex(index) {
  return withIndexLock(() => _writeIndexUnsafe(index));
}

async function updateIndexEntry(id, title, messageCount) {
  return withIndexLock(async () => {
    const index = (await _readIndexUnsafe()) || {};
    index[id] = { title, messageCount, updatedAt: new Date().toISOString() };
    await _writeIndexUnsafe(index);
  });
}

async function removeIndexEntry(id) {
  return withIndexLock(async () => {
    const index = (await _readIndexUnsafe()) || {};
    delete index[id];
    await _writeIndexUnsafe(index);
  });
}

async function removeIndexEntries(ids) {
  return withIndexLock(async () => {
    const index = (await _readIndexUnsafe()) || {};
    for (const id of ids) delete index[id];
    await _writeIndexUnsafe(index);
  });
}

async function rebuildIndex() {
  const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter(
    (f) => f.endsWith(".json") && f !== "_index.json"
  );
  // 分批读取，防止大量对话文件时 EMFILE（文件描述符耗尽）
  const BATCH = 20;
  const entries = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          const data = JSON.parse(await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8"));
          if (data.id) {
            return { id: data.id, title: data.title || "新对话", messageCount: (data.messages || []).length, updatedAt: data.updatedAt || null };
          }
        } catch (err) { console.warn(`[config] skipping corrupted file: ${file}`, err.message); }
        return null;
      })
    );
    entries.push(...results);
  }
  const index = {};
  for (const e of entries) {
    if (e) index[e.id] = { title: e.title, messageCount: e.messageCount, updatedAt: e.updatedAt };
  }
  // rebuildIndex 需要加锁（可能与其他索引操作并发）
  return withIndexLock(async () => {
    await _writeIndexUnsafe(index);
    return index;
  });
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
    // Try rename first (atomic on POSIX).
    // On Windows rename cannot overwrite existing files (EPERM) — catch and retry.
    try {
      await fsp.rename(tmp, filePath);
    } catch (renameErr) {
      if (process.platform === "win32" && renameErr.code === "EPERM") {
        await fsp.unlink(filePath).catch(() => {});
        await fsp.rename(tmp, filePath);
      } else {
        throw renameErr;
      }
    }
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

const BACKUPS_DIR = path.join(__dirname, "..", "prompts", "backups");

async function backupPrompts() {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  const { readPromptFile, SYSTEM_PATH, readMemoryStore, renderMemoryForPrompt } = require("./prompts");
  const [system, store] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readMemoryStore().catch(() => ({ version: 1, identity: [], preferences: [], events: [] })),
  ]);
  const memory = renderMemoryForPrompt(store);
  const backupFile = path.join(BACKUPS_DIR, `${Date.now()}.json`);
  await atomicWrite(backupFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    system,
    memory,
    memoryStore: store,
  }, null, 2));
  await pruneBackups(BACKUPS_DIR);
  return backupFile;
}

async function readConfig() {
  try {
    return normalizeConfig(JSON.parse(await fsp.readFile(CONFIG_PATH, "utf-8")));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("[config] readConfig error:", err.message);
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
    context_window: Math.round(clampNumber(merged.context_window, 4, 500, 50)),
    ...(merged.top_p !== undefined ? { top_p: clampNumber(merged.top_p, 0, 1, 1) } : {}),
    ...(typeof merged.ai_name === "string" ? { ai_name: merged.ai_name.trim().slice(0, 30) } : {}),
    ...(typeof merged.user_name === "string" ? { user_name: merged.user_name.trim().slice(0, 30) } : {}),
    auto_compress: typeof merged.auto_compress === "boolean" ? merged.auto_compress : false,
    compress_keep_recent: Math.round(clampNumber(merged.compress_keep_recent, 2, 100, 10)),
    ...(isPlainObject(merged.memory) ? {
      memory: {
        decayIdleDays: clampNumber(merged.memory.decayIdleDays, 1, 365, 30),
        autoDecay: typeof merged.memory.autoDecay === "boolean" ? merged.memory.autoDecay : false,
        autoPromotion: typeof merged.memory.autoPromotion === "boolean" ? merged.memory.autoPromotion : false,
        promotionUseCount: clampNumber(merged.memory.promotionUseCount, 1, 100, 5),
        promotionMinDays: clampNumber(merged.memory.promotionMinDays, 1, 365, 14),
      },
    } : {}),
    ...(isPlainObject(merged.voice) ? {
      voice: {
        stt_provider: ["browser", "api", "local", "volcengine"].includes(merged.voice.stt_provider)
          ? merged.voice.stt_provider : "browser",
        tts_provider: ["edge", "api", "volcengine"].includes(merged.voice.tts_provider)
          ? merged.voice.tts_provider : "edge",
        tts_voice: typeof merged.voice.tts_voice === "string"
          ? merged.voice.tts_voice.slice(0, 60) : "zh-CN-YunxiNeural",
        tts_speed: clampNumber(merged.voice.tts_speed, 0.5, 2.0, 1.0),
        volcengine_clone_id: typeof merged.voice.volcengine_clone_id === "string"
          ? merged.voice.volcengine_clone_id.slice(0, 64) : "",
      },
    } : {}),
  };
}

function isPlainObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const proto = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

module.exports = {
  CONFIG_PATH,
  CONVERSATIONS_DIR,
  IMAGES_DIR,
  INDEX_PATH,
  getConversationPath,
  createMutex,
  atomicWrite,
  pruneBackups,
  readConfig,
  saveConfig,
  clampNumber,
  normalizeConfig,
  isPlainObject,
  readIndex,
  writeIndex,
  updateIndexEntry,
  removeIndexEntry,
  removeIndexEntries,
  backupPrompts,
  rebuildIndex,
  withConvLock,
};
