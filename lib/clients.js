const OpenAI = require("openai");

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

module.exports = {
  openaiClient,
  arkClient,
  openrouterClient,
  getClientForModel,
  resolveDefaultModel,
  formatProviderError,
  DEFAULT_CONFIG,
};
