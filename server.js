require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// ===== API 客户端（三选一，至少配一个）=====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "").trim();
const openaiClient = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
    })
  : null;

const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const arkClient = ARK_API_KEY
  ? new OpenAI({ apiKey: ARK_API_KEY, baseURL: ARK_BASE_URL })
  : null;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL = (process.env.OPENROUTER_SITE_URL || "").trim();
const OPENROUTER_APP_NAME = (process.env.OPENROUTER_APP_NAME || "bring-4o-home").trim();
const OPENROUTER_HEADERS = {};
if (OPENROUTER_SITE_URL) OPENROUTER_HEADERS["HTTP-Referer"] = OPENROUTER_SITE_URL;
if (OPENROUTER_APP_NAME) OPENROUTER_HEADERS["X-Title"] = OPENROUTER_APP_NAME;
const openrouterClient = OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      ...(Object.keys(OPENROUTER_HEADERS).length > 0 ? { defaultHeaders: OPENROUTER_HEADERS } : {}),
    })
  : null;

if (!openaiClient && !arkClient && !openrouterClient) {
  console.error("错误：至少需要配置 OPENAI_API_KEY、ARK_API_KEY、OPENROUTER_API_KEY 中的一个");
  process.exit(1);
}

// 根据模型名判断使用哪个客户端
// OpenRouter 模型 ID 含 "/"（如 openai/gpt-4o）
function getClientForModel(model) {
  if (model.includes("/")) {
    if (!openrouterClient) throw new Error("未配置 OPENROUTER_API_KEY，无法使用 OpenRouter 模型");
    return openrouterClient;
  }
  const isOpenAI = /^(gpt|o[0-9]|chatgpt)/i.test(model);
  if (isOpenAI) {
    if (!openaiClient) throw new Error("未配置 OPENAI_API_KEY，无法使用 OpenAI 模型");
    return openaiClient;
  }
  if (!arkClient) throw new Error("未配置 ARK_API_KEY，无法使用火山引擎模型");
  return arkClient;
}

function resolveDefaultModel() {
  if (process.env.MODEL) return process.env.MODEL;
  if (openaiClient) return "gpt-4o";
  if (openrouterClient) return "openai/gpt-4o-mini";
  if (arkClient) return "doubao-1-5-lite-32k-250115";
  return "gpt-4o";
}

function formatProviderError(err) {
  const status = err?.status ?? err?.response?.status;
  const code = err?.code || err?.error?.code;
  const detail = err?.error?.message || err?.message || "Unknown server error";
  const parts = [];
  if (status) parts.push(`HTTP ${status}`);
  if (code) parts.push(`code=${code}`);
  parts.push(detail);
  return parts.join(" | ");
}

const DEFAULT_CONFIG = {
  model: resolveDefaultModel(),
  temperature: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
};

// ===== Web Search (Serper.dev) =====
const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const MAX_TOOL_ROUNDS = 3;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web using Google. Use this when the user asks about current events, real-time data, prices, news, weather, or anything that requires up-to-date information beyond your training data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string",
        },
      },
      required: ["query"],
    },
  },
};

async function executeWebSearch(query) {
  if (!SERPER_API_KEY) {
    return "Search is not configured on the server (missing SERPER_API_KEY).";
  }
  try {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5, hl: "zh-cn" }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return `Serper API error (${resp.status}): ${errText.slice(0, 200)}`;
    }
    const json = await resp.json();
    const items = json.organic || [];
    if (items.length === 0) {
      return `No results found for: ${query}`;
    }
    let text = `Search results for "${query}":\n\n`;
    items.forEach((item, i) => {
      text += `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet || ""}\n\n`;
    });
    return text;
  } catch (err) {
    console.error("Serper Search error:", err.message);
    return `Search failed: ${err.message}`;
  }
}

// ===== Auto-Learn =====
function normalizeAutoLearnModel(model) {
  const raw = (model || "").trim();
  if (!raw) return "";

  // OpenRouter-only model format can be normalized back to official OpenAI format.
  if (raw.includes("/")) {
    const [provider, shortId] = raw.split("/", 2);
    if (provider.toLowerCase() === "openai" && !openrouterClient && openaiClient && shortId) {
      return shortId;
    }
    return raw;
  }

  // If user sets an OpenAI-family model while only OpenRouter is configured, auto-prefix it.
  const isOpenAIStyle = /^(gpt|o[0-9]|chatgpt)/i.test(raw);
  if (isOpenAIStyle && !openaiClient && openrouterClient) {
    return `openai/${raw}`;
  }
  return raw;
}

