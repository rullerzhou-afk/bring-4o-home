const router = require("express").Router();
const { readConfig, saveConfig, atomicWrite, backupPrompts } = require("../lib/config");
const { validateConfigPatch } = require("../lib/validators");
const { DEFAULT_SYSTEM, DEFAULT_MEMORY, SYSTEM_PATH, MEMORY_PATH } = require("../lib/prompts");
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
    const updated = await saveConfig({ ...current, ...validated.value });
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error("[config] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/reset", async (req, res) => {
  try {
    await backupPrompts();

    // 写入默认 prompts
    await Promise.all([
      atomicWrite(SYSTEM_PATH, DEFAULT_SYSTEM),
      withMemoryLock(() => atomicWrite(MEMORY_PATH, DEFAULT_MEMORY)),
    ]);

    // 重置 config（保留当前模型）
    const current = await readConfig();
    const config = await saveConfig({ ...RECOMMENDED_CONFIG, model: current.model });

    res.json({ ok: true, system: DEFAULT_SYSTEM, memory: DEFAULT_MEMORY, config });
  } catch (err) {
    console.error("[config] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
