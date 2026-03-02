const fsp = require("fs").promises;
const clients = require("./clients");
const { openaiClient, arkClient, openrouterClient } = clients;
const { readMemoryStore, writeMemoryStore, renderMemoryForPrompt, bigramOverlap } = require("./prompts");
const configLib = require("./config");

const withMemoryLock = configLib.createMutex();

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
const AUTO_LEARN_COOLDOWN = Number.parseInt(process.env.AUTO_LEARN_COOLDOWN || "180", 10);

// 按对话 ID 独立冷却（Map<convId, lastTime>）
const cooldownMap = new Map();
const COOLDOWN_MAP_MAX = 500; // 超过此数量时触发清理

function getLastAutoLearnTime(convId) {
  return cooldownMap.get(convId) || 0;
}

function setLastAutoLearnTime(convId, t) {
  cooldownMap.set(convId, t);
  // 定期清理已过期的冷却条目，防止 Map 无限增长
  if (cooldownMap.size > COOLDOWN_MAP_MAX) {
    const expireBefore = Date.now() - AUTO_LEARN_COOLDOWN * 1000;
    for (const [key, val] of cooldownMap) {
      if (val < expireBefore) cooldownMap.delete(key);
    }
  }
}

/** 原子检查并获取冷却期：按对话 ID 独立冷却，防止多对话互相阻塞 */
function tryAcquireCooldown(convId) {
  // 严格校验 convId 类型，防止对象引用绕过冷却期
  if (typeof convId !== "string" || convId.length === 0) return false;
  const now = Date.now();
  const lastTime = cooldownMap.get(convId) || 0;
  if (now - lastTime < AUTO_LEARN_COOLDOWN * 1000) {
    return false;
  }
  setLastAutoLearnTime(convId, now);
  return true;
}

const AUTO_LEARN_PROMPT = `你是一个用户画像分析助手。你的任务是从对话中提取关于"用户"的新信息，并检查是否与已有记忆冲突。

已有记忆中每条信息前面带有 [ID]，如 [m_1708000000000]。

规则：
1. 只提取关于用户本人的事实性信息（身份、偏好、习惯、性格、正在做的事、长期目标、重要的人际关系等）
2. 不要提取关于 AI 助手自身的信息
3. 不要记录一次性的提问或操作（如"问了今天天气""让搜索某个新闻"）
4. 不要记录 UI 操作类行为（如切换深色/浅色主题、调整窗口大小、开关某个面板等），这些是界面交互，不是用户偏好
5. 判断标准：这条信息在下次聊天时还有用吗？如果只跟当前对话有关，不记
5. 如果对话中没有值得记录的新信息，也没有需要更新的旧信息，只输出 NONE
6. 每条内容不超过 80 字，保持客观

操作类型：
- ADD: 全新信息，已有记忆中不存在。格式：- ADD [category] [importance:1-3] 内容
  importance 可选，默认为 2。评分标准：
  1 = 临时/可能变化的信息（近期计划、当前心情、正在做的事）
  2 = 一般事实（偏好、习惯、兴趣爱好）
  3 = 核心身份/长期不变的信息（姓名、职业、居住地、重要关系）
- UPDATE: 新信息取代某条已有记忆（状态变化或信息修正）。格式：- UPDATE [旧记忆ID] [category] [importance:1-3] 新内容
- DELETE: 某条已有记忆已明确过时或不再成立。格式：- DELETE [旧记忆ID]

category 取值：identity | preferences | events
  - identity: 身份信息（姓名、年龄、职业、居住地、重要关系等）
  - preferences: 偏好习惯（沟通风格、兴趣爱好、工具偏好等）
  - events: 近期动态（正在做的事、近期计划、当前状态等）

冲突判断：
- 状态变化算冲突（"在找工作"→"入职了Google"）→ UPDATE 或 DELETE + ADD
- 信息修正算冲突（"住在北京"→"搬到上海了"）→ UPDATE
- 补充细节不算冲突（"做前端开发"和"用 React"可以共存）→ ADD
- 不确定时宁可 ADD，不要误删

示例（已有记忆含 [m_1700000000000] ★ 正在找工作）：
当用户说"我上周入职了Google"时：
- UPDATE [m_1700000000000] [events] [importance:3] 上周入职了Google

或者：
- DELETE [m_1700000000000]
- ADD [identity] [importance:3] 在Google工作

或者：
NONE`;