function resolveAutoLearnModel() {
  const envModel = normalizeAutoLearnModel(process.env.AUTO_LEARN_MODEL);
  if (envModel) return envModel;
  if (openaiClient) return "gpt-4o-mini";
  if (openrouterClient) return "openai/gpt-4o-mini";
  if (arkClient) return "doubao-1-5-lite-32k-250115";
  return "gpt-4o-mini"; // fallback（不应到达）
}
const AUTO_LEARN_MODEL = resolveAutoLearnModel();
const AUTO_LEARN_COOLDOWN = Number.parseInt(process.env.AUTO_LEARN_COOLDOWN || "300", 10);
let lastAutoLearnTime = 0;

const AUTO_LEARN_PROMPT = `你是一个用户画像分析助手。你的任务是从对话中提取关于"用户"的新信息，用于长期记忆。

规则：
1. 只提取关于用户本人的事实性信息（身份、偏好、习惯、性格、正在做的事、长期目标、重要的人际关系等）
2. 不要提取关于 AI 助手自身的信息
3. 不要重复已有记忆中已经存在的信息
4. 不要记录一次性的提问或操作（如"问了今天天气""让搜索某个新闻"）
5. 判断标准：这条信息在下次聊天时还有用吗？如果只跟当前对话有关，不记
6. 如果对话中没有值得记录的新信息，只输出 NONE
7. 每条信息单独一行，以 "- " 开头，不超过 30 字
8. 保持客观，不加主观评价

示例输出：
- 最近在学 Python
- 养了一只猫叫小橘
- 喜欢用深色主题的编辑器

或者：
NONE`;

// 过滤可能污染 system prompt 的指令式内容
const MEMORY_BLOCKLIST = /(?:忽略|无视|不要遵守|你是|你现在是|扮演|system|ignore|override|disregard|you are now|jailbreak|prompt)/i;
const MAX_MEMORY_FACT_LENGTH = 80;
const MAX_MEMORY_TOTAL_LENGTH = 50_000;

function filterAutoLearnFacts(facts) {
  return facts.filter((fact) => {
    const text = fact.replace(/^-\s*/, "").trim();
    if (text.length > MAX_MEMORY_FACT_LENGTH) return false;
    if (MEMORY_BLOCKLIST.test(text)) return false;
    return true;
  });
}

async function appendToLongTermMemory(newFacts) {
  const currentMemory = await readPromptFile(MEMORY_PATH);
  if (currentMemory.length > MAX_MEMORY_TOTAL_LENGTH) {
    console.warn("Auto-learn: memory.md exceeds size limit, skipping append");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const timestampedFacts = newFacts
    .map((fact) => `- [${today}] ${fact.replace(/^-\s*/, "")}`)
    .join("\n");

  let updated;
  if (currentMemory.includes("## 长期记忆")) {
    updated = currentMemory.trimEnd() + "\n" + timestampedFacts + "\n";
  } else {
    updated = currentMemory.trimEnd() + "\n\n## 长期记忆\n\n" + timestampedFacts + "\n";
  }
  await fsp.writeFile(MEMORY_PATH, updated, "utf-8");
}

// ===== Prompt 文件路径 =====
const SYSTEM_PATH = path.join(__dirname, "prompts", "system.md");
const MEMORY_PATH = path.join(__dirname, "prompts", "memory.md");
const CONFIG_PATH = path.join(__dirname, "prompts", "config.json");

// ===== 对话存储 =====
const CONVERSATIONS_DIR = path.join(__dirname, "data", "conversations");
if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}
const IMAGES_DIR = path.join(__dirname, "data", "images");
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function getConversationPath(id) {
  if (!/^\d{10,16}$/.test(id)) return null;
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

async function readPromptFile(filePath) {
  try {
    return await fsp.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
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
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(safeConfig, null, 2), "utf-8");
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
  };
}

function isPlainObject(input) {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function validatePromptPatch(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const next = {};
  if (body.system !== undefined) {
    if (typeof body.system !== "string") {
      return { ok: false, error: "`system` must be a string." };
    }
    if (body.system.length > 200_000) {
      return { ok: false, error: "`system` is too large." };
    }
    next.system = body.system;
  }
  if (body.memory !== undefined) {
    if (typeof body.memory !== "string") {
      return { ok: false, error: "`memory` must be a string." };
    }
    if (body.memory.length > 200_000) {
      return { ok: false, error: "`memory` is too large." };
    }
    next.memory = body.memory;
  }
  return { ok: true, value: next };
}

function validateConfigPatch(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be an object." };
  }

  const allowedKeys = new Set([
    "model",
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
    "context_window",
  ]);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    return { ok: false, error: `Unknown config field: ${unknownKey}` };
  }

  const patch = {};

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 120) {
      return { ok: false, error: "`model` must be a non-empty string (max 120 chars)." };
    }
    patch.model = body.model.trim();
  }

  const numericFields = [
    ["temperature", 0, 2],
    ["top_p", 0, 1],
    ["presence_penalty", -2, 2],
    ["frequency_penalty", -2, 2],
    ["context_window", 4, 500],
  ];
  for (const [field, min, max] of numericFields) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "number" || Number.isNaN(body[field])) {
      return { ok: false, error: `\`${field}\` must be a number.` };
    }
    if (body[field] < min || body[field] > max) {
      return { ok: false, error: `\`${field}\` must be in range [${min}, ${max}].` };
    }
    patch[field] = body[field];
  }

  return { ok: true, value: patch };
}

