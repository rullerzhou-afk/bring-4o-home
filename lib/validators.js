const { isPlainObject } = require("./config");

const MAX_MEMORY_FACT_LENGTH = 80;
const MAX_MEMORY_TOTAL_LENGTH = 50_000;
const CONV_ID_RE = /^\d{10,16}$/;
const MEMORY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMORY_ID_RE = /^m_\d{10,}$/;
const MEMORY_SOURCES = new Set(["user_stated", "ai_inferred"]);
const MODEL_NAME_RE = /^[a-zA-Z0-9._\/:@-]+$/;
const MODEL_NAME_MAX_LEN = 120;

function isValidModelName(model) {
  return typeof model === "string"
    && model.length > 0
    && model.length <= MODEL_NAME_MAX_LEN
    && MODEL_NAME_RE.test(model);
}

function isValidConvId(id) {
  return typeof id === "string" && CONV_ID_RE.test(id);
}

function charLength(text) {
  return Array.from(text || "").length;
}

function validateMemoryStore(store) {
  if (!isPlainObject(store)) {
    return { ok: false, error: "`memoryStore` must be a plain object." };
  }

  if (typeof store.version !== "number" || Number.isNaN(store.version)) {
    return { ok: false, error: "`memoryStore.version` must be a number." };
  }

  const categories = ["identity", "preferences", "events"];
  for (const category of categories) {
    if (!Array.isArray(store[category])) {
      return { ok: false, error: `\`memoryStore.${category}\` must be an array.` };
    }
  }

  const normalized = {
    version: store.version,
    identity: [],
    preferences: [],
    events: [],
  };

  if (store.updatedAt !== undefined) {
    if (typeof store.updatedAt !== "string" || Number.isNaN(Date.parse(store.updatedAt))) {
      return { ok: false, error: "`memoryStore.updatedAt` must be an ISO datetime string." };
    }
    normalized.updatedAt = new Date(store.updatedAt).toISOString();
  }

  for (const category of categories) {
    const items = store[category];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isPlainObject(item)) {
        return { ok: false, error: `\`memoryStore.${category}[${i}]\` must be an object.` };
      }

      const id = typeof item.id === "string" ? item.id.trim() : "";
      const text = typeof item.text === "string" ? item.text.trim() : "";
      const date = typeof item.date === "string" ? item.date.trim() : "";
      const source = item.source;

      if (!id || !MEMORY_ID_RE.test(id)) {
        return { ok: false, error: `\`memoryStore.${category}[${i}].id\` is invalid.` };
      }
      if (!text) {
        return { ok: false, error: `\`memoryStore.${category}[${i}].text\` must be a non-empty string.` };
      }
      if (charLength(text) > MAX_MEMORY_FACT_LENGTH) {
        return { ok: false, error: `\`memoryStore.${category}[${i}].text\` must be <= 80 chars.` };
      }
      if (!MEMORY_DATE_RE.test(date)) {
        return { ok: false, error: `\`memoryStore.${category}[${i}].date\` must be YYYY-MM-DD.` };
      }
      if (!MEMORY_SOURCES.has(source)) {
        return {
          ok: false,
          error: `\`memoryStore.${category}[${i}].source\` must be user_stated or ai_inferred.`,
        };
      }

      // importance: optional, 1-3 integer, default 2
      let importance = 2;
      if (item.importance !== undefined) {
        if (typeof item.importance !== "number" || !Number.isInteger(item.importance)
            || item.importance < 1 || item.importance > 3) {
          return { ok: false, error: `\`memoryStore.${category}[${i}].importance\` must be 1, 2, or 3.` };
        }
        importance = item.importance;
      }

      // useCount: optional, non-negative integer, default 0
      let useCount = 0;
      if (item.useCount !== undefined) {
        if (typeof item.useCount !== "number" || !Number.isInteger(item.useCount)
            || item.useCount < 0) {
          return { ok: false, error: `\`memoryStore.${category}[${i}].useCount\` must be a non-negative integer.` };
        }
        useCount = item.useCount;
      }

      // lastReferencedAt: optional, ISO datetime string or null, default null
      let lastReferencedAt = null;
      if (item.lastReferencedAt !== undefined && item.lastReferencedAt !== null) {
        if (typeof item.lastReferencedAt !== "string" || Number.isNaN(Date.parse(item.lastReferencedAt))) {
          return { ok: false, error: `\`memoryStore.${category}[${i}].lastReferencedAt\` must be an ISO datetime string or null.` };
        }
        lastReferencedAt = new Date(item.lastReferencedAt).toISOString();
      }

      // stale: optional boolean, default false
      const stale = !!item.stale;

      normalized[category].push({ id, text, date, source, importance, useCount, lastReferencedAt, stale });
    }
  }

  if (JSON.stringify(store).length > MAX_MEMORY_TOTAL_LENGTH) {
    return { ok: false, error: "`memoryStore` exceeds size limit (50000)." };
  }

  return { ok: true, value: normalized };
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

  if (body.memoryStore !== undefined) {
    const checked = validateMemoryStore(body.memoryStore);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    next.memoryStore = checked.value;
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
    "ai_name",
    "user_name",
    "memory",
    "auto_compress",
    "compress_keep_recent",
    "voice",
  ]);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    return { ok: false, error: `Unknown config field: ${unknownKey}` };
  }

  const patch = {};

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > MODEL_NAME_MAX_LEN) {
      return { ok: false, error: "`model` must be a non-empty string (max 120 chars)." };
    }
    patch.model = body.model.trim();
    if (!MODEL_NAME_RE.test(patch.model)) {
      return { ok: false, error: "`model` contains invalid characters." };
    }
  }

  // auto_compress: boolean
  if (body.auto_compress !== undefined) {
    if (typeof body.auto_compress !== "boolean") {
      return { ok: false, error: "`auto_compress` must be a boolean." };
    }
    patch.auto_compress = body.auto_compress;
  }

  const numericFields = [
    ["temperature", 0, 2],
    ["top_p", 0, 1],
    ["presence_penalty", -2, 2],
    ["frequency_penalty", -2, 2],
    ["context_window", 4, 500],
    ["compress_keep_recent", 2, 100],
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

  const stringFields = [
    ["ai_name", 30],
    ["user_name", 30],
  ];
  for (const [field, maxLen] of stringFields) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") {
      return { ok: false, error: `\`${field}\` must be a string.` };
    }
    if (body[field].length > maxLen) {
      return { ok: false, error: `\`${field}\` must be at most ${maxLen} chars.` };
    }
    patch[field] = body[field].trim();
  }

  // memory config block (nested object)
  if (body.memory !== undefined) {
    if (!isPlainObject(body.memory)) {
      return { ok: false, error: "`memory` must be an object." };
    }
    const allowedMemKeys = new Set(["decayIdleDays", "autoDecay", "autoPromotion", "promotionUseCount", "promotionMinDays"]);
    const unknownMemKey = Object.keys(body.memory).find((k) => !allowedMemKeys.has(k));
    if (unknownMemKey) {
      return { ok: false, error: `Unknown memory config field: ${unknownMemKey}` };
    }
    const memCfg = {};
    const memNumericFields = [
      ["decayIdleDays", 1, 365],
      ["promotionUseCount", 1, 100],
      ["promotionMinDays", 1, 365],
    ];
    for (const [field, min, max] of memNumericFields) {
      if (body.memory[field] === undefined) continue;
      if (typeof body.memory[field] !== "number" || !Number.isInteger(body.memory[field])) {
        return { ok: false, error: `\`memory.${field}\` must be an integer.` };
      }
      if (body.memory[field] < min || body.memory[field] > max) {
        return { ok: false, error: `\`memory.${field}\` must be in range [${min}, ${max}].` };
      }
      memCfg[field] = body.memory[field];
    }
    if (body.memory.autoDecay !== undefined) {
      if (typeof body.memory.autoDecay !== "boolean") {
        return { ok: false, error: "`memory.autoDecay` must be a boolean." };
      }
      memCfg.autoDecay = body.memory.autoDecay;
    }
    if (body.memory.autoPromotion !== undefined) {
      if (typeof body.memory.autoPromotion !== "boolean") {
        return { ok: false, error: "`memory.autoPromotion` must be a boolean." };
      }
      memCfg.autoPromotion = body.memory.autoPromotion;
    }
    if (Object.keys(memCfg).length > 0) {
      patch.memory = memCfg;
    }
  }

  // voice config block (nested object)
  if (body.voice !== undefined) {
    if (!isPlainObject(body.voice)) {
      return { ok: false, error: "`voice` must be an object." };
    }
    const allowedVoiceKeys = new Set([
      "stt_provider", "tts_provider", "tts_voice", "tts_speed", "volcengine_clone_id",
    ]);
    const unknownVoiceKey = Object.keys(body.voice).find((k) => !allowedVoiceKeys.has(k));
    if (unknownVoiceKey) {
      return { ok: false, error: `Unknown voice config field: ${unknownVoiceKey}` };
    }
    const voiceCfg = {};
    if (body.voice.stt_provider !== undefined) {
      const valid = ["browser", "api", "local", "volcengine"];
      if (!valid.includes(body.voice.stt_provider)) {
        return { ok: false, error: "`voice.stt_provider` must be one of: " + valid.join(", ") };
      }
      voiceCfg.stt_provider = body.voice.stt_provider;
    }
    if (body.voice.tts_provider !== undefined) {
      const valid = ["edge", "api", "volcengine"];
      if (!valid.includes(body.voice.tts_provider)) {
        return { ok: false, error: "`voice.tts_provider` must be one of: " + valid.join(", ") };
      }
      voiceCfg.tts_provider = body.voice.tts_provider;
    }
    if (body.voice.tts_voice !== undefined) {
      if (typeof body.voice.tts_voice !== "string" || body.voice.tts_voice.length > 60) {
        return { ok: false, error: "`voice.tts_voice` must be a string (max 60 chars)." };
      }
      voiceCfg.tts_voice = body.voice.tts_voice;
    }
    if (body.voice.tts_speed !== undefined) {
      if (typeof body.voice.tts_speed !== "number" || Number.isNaN(body.voice.tts_speed)) {
        return { ok: false, error: "`voice.tts_speed` must be a number." };
      }
      if (body.voice.tts_speed < 0.5 || body.voice.tts_speed > 2.0) {
        return { ok: false, error: "`voice.tts_speed` must be in range [0.5, 2.0]." };
      }
      voiceCfg.tts_speed = body.voice.tts_speed;
    }
    if (body.voice.volcengine_clone_id !== undefined) {
      if (typeof body.voice.volcengine_clone_id !== "string" || body.voice.volcengine_clone_id.length > 64) {
        return { ok: false, error: "`voice.volcengine_clone_id` must be a string (max 64 chars)." };
      }
      voiceCfg.volcengine_clone_id = body.voice.volcengine_clone_id;
    }
    if (Object.keys(voiceCfg).length > 0) {
      patch.voice = voiceCfg;
    }
  }

  return { ok: true, value: patch };
}