const REFLECT_PROMPT = `你是一个记忆分析师。你的任务是从用户的近期动态中提炼高层模式和洞察。

下面是用户最近的一些近期动态记忆。请分析这些条目，找出：
1. 反复出现的主题或兴趣
2. 可以归纳为长期偏好或身份特征的模式
3. 暗示用户核心价值观或生活方式的线索

规则：
- 只输出归纳性的洞察，不要重复已有的事实
- 每条洞察不超过 80 字
- 洞察必须基于多条动态的交叉印证，不要从单条动态推断
- 如果动态太少或太零散，无法提炼有意义的模式，只输出 NONE
- 不要输出 UPDATE 或 DELETE，只用 ADD

输出格式（与记忆学习格式相同）：
- ADD [category] [importance:3] 洞察内容

category 取值：identity | preferences
- identity: 归纳出的身份特征（职业方向、长期角色等）
- preferences: 归纳出的偏好习惯（工作方式、兴趣模式等）

示例：
- ADD [preferences] [importance:3] 持续关注 AI 和编程领域，有技术学习的习惯
- ADD [identity] [importance:3] 是一个注重效率、喜欢自动化的开发者

或者：
NONE`;

const MAX_MEMORY_FACT_LENGTH = 80;
const MAX_MEMORY_TOTAL_LENGTH = 50_000;
const VALID_CATEGORIES = new Set(["identity", "preferences", "events"]);

const MAX_OPS_PER_CALL = 10;
const DEDUP_MERGE_THRESHOLD = 0.6;

function parseAutoLearnOutput(output) {
  if (!output || output.trim() === "NONE") return [];

  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    // ADD: "- ADD [category] [importance:1-3] text" (importance optional)
    const addMatch = line.match(/^-\s*ADD\s+\[(\w+)\]\s*(?:\[importance:([1-3])\]\s*)?(.+)$/i);
    if (addMatch) {
      const category = addMatch[1].toLowerCase();
      const importance = addMatch[2] ? parseInt(addMatch[2], 10) : 2;
      const text = addMatch[3].trim();
      if (VALID_CATEGORIES.has(category) && text && Array.from(text).length <= MAX_MEMORY_FACT_LENGTH) {
        results.push({ op: "add", category, text, importance });
      }
      continue;
    }

    // UPDATE: "- UPDATE [m_xxx] [category] [importance:1-3] text" (importance optional)
    const updateMatch = line.match(/^-\s*UPDATE\s+\[(m_\d{10,})\]\s+\[(\w+)\]\s*(?:\[importance:([1-3])\]\s*)?(.+)$/i);
    if (updateMatch) {
      const targetId = updateMatch[1].toLowerCase();
      const category = updateMatch[2].toLowerCase();
      const importance = updateMatch[3] ? parseInt(updateMatch[3], 10) : undefined;
      const text = updateMatch[4].trim();
      if (VALID_CATEGORIES.has(category) && text && Array.from(text).length <= MAX_MEMORY_FACT_LENGTH) {
        results.push({ op: "update", targetId, category, text, importance });
      }
      continue;
    }

    // DELETE: "- DELETE [m_xxx]"
    const deleteMatch = line.match(/^-\s*DELETE\s+\[(m_\d{10,})\]\s*$/i);
    if (deleteMatch) {
      results.push({ op: "delete", targetId: deleteMatch[1].toLowerCase() });
      continue;
    }

    // 向后兼容旧格式: "- [category] text" → ADD
    const legacyMatch = line.match(/^-\s*\[(\w+)\]\s*(.+)$/);
    if (legacyMatch) {
      const category = legacyMatch[1].toLowerCase();
      const text = legacyMatch[2].trim();
      if (VALID_CATEGORIES.has(category) && text && Array.from(text).length <= MAX_MEMORY_FACT_LENGTH) {
        results.push({ op: "add", category, text, importance: 2 });
      }
    }
  }

  // 防止 LLM 被诱导批量操作
  if (results.length > MAX_OPS_PER_CALL) {
    console.warn(`Auto-learn: truncating ${results.length} operations to ${MAX_OPS_PER_CALL}`);
    return results.slice(0, MAX_OPS_PER_CALL);
  }

  return results;
}

/** 收集 DELETE/UPDATE 操作的目标 ID */
function collectTargetIds(operations) {
  const ids = new Set();
  for (const op of operations) {
    if ((op.op === "delete" || op.op === "update") && op.targetId) {
      ids.add(op.targetId);
    }
  }
  return ids;
}

/**
 * 去重预处理：ADD 与同 category 已有记忆做 bigram 比较。
 * >60% → 转为 UPDATE（合并）；≤60% → 保持 ADD。
 */
