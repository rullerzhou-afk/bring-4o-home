const router = require("express").Router();
const { readConfig, saveConfig, backupPrompts, atomicWrite } = require("../lib/config");
const { validateConfigPatch } = require("../lib/validators");
const { DEFAULT_SYSTEM, DEFAULT_MEMORY_STORE, SYSTEM_PATH, writeMemoryStore, renderMemoryForPrompt } = require("../lib/prompts");
const { withMemoryLock } = require("../lib/auto-learn");

// 用户推荐默认值（恢复默认时使用，不含 model——模型始终保留用户当前选择）
const RECOMMENDED_CONFIG = {
  temperature: 0.85,
  presence_penalty: 0,
  frequency_penalty: 0.15,
  context_window: 50,
};

router.get("/config", async (req, res) => {
  res.json(await readConfig());
});

router.put("/config", async (req, res) => {
  const validated = validateConfigPatch(req.body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const current = await readConfig();
    const merged = { ...current, ...validated.value };
    if (validated.value.memory) {
      merged.memory = { ...(current.memory || {}), ...validated.value.memory };
    }
    if (validated.value.voice) {
      merged.voice = { ...(current.voice || {}), ...validated.value.voice };
    }
    const updated = await saveConfig(merged);
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error("[config] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/reset", async (req, res) => {
  try {
    await backupPrompts();

    // 写入默认 prompts（人格指令清空，模板由用户自行选择插入）
    const emptyStore = { ...DEFAULT_MEMORY_STORE, updatedAt: new Date().toISOString() };
    await Promise.all([
      atomicWrite(SYSTEM_PATH, ""),
      withMemoryLock(() => writeMemoryStore(emptyStore)),
    ]);

    // 重置 config（保留当前模型）
    const current = await readConfig();
    const config = await saveConfig({ ...RECOMMENDED_CONFIG, model: current.model });

    const memory = renderMemoryForPrompt(emptyStore);
    res.json({ ok: true, system: "", memory, memoryStore: emptyStore, config });
  } catch (err) {
    console.error("[config] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
