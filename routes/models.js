const router = require("express").Router();
const { openaiClient, arkClient, openrouterClient, formatProviderError } = require("../lib/clients");

const hasCustomOpenAIBase = !!(process.env.OPENAI_BASE_URL || "").trim();
const MAX_MODELS_SCAN = 2000;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存
const PROVIDER_TIMEOUT = 8_000;         // 单个 provider 最多等 8 秒

// Non-chat models to exclude
const EXCLUDE_PATTERN = /^(text-embedding|text-moderation|omni-moderation|text-search|text-similarity|code-search|canary-|whisper-|tts-|dall-e-|gpt-image|gpt-realtime|gpt-audio|sora-|babbage-|davinci-|ada-|curie-|ft:)/i;

function shouldExclude(id) {
  return EXCLUDE_PATTERN.test(id);
}

// 常见火山引擎模型（models.list 通常不可用，用作 fallback）
const ARK_COMMON = [
  "doubao-1-5-pro-32k-250115", "doubao-1-5-pro-256k-250115",
  "doubao-1-5-lite-32k-250115", "doubao-1-5-vision-pro-32k-250115",
  "doubao-pro-32k", "doubao-pro-256k", "doubao-lite-32k",
];

/** 带超时的 provider 模型列表获取 */
async function fetchWithTimeout(fn, ms) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function fetchOpenAI() {
  if (!openaiClient) return [];
  const provider = hasCustomOpenAIBase ? "openai-compat" : "openai";
  const models = [];
  let count = 0;
  for await (const m of await openaiClient.models.list()) {
    if (++count > MAX_MODELS_SCAN) break;
    if (!shouldExclude(m.id)) models.push({ id: m.id, provider });
  }
  return models;
}

async function fetchArk() {
  if (!arkClient) return [];
  try {
    const models = [];
    let count = 0;
    for await (const m of await arkClient.models.list()) {
      if (++count > MAX_MODELS_SCAN) break;
      if (!shouldExclude(m.id)) models.push({ id: m.id, provider: "ark" });
    }
    if (models.length > 0) return models;
  } catch { /* Ark 通常不支持 models.list，静默降级 */ }
  return ARK_COMMON.map(id => ({ id, provider: "ark" }));
}

async function fetchOpenRouter() {
  if (!openrouterClient) return [];
  const models = [];
  let count = 0;
  for await (const m of await openrouterClient.models.list()) {
    if (++count > MAX_MODELS_SCAN) break;
    if (!shouldExclude(m.id)) models.push({ id: m.id, provider: "openrouter" });
  }
  return models;
}

// ===== Cache =====
let modelCache = null;
let modelCacheTime = 0;

async function refreshCache() {
  // 三个 provider 并行请求，各自带超时
  const results = await Promise.allSettled([
    fetchWithTimeout(fetchOpenAI, PROVIDER_TIMEOUT),
    fetchWithTimeout(fetchArk, PROVIDER_TIMEOUT),
    fetchWithTimeout(fetchOpenRouter, PROVIDER_TIMEOUT),
  ]);

  const allModels = [];
  const names = ["OpenAI", "Ark", "OpenRouter"];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      allModels.push(...results[i].value);
    } else {
      console.error(`获取 ${names[i]} 模型列表失败:`, results[i].reason?.message || results[i].reason);
      // Ark fallback when timed out
      if (i === 1 && arkClient) allModels.push(...ARK_COMMON.map(id => ({ id, provider: "ark" })));
    }
  }

  allModels.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  modelCache = allModels;
  modelCacheTime = Date.now();
  return allModels;
}

// 启动时预热缓存（不阻塞启动）
setTimeout(() => refreshCache().catch(() => {}), 2000);

router.get("/models", async (req, res) => {
  if (modelCache && Date.now() - modelCacheTime < MODEL_CACHE_TTL) {
    return res.json(modelCache);
  }
  try {
    res.json(await refreshCache());
  } catch (err) {
    console.error("Failed to fetch models:", formatProviderError(err));
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