function deduplicateAdds(operations, store, explicitTargetIds) {
  // 追踪已被匹配的旧 ID，防止同批多个相似 ADD 匹配到同一条旧记忆
  const matchedIds = new Set();
  return operations.map((op) => {
    if (op.op !== "add") return op;
    // 排除同批次 DELETE/UPDATE 指向的条目，避免 LLM 有意替换时误合并
    const candidates = (store[op.category] || [])
      .filter((item) => !explicitTargetIds.has(item.id) && !matchedIds.has(item.id));
    let bestMatch = null;
    let bestScore = 0;
    for (const existing of candidates) {
      const score = bigramOverlap(op.text, existing.text);
      if (score > bestScore) { bestScore = score; bestMatch = existing; }
    }
    if (bestScore > DEDUP_MERGE_THRESHOLD && bestMatch) {
      matchedIds.add(bestMatch.id);
      return {
        op: "update",
        targetId: bestMatch.id,
        category: op.category,
        text: op.text,
        importance: Math.max(op.importance ?? 2, bestMatch.importance ?? 2),
        _dedupMerge: true,
      };
    }
    return op;
  });
}

async function applyMemoryOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) return { overLimit: false, appliedOps: [] };

  return withMemoryLock(async () => {
    const store = await readMemoryStore();
    const overLimit = JSON.stringify(store).length > MAX_MEMORY_TOTAL_LENGTH;
    const appliedOps = [];

    // Phase 1: 收集 LLM 显式指定的 DELETE/UPDATE 目标（去重时排除这些条目）
    const explicitTargetIds = collectTargetIds(operations);

    // Phase 2: 去重 — ADD 与同 category 已有记忆 bigram 比较，高重叠自动转 UPDATE
    // 必须在 overLimit 检查之前执行，否则去重后本应变成 UPDATE 的 ADD 会被误杀
    operations = deduplicateAdds(operations, store, explicitTargetIds);

    // 超限时仅允许 DELETE/UPDATE（可减少体积），跳过纯 ADD
    if (overLimit) {
      const hasRemoval = operations.some((op) => op.op === "delete" || op.op === "update");
      if (!hasRemoval) {
        console.warn("Auto-learn: memory.json exceeds size limit, skipping pure adds");
        return { overLimit: true, appliedOps: [] };
      }
    }

    // Phase 3: 收集所有 idsToRemove（包含去重新增的 UPDATE 目标）
    const idsToRemove = collectTargetIds(operations);

    // UPDATE 元数据继承：在删除前收集旧条目的元数据
    const oldMeta = new Map();
    if (idsToRemove.size > 0) {
      for (const cat of ["identity", "preferences", "events"]) {
        for (const item of store[cat]) {
          if (idsToRemove.has(item.id)) {
            oldMeta.set(item.id, {
              useCount: item.useCount ?? 0,
              lastReferencedAt: item.lastReferencedAt ?? null,
              importance: item.importance ?? 2,
            });
          }
        }
      }
    }

    // 执行删除：从所有分类中移除目标 ID
    if (idsToRemove.size > 0) {
      let removedCount = 0;
      for (const category of ["identity", "preferences", "events"]) {
        const before = store[category].length;
        store[category] = store[category].filter((item) => !idsToRemove.has(item.id));
        removedCount += before - store[category].length;
      }
      if (removedCount === 0) {
        console.warn("Auto-learn: LLM referenced non-existent memory IDs:", [...idsToRemove]);
      }
    }

    // 记录 DELETE 操作到 appliedOps（仅已存在的 ID）
    for (const op of operations) {
      if (op.op === "delete" && op.targetId && oldMeta.has(op.targetId)) {
        appliedOps.push({ op: "delete", oldId: op.targetId });
      }
    }

    // 执行添加（ADD 和 UPDATE 的新内容；超限时需检查新增内容大小）
    const today = new Date().toISOString().slice(0, 10);
    const base = Date.now();
    let seq = 0;

    for (const op of operations) {
      if (overLimit && op.op === "add") continue;
      if ((op.op === "add" || op.op === "update") && VALID_CATEGORIES.has(op.category) && op.text) {
        const prev = (op.op === "update" && op.targetId) ? oldMeta.get(op.targetId) : null;
        const newItem = {
          id: `m_${base}${String(seq++).padStart(3, "0")}`,
          text: op.text,
          date: today,
          source: "ai_inferred",
          importance: op.importance ?? prev?.importance ?? 2,
          useCount: prev?.useCount ?? 0,
          lastReferencedAt: prev?.lastReferencedAt ?? null,
        };

        // 超限时，允许 UPDATE 让容量变小，拒绝让容量变大的操作
        if (overLimit && op.op === "update") {
          // UPDATE 允许执行(已在删除阶段移除旧条目)，直接添加新条目
          store[op.category].push(newItem);
        } else if (overLimit) {
          // ADD 操作需检查是否会进一步膨胀
          const currentSize = JSON.stringify(store).length;
          store[op.category].push(newItem);
          const newSize = JSON.stringify(store).length;
          if (newSize > currentSize) {
            // 超限且变大了，回滚这条 ADD
            store[op.category].pop();
            console.warn(`Auto-learn: ADD rejected (would exceed limit): ${op.text.slice(0, 40)}...`);
            continue;
          }
        } else {
          // 未超限，直接添加
          store[op.category].push(newItem);
        }

        appliedOps.push({
          op: op.op,
          id: newItem.id,
          ...(op.op === "update" && op.targetId ? { oldId: op.targetId } : {}),
          category: op.category,
          text: op.text,
          importance: newItem.importance,
          ...(op._dedupMerge ? { dedupMerge: true } : {}),
        });
      }
    }

    await writeMemoryStore(store);
    return { overLimit, appliedOps };
  });
}