function validateConversation(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be an object." };
  }
  if (typeof body.id !== "string" || !/^\d{10,16}$/.test(body.id)) {
    return { ok: false, error: "`id` must be a numeric string (10-16 digits)." };
  }
  if (typeof body.title !== "string" || body.title.length > 200) {
    return { ok: false, error: "`title` must be a string (max 200 chars)." };
  }
  if (!Array.isArray(body.messages) || body.messages.length > 500) {
    return { ok: false, error: "`messages` must be an array (max 500 items)." };
  }
  for (const msg of body.messages) {
    if (!isPlainObject(msg)) {
      return { ok: false, error: "Each message must be an object." };
    }
    if (!["user", "assistant", "system"].includes(msg.role)) {
      return { ok: false, error: `Invalid role: ${msg.role}` };
    }
    // 单条消息体积限制
    if (typeof msg.content === "string" && msg.content.length > 30_000) {
      return { ok: false, error: "Message content is too large (max 30000 chars)." };
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string" && part.text.length > 10_000) {
          return { ok: false, error: "Text content part is too large (max 10000 chars)." };
        }
        if (part.type === "image_url" && typeof part.image_url?.url === "string" && part.image_url.url.length > 8_000_000) {
          return { ok: false, error: "Image content part is too large." };
        }
      }
    }
  }
  return { ok: true };
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return { ok: false, error: "`messages` must be an array." };
  }
  if (messages.length === 0 || messages.length > 500) {
    return { ok: false, error: "`messages` length must be between 1 and 500." };
  }

  const allowedRoles = new Set(["system", "user", "assistant"]);
  const normalized = [];

  for (const msg of messages) {
    if (!isPlainObject(msg)) {
      return { ok: false, error: "Each message must be an object." };
    }
    if (!allowedRoles.has(msg.role)) {
      return { ok: false, error: `Invalid role: ${msg.role}` };
    }

    if (typeof msg.content === "string") {
      if (msg.content.length > 30_000) {
        return { ok: false, error: "Message content is too large." };
      }
      normalized.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (Array.isArray(msg.content)) {
      if (!["user", "assistant"].includes(msg.role)) {
        return { ok: false, error: "Only user/assistant messages can have multi-part content." };
      }
      if (msg.content.length === 0 || msg.content.length > 10) {
        return { ok: false, error: "Multi-part content length must be between 1 and 10." };
      }

      const parts = [];
      for (const part of msg.content) {
        if (!isPlainObject(part)) {
          return { ok: false, error: "Content part must be an object." };
        }
        if (part.type === "text") {
          if (typeof part.text !== "string" || part.text.length > 10_000) {
            return { ok: false, error: "Text content part is invalid." };
          }
          parts.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "image_url") {
          const url = part.image_url?.url;
          if (typeof url !== "string") {
            return { ok: false, error: "Image URL must be a string." };
          }
          const isDataUrl = url.startsWith("data:image/") && url.includes(";base64,");
          const isServerPath = /^\/images\/[a-zA-Z0-9_.-]+$/.test(url) && !url.includes("..");
          if (!isDataUrl && !isServerPath) {
            return { ok: false, error: "Image must be a data URL or server path." };
          }
          if (isDataUrl && url.length > 8_000_000) {
            return { ok: false, error: "Image content part is too large." };
          }
          parts.push({ type: "image_url", image_url: { url } });
          continue;
        }
        return { ok: false, error: `Unsupported content part type: ${part.type}` };
      }

      normalized.push({ role: msg.role, content: parts });
      continue;
    }

    return { ok: false, error: "Message content must be string or array." };
  }

  return { ok: true, value: normalized };
}

function isLoopbackIp(ip = "") {
  const normalized = ip.replace("::ffff:", "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function readBearerToken(req) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function buildSystemPrompt() {
  const [system, memory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);
  const parts = [];
  if (system) parts.push(system);
  if (memory) parts.push("\n---\n\n# 关于用户的记忆\n\n" + memory);
  return parts.join("\n");
}

app.use("/api", (req, res, next) => {
  if (ADMIN_TOKEN) {
    const token = readBearerToken(req);
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ error: "Unauthorized. Provide a valid ADMIN_TOKEN." });
    }
    return next();
  }

  if (!isLoopbackIp(req.ip)) {
    return res
      .status(403)
      .json({ error: `Forbidden for non-local access from ${req.ip}. Set ADMIN_TOKEN to enable remote access.` });
  }
  return next();
});