function validateConversation(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be an object." };
  }
  if (!isValidConvId(body.id)) {
    return { ok: false, error: "`id` must be a numeric string (10-16 digits)." };
  }
  if (typeof body.title !== "string" || body.title.length > 200) {
    return { ok: false, error: "`title` must be a string (max 200 chars)." };
  }
  if (!Array.isArray(body.messages) || body.messages.length > 500) {
    return { ok: false, error: "`messages` must be an array (max 500 items)." };
  }
  if (body.messages.length === 0) {
    return { ok: true, value: { id: body.id, title: body.title, messages: [] } };
  }
  const msgResult = validateMessages(body.messages);
  if (!msgResult.ok) {
    return msgResult;
  }
  return { ok: true, value: { id: body.id, title: body.title, messages: msgResult.value } };
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

  function attachOptionalFields(entry, msg) {
    if (msg.meta && isPlainObject(msg.meta)) entry.meta = msg.meta;
    if (typeof msg.reasoning === "string") entry.reasoning = msg.reasoning;
  }

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
      const entry = { role: msg.role, content: msg.content };
      attachOptionalFields(entry, msg);
      normalized.push(entry);
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
          const isDataUrl = /^data:image\/(png|jpeg|gif|webp);base64,/.test(url);
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

      const entry = { role: msg.role, content: parts };
      attachOptionalFields(entry, msg);
      normalized.push(entry);
      continue;
    }

    return { ok: false, error: "Message content must be string or array." };
  }

  return { ok: true, value: normalized };
}

module.exports = {
  isValidConvId,
  isValidModelName,
  validatePromptPatch,
  validateMemoryStore,
  validateConfigPatch,
  validateConversation,
  validateMessages,
};