/**
 * Phase 2A: 记忆衰减检查。
 * events: 空闲 > decayIdleDays 且 importance=1 → 删除；importance≥2 → 标记 stale
 * preferences: 空闲 > 90 天 → 标记 stale
 * identity: 不处理
 */
const MS_PER_DAY = 86_400_000;

/** 计算记忆条目的空闲天数（优先用 lastReferencedAt，其次 date）。无效日期返回 0。 */
function idleDays(item, now) {
  const ref = item.lastReferencedAt || item.date || "1970-01-01";
  const ts = new Date(ref).getTime();
  return Number.isNaN(ts) ? 0 : Math.max(0, (now - ts) / MS_PER_DAY);
}

async function performDecayCheck(config) {
  if (!config?.memory?.autoDecay) return { decayed: [], staled: [] };

  return withMemoryLock(async () => {
    const store = await readMemoryStore();
    const now = Date.now();
    const decayDays = config.memory.decayIdleDays ?? 30;
    // preferences 固定 90 天（identity 级别的习惯比 events 更持久，不跟随用户配置）
    const prefDecayDays = 90;
    const decayed = [];
    const staled = [];

    // events 衰减
    store.events = store.events.filter((item) => {
      const idle = idleDays(item, now);
      if (idle <= decayDays) return true;
      if ((item.importance ?? 2) === 1) {
        decayed.push({ id: item.id, text: item.text, category: "events" });
        return false;
      }
      if (!item.stale) {
        item.stale = true;
        staled.push({ id: item.id, text: item.text, category: "events" });
      }
      return true;
    });

    // preferences 衰减（只标记 stale，不删除）
    for (const item of store.preferences) {
      if (idleDays(item, now) > prefDecayDays && !item.stale) {
        item.stale = true;
        staled.push({ id: item.id, text: item.text, category: "preferences" });
      }
    }

    if (decayed.length > 0 || staled.length > 0) {
      await writeMemoryStore(store);
    }
    return { decayed, staled };
  });
}

/**
 * Phase 2B: 记忆晋升/降级
 * - events → preferences: useCount ≥ promotionUseCount 且 date 距今 ≥ promotionMinDays
 * - preferences → identity: useCount ≥ 20 且 date 距今 ≥ 60 天 且 importance=3
 * - preferences → events: idleDays > 90 且 useCount ≤ 2
 */
async function performPromotionCheck(config) {
  if (!config?.memory?.autoPromotion) return { promoted: [], demoted: [] };

  return withMemoryLock(async () => {
    const store = await readMemoryStore();
    const now = Date.now();
    const promotionUseCount = config.memory.promotionUseCount ?? 5;
    const promotionMinDays = config.memory.promotionMinDays ?? 14;
    const promoted = [];
    const demoted = [];

    // 计算条目创建至今的天数（晋升看"存在多久"，与 idleDays 的"闲置多久"语义不同）
    function creationDays(item) {
      const ts = new Date(item.date).getTime();
      return Number.isNaN(ts) ? 0 : Math.max(0, (now - ts) / MS_PER_DAY);
    }

    // 1. events → preferences
    const justPromotedIds = new Set();
    const eventsKeep = [];
    for (const item of store.events) {
      if ((item.useCount ?? 0) >= promotionUseCount && creationDays(item) >= promotionMinDays) {
        promoted.push({ id: item.id, text: item.text, from: "events", to: "preferences" });
        justPromotedIds.add(item.id);
        if (item.stale) item.stale = false;
        store.preferences.push(item);
      } else {
        eventsKeep.push(item);
      }
    }
    store.events = eventsKeep;

    // 2. preferences → identity (先于降级执行；跳过本轮刚从 events 晋升的条目)
    const prefsKeep = [];
    for (const item of store.preferences) {
      if (!justPromotedIds.has(item.id) && (item.useCount ?? 0) >= 20 && creationDays(item) >= 60 && (item.importance ?? 2) === 3) {
        promoted.push({ id: item.id, text: item.text, from: "preferences", to: "identity" });
        if (item.stale) item.stale = false;
        store.identity.push(item);
      } else {
        prefsKeep.push(item);
      }
    }
    store.preferences = prefsKeep;

    // 3. preferences → events (降级；跳过本轮刚从 events 晋升的条目)
    const prefsKeep2 = [];
    for (const item of store.preferences) {
      if (!justPromotedIds.has(item.id) && idleDays(item, now) > 90 && (item.useCount ?? 0) <= 2) {
        demoted.push({ id: item.id, text: item.text, from: "preferences", to: "events" });
        if (item.stale) item.stale = false;
        store.events.push(item);
      } else {
        prefsKeep2.push(item);
      }
    }
    store.preferences = prefsKeep2;

    if (promoted.length > 0 || demoted.length > 0) {
      await writeMemoryStore(store);
    }
    return { promoted, demoted };
  });
}