// ===== 图片静态服务与上传 =====
app.use("/images", express.static(IMAGES_DIR));

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .replace(/\.{2,}/g, "_")
        .replace(/^\./, "_");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    cb(null, allowed.includes(file.mimetype) && allowedExts.includes(ext));
  },
});

// ===== API: 读取 prompt 文件 =====
app.get("/api/prompts", async (req, res) => {
  const [system, memory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);
  res.json({ system, memory });
});

// ===== API: 保存 prompt 文件 =====
const BACKUPS_DIR = path.join(__dirname, "prompts", "backups");

app.put("/api/prompts", async (req, res) => {
  // 提取 backup 标志（不参与 validate）
  const wantBackup = !!req.body?.backup;
  const body = { ...req.body };
  delete body.backup;

  const validated = validatePromptPatch(body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const { system, memory } = validated.value;
  try {
    // 备份旧 Prompt
    if (wantBackup) {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      const [oldSystem, oldMemory] = await Promise.all([
        readPromptFile(SYSTEM_PATH),
        readPromptFile(MEMORY_PATH),
      ]);
      const backupData = {
        timestamp: new Date().toISOString(),
        system: oldSystem,
        memory: oldMemory,
      };
      const backupFile = path.join(BACKUPS_DIR, `${Date.now()}.json`);
      await fsp.writeFile(backupFile, JSON.stringify(backupData, null, 2), "utf-8");
      console.log(`Prompt backup saved: ${backupFile}`);
    }

    const writes = [];
    if (system !== undefined) writes.push(fsp.writeFile(SYSTEM_PATH, system, "utf-8"));
    if (memory !== undefined) writes.push(fsp.writeFile(MEMORY_PATH, memory, "utf-8"));
    await Promise.all(writes);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 读取/保存模型配置 =====
app.get("/api/config", async (req, res) => {
  res.json(await readConfig());
});

app.put("/api/config", async (req, res) => {
  const validated = validateConfigPatch(req.body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const current = await readConfig();
    const updated = await saveConfig({ ...current, ...validated.value });
    res.json({ ok: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 自动学习用户记忆 =====
app.post("/api/memory/auto-learn", async (req, res) => {
  const now = Date.now();
  if (now - lastAutoLearnTime < AUTO_LEARN_COOLDOWN * 1000) {
    return res.json({ learned: [], skipped: "cooldown" });
  }

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }

  const learnAllowedRoles = new Set(["user", "assistant", "system"]);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isPlainObject(msg)) {
      return res.status(400).json({ error: `messages[${i}] must be an object` });
    }
    if (typeof msg.role !== "string" || !learnAllowedRoles.has(msg.role)) {
      return res.status(400).json({ error: `messages[${i}].role must be one of: user, assistant, system` });
    }
    if (!(typeof msg.content === "string" || Array.isArray(msg.content))) {
      return res.status(400).json({ error: `messages[${i}].content must be a string or array` });
    }
    let contentLength = 0;
    if (typeof msg.content === "string") {
      contentLength = msg.content.length;
    } else {
      for (let j = 0; j < msg.content.length; j++) {
        const part = msg.content[j];
        if (!isPlainObject(part)) {
          return res.status(400).json({ error: `messages[${i}].content[${j}] must be an object` });
        }
        if (part.type === "text" && typeof part.text === "string") {
          contentLength += part.text.length;
        }
      }
    }
    if (contentLength > 20_000) {
      return res.status(400).json({ error: `messages[${i}] content too large (max 20000 chars)` });
    }
  }

  const recentMessages = messages.slice(-4);
  const totalLength = recentMessages.reduce((sum, m) => {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("")
          : "";
    return sum + text.length;
  }, 0);

  if (totalLength < 20) {
    return res.json({ learned: [], skipped: "too_short" });
  }

  try {
    const currentMemory = await readPromptFile(MEMORY_PATH);
    const conversationText = recentMessages
      .map((m) => {
        const role = m.role === "user" ? "用户" : "AI";
        const text =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
              : "";
        return `${role}: ${text}`;
      })
      .join("\n\n");

    const learnClient = getClientForModel(AUTO_LEARN_MODEL);
    const response = await learnClient.chat.completions.create({
      model: AUTO_LEARN_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: AUTO_LEARN_PROMPT },
        { role: "user", content: `已有记忆：\n${currentMemory}\n\n---\n\n最近的对话：\n${conversationText}` },
      ],
    });

    const output = (response.choices[0]?.message?.content || "").trim();
    if (output === "NONE" || !output) {
      lastAutoLearnTime = now;
      return res.json({ learned: [] });
    }

    const rawFacts = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && line.length > 3);

    const facts = filterAutoLearnFacts(rawFacts);

    if (facts.length === 0) {
      lastAutoLearnTime = now;
      return res.json({ learned: [], filtered: rawFacts.length - facts.length || undefined });
    }

    await appendToLongTermMemory(facts);
    lastAutoLearnTime = now;
    console.log(`Auto-learn: extracted ${facts.length} new facts`);
    return res.json({ learned: facts });
  } catch (err) {
    console.error("Auto-learn error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ===== API: 对话存储 =====
app.get("/api/conversations", async (req, res) => {
  try {
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter((f) => f.endsWith(".json"));
    const list = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8"));
        list.push({ id: data.id, title: data.title, messageCount: (data.messages || []).length });
      } catch {
        // 跳过损坏文件
      }
    }
    list.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations/search", async (req, res) => {
  const q = (req.body?.q || "").trim().toLowerCase();
  if (!q || q.length > 200) {
    return res.status(400).json({ error: "Search query invalid (1-200 chars)." });
  }
  try {
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter((f) => f.endsWith(".json"));
    const results = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8"));
        let matched = false;
        let matchSnippet = "";
        if (data.title && data.title.toLowerCase().includes(q)) {
          matched = true;
          matchSnippet = data.title;
        }
        if (!matched && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            const text =
              typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ")
                  : "";
            if (text.toLowerCase().includes(q)) {
              matched = true;
              const idx = text.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 20);
              const end = Math.min(text.length, idx + q.length + 40);
              matchSnippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
              break;
            }
          }
        }
        if (matched) {
          results.push({ id: data.id, title: data.title, snippet: matchSnippet });
        }
      } catch {
        // 跳过损坏文件
      }
    }
    results.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations/:id", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "Conversation not found." });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/conversations/:id", async (req, res) => {
  const id = req.params.id;
  const filePath = getConversationPath(id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  const body = { ...req.body, id };
  const validated = validateConversation(body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }
  try {
    const toSave = {
      id: body.id,
      title: body.title,
      messages: body.messages,
      updatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(filePath, JSON.stringify(toSave), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    await fsp.unlink(filePath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.json({ ok: true });
    res.status(500).json({ error: err.message });
  }
});

// 批量删除对话
app.post("/api/conversations/batch-delete", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "`ids` must be a non-empty array." });
  }
  if (ids.length > 2000) {
    return res.status(400).json({ error: "Too many ids (max 2000)." });
  }
  const results = { deleted: 0, failed: 0 };
  for (const id of ids) {
    const filePath = getConversationPath(id);
    if (!filePath) { results.failed++; continue; }
    try {
      await fsp.unlink(filePath);
      results.deleted++;
    } catch (err) {
      if (err.code === "ENOENT") results.deleted++;
      else results.failed++;
    }
  }
  res.json({ ok: true, ...results });
});

// ===== API: 图片上传 =====
app.post("/api/images", imageUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No valid image file." });
  res.json({ ok: true, url: "/images/" + req.file.filename });
});

// ===== API: 可用模型列表 =====
const OPENAI_ALLOW = /^(gpt-4o(-2024-(05-13|08-06|11-20))?|gpt-4\.1(-mini|-nano)?|o3(-mini)?)$/;
const ARK_ALLOW = ["glm", "kimi"];

app.get("/api/models", async (req, res) => {
  try {
    // OpenAI 模型（白名单）
    const openaiModels = [];
    if (openaiClient) {
      try {
        for await (const m of await openaiClient.models.list()) {
          if (OPENAI_ALLOW.test(m.id)) {
            openaiModels.push(m.id);
          }
        }
        openaiModels.sort();
      } catch (err) {
        console.error("获取 OpenAI 模型列表失败:", formatProviderError(err));
      }
    }

    // 火山引擎模型（白名单：GLM / Kimi）
    let arkModels = [];
    if (arkClient) {
      try {
        for await (const m of await arkClient.models.list()) {
          if (ARK_ALLOW.some((kw) => m.id.toLowerCase().includes(kw))) {
            arkModels.push(m.id);
          }
        }
        arkModels.sort();
      } catch (err) {
        console.error("获取火山引擎模型列表失败:", formatProviderError(err));
      }
    }

    // OpenRouter 模型（同样只保留 GPT 系列，给无国际信用卡用户提供替代通道）
    let orModels = [];
    if (openrouterClient) {
      try {
        for await (const m of await openrouterClient.models.list()) {
          const shortId = m.id.includes("/") ? m.id.split("/").pop() : m.id;
          if (OPENAI_ALLOW.test(shortId)) {
            orModels.push(m.id);
          }
        }
        orModels.sort();
      } catch (err) {
        console.error("获取 OpenRouter 模型列表失败:", formatProviderError(err));
      }
    }

    res.json([...openaiModels, ...arkModels, ...orModels]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== API: 对话总结生成 Prompt =====
// 第一步：从对话中提取新发现（不改动现有 prompt）
const SUMMARIZE_PROMPT = `你是一个对话分析专家。请分析用户与 AI 的多段历史对话，提取有价值的新发现。

## 重要原则
你的任务是**只提取新信息**，不要重写或修改用户现有的 Prompt 和记忆。
你会收到用户现有的系统提示词和记忆文件作为参考——用来**去重**，避免重复提取已有的信息。

## 任务一：提取人格风格发现（newSystemFindings）
从对话中提取关于 AI 应有的人格、风格、行为规范方面的新发现：
- 用户对 AI 的称呼、语气、风格要求
- 用户喜欢或讨厌的 AI 回复方式
- 对话中体现的交流模式偏好
- 每条以 "- " 开头，简明扼要
- 如果该信息在现有 Prompt 中已存在，**跳过不提取**
- 如果没有新发现，输出空字符串

## 任务二：提取用户画像发现（newMemoryFindings）
从对话中提取关于用户本人的新事实：
- 身份、职业、兴趣、偏好、习惯、经历等
- 每条以 "- " 开头，不超过 30 字
- 如果该信息在现有记忆中已存在，**跳过不提取**
- 如果没有新发现，输出空字符串

## 任务三：发现摘要（notes）
简短说明你发现了什么，2-5 条。

请严格按以下 JSON 格式输出，不要输出其他内容：
\`\`\`json
{
  "newSystemFindings": "- 发现1\\n- 发现2",
  "newMemoryFindings": "- 用户事实1\\n- 用户事实2",
  "notes": "- 摘要1\\n- 摘要2"
}
\`\`\``;

// 第二步：将新发现融合到现有 prompt 中
const MERGE_PROMPT = `你是一个 Prompt 融合专家。请将新发现的信息融合到用户现有的 Prompt 和记忆中。

## 重要原则
- 现有内容是用户精心调整过的，**必须保留原文的结构、风格和所有内容**
- 你的工作是**追加和微调**，不是重写
- 只在必要时做措辞调整以自然融入新信息
- 如果新发现与现有内容矛盾，以新发现为准（更新而非删除）

## 任务一：融合系统提示词（mergedSystem）
将新的人格风格发现融合到现有系统提示词中：
- 保持现有 Prompt 的整体结构和段落划分
- 在合适的位置插入或补充新信息
- 如果现有 Prompt 为空，则基于新发现从零生成

## 任务二：融合用户记忆（mergedMemory）
将新的用户画像发现追加到现有记忆中：
- 保留全部现有记忆条目
- 将新发现追加在末尾
- 格式统一为 "- " 开头

请严格按以下 JSON 格式输出，不要输出其他内容：
\`\`\`json
{
  "mergedSystem": "融合后的完整系统提示词",
  "mergedMemory": "融合后的完整记忆内容"
}
\`\`\``;

app.post("/api/conversations/summarize", async (req, res) => {
  const ids = req.body?.conversationIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
    return res.status(400).json({ error: "请选择 1-50 条对话" });
  }
  const model = (typeof req.body?.model === "string" && req.body.model.trim())
    ? req.body.model.trim()
    : (await readConfig()).model;

  // 读取现有 Prompt 作为基线
  const [currentSystem, currentMemory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);

  // 逐条加载对话并采样，超预算则停止，告知用户实际分析了多少条
  const TOTAL_BUDGET = 24000; // 对话内容总字符预算
  const MSG_SAMPLE = 10;      // 每条对话均匀采样消息数
  const MSG_CHAR_LIMIT = 500; // 每条消息截取字符上限

  function sampleEvenly(arr, count) {
    if (arr.length <= count) return arr;
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round(i * (arr.length - 1) / (count - 1));
      result.push(arr[idx]);
    }
    return result;
  }

  const allSamples = [];
  let usedChars = 0;
  const analyzedTitles = [];
  const skippedTitles = [];
  let budgetHit = false;

  for (const id of ids) {
    const filePath = getConversationPath(id);
    if (!filePath) continue;
    try {
      const data = JSON.parse(await fsp.readFile(filePath, "utf-8"));
      const title = (data.title || "未命名").slice(0, 30);

      if (budgetHit) {
        skippedTitles.push(title);
        continue;
      }

      const allMsgs = (data.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant");
      const sampled = sampleEvenly(allMsgs, MSG_SAMPLE);
      const sample = sampled
        .map((m) => {
          const text =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(m.content)
                ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
                : "";
          return `${m.role === "user" ? "用户" : "AI"}: ${text.slice(0, MSG_CHAR_LIMIT)}`;
        })
        .join("\n");
      if (!sample) continue;

      const entry = `### ${title}\n${sample}`;
      if (usedChars + entry.length > TOTAL_BUDGET) {
        budgetHit = true;
        skippedTitles.push(title);
        continue;
      }
      allSamples.push(entry);
      usedChars += entry.length;
      analyzedTitles.push(title);
    } catch {
      // 跳过读取失败的对话
    }
  }

  if (allSamples.length === 0) {
    return res.status(400).json({ error: "没有可用的对话内容" });
  }

  // 构建用户消息（含现有 Prompt 基线 + 对话样本）
  let userContent = "## 现有系统提示词\n\n";
  userContent += currentSystem || "（空）";
  userContent += "\n\n## 现有用户记忆\n\n";
  userContent += currentMemory || "（空）";
  userContent += "\n\n## 历史对话摘要\n\n";
  userContent += allSamples.join("\n\n---\n\n");

  try {
    const client = getClientForModel(model);
    console.log(`[summarize] model: ${model}, conversations: ${allSamples.length}, content: ${userContent.length} chars`);
    const response = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SUMMARIZE_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const output = response.choices[0]?.message?.content || "";

    // 解析 JSON 输出（兼容 ```json 代码块）
    let parsed;
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)```/)
                     || output.match(/\{[\s\S]*"suggestedSystem"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : output;
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return res.status(502).json({
        error: "模型返回格式异常，无法解析为 JSON。请重试或更换模型。",
      });
    }

    res.json({
      newSystemFindings: String(parsed.newSystemFindings || ""),
      newMemoryFindings: String(parsed.newMemoryFindings || ""),
      notes: String(parsed.notes || ""),
      analyzedCount: analyzedTitles.length,
      totalSelected: ids.length,
      skippedTitles,
    });
  } catch (err) {
    const message = formatProviderError(err);
    console.error("Summarize API error:", message);
    res.status(500).json({ error: message });
  }
});

// ===== API: 融合 Prompt =====
app.post("/api/conversations/merge-prompt", async (req, res) => {
  const { newSystemFindings, newMemoryFindings, model: reqModel } = req.body || {};

  if (!newSystemFindings && !newMemoryFindings) {
    return res.status(400).json({ error: "没有需要融合的新发现" });
  }

  const model = (typeof reqModel === "string" && reqModel.trim())
    ? reqModel.trim()
    : (await readConfig()).model;

  const [currentSystem, currentMemory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);

  let userContent = "## 现有系统提示词\n\n";
  userContent += currentSystem || "（空）";
  userContent += "\n\n## 现有用户记忆\n\n";
  userContent += currentMemory || "（空）";
  userContent += "\n\n## 新发现的人格风格信息\n\n";
  userContent += newSystemFindings || "（无）";
  userContent += "\n\n## 新发现的用户画像信息\n\n";
  userContent += newMemoryFindings || "（无）";

  try {
    const client = getClientForModel(model);
    console.log(`[merge-prompt] model: ${model}, content: ${userContent.length} chars`);
    const response = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: MERGE_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const output = response.choices[0]?.message?.content || "";

    let parsed;
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)```/)
                     || output.match(/\{[\s\S]*"mergedSystem"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : output;
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return res.status(502).json({
        error: "模型返回格式异常，无法解析为 JSON。请重试或更换模型。",
      });
    }

    res.json({
      mergedSystem: String(parsed.mergedSystem || ""),
      mergedMemory: String(parsed.mergedMemory || ""),
    });
  } catch (err) {
    const message = formatProviderError(err);
    console.error("Merge prompt API error:", message);
    res.status(500).json({ error: message });
  }
});

// ===== API: 流式聊天 =====
app.post("/api/chat", async (req, res) => {
  const validated = validateMessages(req.body?.messages);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const abortController = new AbortController();
  const onClientDisconnect = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  req.on("aborted", onClientDisconnect);
  res.on("close", onClientDisconnect);
  let startedSse = false;

  // 120 秒超时保护，防止请求卡死整个服务器
  const requestTimeout = setTimeout(() => {
    console.error("[chat] request timeout (120s), aborting");
    abortController.abort();
  }, 120_000);

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setTimeout(0);
    }
    startedSse = true;

    // 立即发一个状态事件：给用户即时反馈 + 冲刷连接缓冲
    res.write(`data: ${JSON.stringify({ status: "思考中..." })}\n\n`);

    const [config, systemPrompt] = await Promise.all([readConfig(), buildSystemPrompt()]);
    const client = getClientForModel(config.model);

    const baseParams = {
      model: config.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: config.temperature ?? 1,
    };
    if (config.top_p !== undefined) baseParams.top_p = config.top_p;
    if (config.presence_penalty !== undefined) baseParams.presence_penalty = config.presence_penalty;
    if (config.frequency_penalty !== undefined) baseParams.frequency_penalty = config.frequency_penalty;

    // 配置了 Serper API Key 时启用搜索工具
    // 以下模型不支持标准 function calling，需要跳过：
    //   - 推理模型（deepseek-r1、doubao-thinking）：无 tool_calls 能力
    //   - GLM 系列：会输出"调用工具"文本但不返回结构化 tool_calls
    const noToolsModel = /(-r1|-thinking)|(^|\/)glm-/i.test(config.model);
    if (SERPER_API_KEY && !noToolsModel) {
      baseParams.tools = [SEARCH_TOOL];
    }

    const allMessages = [];
    if (systemPrompt) {
      allMessages.push({ role: "system", content: systemPrompt });
    }
    allMessages.push(...validated.value);

    // 将服务端图片路径转为 base64 data URL（模型只认 base64 或公网 URL）
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("/images/")) {
          try {
            const imgPath = path.join(IMAGES_DIR, path.basename(part.image_url.url));
            const buf = await fsp.readFile(imgPath);
            const ext = path.extname(imgPath).slice(1).toLowerCase();
            const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
            part.image_url.url = "data:" + (mimeMap[ext] || "image/png") + ";base64," + buf.toString("base64");
          } catch (e) {
            console.error("Failed to read image:", part.image_url.url, e.message);
            part.type = "text";
            part.text = "[图片不可用]";
            delete part.image_url;
          }
        }
      }
    }

    // assistant 多模态消息降级为纯文本（模型不需要看自己以前生成的图片）
    for (const msg of allMessages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p) => p.type === "text").map((p) => p.text);
        msg.content = textParts.join("\n") || "[图片]";
      }
    }

    // Token 统计（跨多轮累加）
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // 多轮 tool-call 循环
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (abortController.signal.aborted || res.writableEnded) break;

      console.log(`[chat] round ${round + 1}/${MAX_TOOL_ROUNDS}, messages: ${allMessages.length}, model: ${baseParams.model}, tools: ${baseParams.tools ? "yes" : "no"}`);
      const stream = await client.chat.completions.create(
        { ...baseParams, messages: allMessages },
        { signal: abortController.signal },
      );
      console.log("[chat] stream created, reading chunks...");

      let assistantContent = "";
      let toolCalls = [];
      let finishReason = null;
      let chunkCount = 0;

      for await (const chunk of stream) {
        chunkCount++;
        if (abortController.signal.aborted || res.writableEnded) break;

        // 收集 usage（最后一个 chunk 才有，此时 choices 可能为空）
        if (chunk.usage) {
          totalPromptTokens += chunk.usage.prompt_tokens || 0;
          totalCompletionTokens += chunk.usage.completion_tokens || 0;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          console.log(`[chat] finish_reason: ${finishReason}`);
        }

        const delta = choice.delta;
        if (!delta) continue;

        // 思考链（DeepSeek R1、doubao-thinking 等模型）→ 转发给前端展示
        if (delta.reasoning_content) {
          res.write(`data: ${JSON.stringify({ reasoning: delta.reasoning_content })}\n\n`);
        }

        // 正常内容 → 直接转发
        if (delta.content) {
          assistantContent += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        // tool_calls 增量拼接
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      console.log(`[chat] stream done, ${chunkCount} chunks, finishReason: ${finishReason}`);

      // 不是 tool_calls → 跳出循环
      if (finishReason !== "tool_calls" || toolCalls.length === 0) {
        console.log(`[chat] no tool_calls, finishing`);
        break;
      }

      console.log(`[chat] tool_calls detected: ${toolCalls.map((t) => t.function.name).join(", ")}`);

      // 将 assistant 的 tool_calls 消息追加到对话
      allMessages.push({ role: "assistant", content: assistantContent || null, tool_calls: toolCalls });

      // 逐个执行 tool call
      for (const tc of toolCalls) {
        if (tc.function.name === "web_search") {
          let args;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { query: tc.function.arguments };
          }
          console.log(`[chat] searching: "${args.query}"`);
          res.write(`data: ${JSON.stringify({ status: `正在搜索：${args.query}` })}\n\n`);
          const result = await executeWebSearch(args.query);
          console.log(`[chat] search done, result length: ${result.length}`);
          allMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
        } else {
          allMessages.push({ role: "tool", tool_call_id: tc.id, content: `Unknown tool: ${tc.function.name}` });
        }
      }
      // 循环继续 → 带着 tool results 再次调 OpenAI
    }

    if (!res.writableEnded) {
      // 发送 meta 信息（token 用量 + 模型名）
      if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
        res.write(`data: ${JSON.stringify({
          meta: {
            model: config.model,
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalPromptTokens + totalCompletionTokens,
          }
        })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    clearTimeout(requestTimeout);
    if (abortController.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    const message = formatProviderError(err);
    console.error("Model API error:", message);
    if (startedSse && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
      return;
    }
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  } finally {
    clearTimeout(requestTimeout);
    req.off("aborted", onClientDisconnect);
    res.off("close", onClientDisconnect);
  }
});

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, async () => {
  const config = await readConfig();
  console.log(`服务已启动: http://${HOST}:${PORT}`);
  console.log(`当前模型: ${config.model}`);
  console.log(`温度: ${config.temperature}`);
  if (!ADMIN_TOKEN) {
    console.log("未设置 ADMIN_TOKEN，仅允许本机访问 /api。");
  }
});
