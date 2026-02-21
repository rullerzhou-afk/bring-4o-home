const { isPlainObject } = require("./config");

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
    "ai_name",
    "user_name",
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

module.exports = {
  validatePromptPatch,
  validateConfigPatch,
  validateConversation,
  validateMessages,
};
