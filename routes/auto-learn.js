const router = require("express").Router();
const { getClientForModel, formatProviderError } = require("../lib/clients");
const { readPromptFile, MEMORY_PATH } = require("../lib/prompts");
const { isPlainObject } = require("../lib/config");
const {
  AUTO_LEARN_MODEL,
  AUTO_LEARN_COOLDOWN,
  getLastAutoLearnTime,
  setLastAutoLearnTime,
  AUTO_LEARN_PROMPT,
  filterAutoLearnFacts,
  appendToLongTermMemory,
} = require("../lib/auto-learn");

router.post("/memory/auto-learn", async (req, res) => {
  const now = Date.now();
  if (now - getLastAutoLearnTime() < AUTO_LEARN_COOLDOWN * 1000) {
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
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    let response;
    try {
      response = await learnClient.chat.completions.create({
        model: AUTO_LEARN_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: AUTO_LEARN_PROMPT },
          { role: "user", content: `已有记忆：\n${currentMemory}\n\n---\n\n最近的对话：\n${conversationText}` },
        ],
      }, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }

    const output = (response.choices[0]?.message?.content || "").trim();
    if (output === "NONE" || !output) {
      setLastAutoLearnTime(now);
      return res.json({ learned: [] });
    }

    const rawFacts = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && line.length > 3);

    const facts = filterAutoLearnFacts(rawFacts);

    if (facts.length === 0) {
      setLastAutoLearnTime(now);
      return res.json({ learned: [], filtered: rawFacts.length - facts.length || undefined });
    }

    await appendToLongTermMemory(facts);
    setLastAutoLearnTime(now);
    console.log(`Auto-learn: extracted ${facts.length} new facts`);
    return res.json({ learned: facts });
  } catch (err) {
    console.error("Auto-learn error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