/**
 * Phase 3A: 记忆反思/整合（手动触发）
 * 从最近 events 中提炼高层模式和洞察，写入记忆。
 */
const MAX_REFLECT_INSIGHTS = 5;
const MIN_EVENTS_FOR_REFLECT = 3;

async function performReflection() {
  const store = await readMemoryStore();
  const events = store.events || [];

  if (events.length < MIN_EVENTS_FOR_REFLECT) {
    return { insights: [], skipped: "not_enough_events" };
  }

  // 取最近 20 条 events（按 date 降序）
  const sorted = [...events]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  const eventsText = sorted
    .map((e) => `- ${e.text} [${e.date}]`)
    .join("\n");

  // 调 LLM
  const client = clients.getClientForModel(AUTO_LEARN_MODEL);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  let response;
  try {
    response = await client.chat.completions.create({
      model: AUTO_LEARN_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: REFLECT_PROMPT },
        { role: "user", content: `用户的近期动态：\n${eventsText}` },
      ],
    }, { signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }

  const output = (response.choices[0]?.message?.content || "").trim();

  if (output === "NONE" || !output) {
    return { insights: [], skipped: "no_patterns" };
  }

  // 复用 parseAutoLearnOutput，只保留 ADD 操作
  let entries = parseAutoLearnOutput(output);
  entries = entries.filter((e) => e.op === "add");

  // 排除 events 类别：反思的源数据就是 events，允许 ADD [events] 会导致
  // deduplicateAdds 把洞察与源事件 bigram 匹配后转为 UPDATE，删掉原始事件
  entries = entries.filter((e) => e.category !== "events");

  // 强制 importance=3
  for (const e of entries) {
    e.importance = 3;
  }

  // 上限 5 条
  if (entries.length > MAX_REFLECT_INSIGHTS) {
    entries = entries.slice(0, MAX_REFLECT_INSIGHTS);
  }

  if (entries.length === 0) {
    return { insights: [], skipped: "no_patterns" };
  }

  // 复用 applyMemoryOperations（内部有锁）
  const result = await applyMemoryOperations(entries);

  if (result?.overLimit) {
    return { insights: [], skipped: "over_limit" };
  }

  return { insights: result?.appliedOps || [] };
}

/** @deprecated Use applyMemoryOperations instead */
async function appendToLongTermMemory(newEntries) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) return;
  // 兼容旧调用：将 {category, text} 转换为 {op:"add", category, text}
  const ops = newEntries.map((e) => ({ op: "add", category: e.category, text: e.text }));
  return applyMemoryOperations(ops);
}

module.exports = {
  normalizeAutoLearnModel,
  resolveAutoLearnModel,
  AUTO_LEARN_MODEL,
  AUTO_LEARN_COOLDOWN,
  getLastAutoLearnTime,
  setLastAutoLearnTime,
  AUTO_LEARN_PROMPT,
  REFLECT_PROMPT,
  MAX_MEMORY_FACT_LENGTH,
  MAX_MEMORY_TOTAL_LENGTH,
  MAX_OPS_PER_CALL,
  DEDUP_MERGE_THRESHOLD,
  parseAutoLearnOutput,
  deduplicateAdds,
  applyMemoryOperations,
  appendToLongTermMemory,
  performDecayCheck,
  performPromotionCheck,
  performReflection,
  tryAcquireCooldown,
  withMemoryLock,
};
