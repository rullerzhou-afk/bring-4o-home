const router = require("express").Router();
const { getClientForModel, formatProviderError } = require("../lib/clients");
const { readMemoryStore, renderMemoryWithIds, writeMemoryStore } = require("../lib/prompts");
const { isPlainObject, readConfig } = require("../lib/config");
const { isValidConvId } = require("../lib/validators");
const {
  AUTO_LEARN_MODEL,
  AUTO_LEARN_PROMPT,
  tryAcquireCooldown,
  parseAutoLearnOutput,
  applyMemoryOperations,
  performDecayCheck,
  performPromotionCheck,
  performReflection,
  withMemoryLock,
} = require("../lib/auto-learn");

router.post("/memory/auto-learn", async (req, res) => {
  const convId = req.body?.convId;
  if (!isValidConvId(convId)) {
    return res.status(400).json({ error: "invalid convId" });
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

  // 冷却期检查放在所有 body 验证之后，避免畸形请求白烧冷却窗口
  if (!tryAcquireCooldown(convId)) {
    return res.json({ learned: [], skipped: "cooldown" });
  }

  try {
    const store = await readMemoryStore();
    const currentMemory = renderMemoryWithIds(store);
    const conversationText = recentMessages
      .map((m) => {
        const role = m.role === "user" ? "用户" : m.role === "assistant" ? "AI" : "系统";
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
          { role: "user", content: `已有记忆：\n${currentMemory || "（空）"}\n\n---\n\n最近的对话：\n${conversationText}` },
        ],
      }, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }

    const output = (response.choices[0]?.message?.content || "").trim();

    // Phase 2A: piggyback decay check — runs regardless of LLM output
    const config = await readConfig();
    const decay = await performDecayCheck(config);
    const hasDecay = decay.decayed.length > 0 || decay.staled.length > 0;

    // Phase 2B: piggyback promotion check
    const promotion = await performPromotionCheck(config);
    const hasPromotion = promotion.promoted.length > 0 || promotion.demoted.length > 0;

    if (output === "NONE" || !output) {
      const payload = { learned: [] };
      if (hasDecay) payload.decay = decay;
      if (hasPromotion) payload.promotion = promotion;
      return res.json(payload);
    }

    const entries = parseAutoLearnOutput(output);

    if (entries.length === 0) {
      const payload = { learned: [] };
      if (hasDecay) payload.decay = decay;
      if (hasPromotion) payload.promotion = promotion;
      return res.json(payload);
    }

    const result = await applyMemoryOperations(entries);

    const applied = result?.appliedOps || [];
    let addCount = 0, updateCount = 0, deleteCount = 0, mergeCount = 0;
    for (const e of applied) {
      if (e.dedupMerge) mergeCount++;
      else if (e.op === "add") addCount++;
      else if (e.op === "update") updateCount++;
      else if (e.op === "delete") deleteCount++;
    }
    const decaySuffix = hasDecay
      ? ` | decay: -${decay.decayed.length} deleted, ~${decay.staled.length} staled`
      : "";
    const promotionSuffix = hasPromotion
      ? ` | promotion: ↑${promotion.promoted.length} promoted, ↓${promotion.demoted.length} demoted`
      : "";
    console.log(`Auto-learn: +${addCount} add, ~${updateCount} update, -${deleteCount} delete, ≈${mergeCount} merge${decaySuffix}${promotionSuffix}`);

    const payload = { learned: applied };
    if (result?.overLimit) payload.capacityWarning = true;
    if (hasDecay) payload.decay = decay;
    if (hasPromotion) payload.promotion = promotion;
    return res.json(payload);
  } catch (err) {
    console.error("Auto-learn error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memory/auto-learn/undo", async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) {
    return res.status(400).json({ error: "ids must be a non-empty array (max 20)" });
  }
  const idPattern = /^m_\d{10,}$/;
  for (const id of ids) {
    if (typeof id !== "string" || !idPattern.test(id)) {
      return res.status(400).json({ error: `invalid memory id: ${id}` });
    }
  }

  try {
    const idsToRemove = new Set(ids);
    const removed = await withMemoryLock(async () => {
      const store = await readMemoryStore();
      let count = 0;
      for (const cat of ["identity", "preferences", "events"]) {
        const before = store[cat].length;
        store[cat] = store[cat].filter((item) => !idsToRemove.has(item.id));
        count += before - store[cat].length;
      }
      if (count > 0) {
        await writeMemoryStore(store);
      }
      return count;
    });
    return res.json({ removed });
  } catch (err) {
    console.error("Auto-learn undo error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memory/reflect", async (req, res) => {
  try {
    const result = await performReflection();

    if (result.skipped) {
      console.log(`Reflect: skipped (${result.skipped})`);
      return res.json(result);
    }

    console.log(`Reflect: ${result.insights.length} insights generated`);
    return res.json(result);
  } catch (err) {
    console.error("Reflect error:", err.message);
    return res.status(500).json({ error: "反思失败，请稍后再试" });
  }
});

module.exports = router;
