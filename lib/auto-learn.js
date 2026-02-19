const fsp = require("fs").promises;
const { openaiClient, arkClient, openrouterClient } = require("./clients");
const { readPromptFile, MEMORY_PATH } = require("./prompts");

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

function getLastAutoLearnTime() {
  return lastAutoLearnTime;
}

function setLastAutoLearnTime(t) {
  lastAutoLearnTime = t;
}

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

module.exports = {
  normalizeAutoLearnModel,
  resolveAutoLearnModel,
  AUTO_LEARN_MODEL,
  AUTO_LEARN_COOLDOWN,
  getLastAutoLearnTime,
  setLastAutoLearnTime,
  AUTO_LEARN_PROMPT,
  MEMORY_BLOCKLIST,
  MAX_MEMORY_FACT_LENGTH,
  filterAutoLearnFacts,
  appendToLongTermMemory,
};
