const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const router = require("express").Router();
const { readConfig, saveConfig, normalizeConfig, atomicWrite, pruneBackups } = require("../lib/config");
const { validateConfigPatch } = require("../lib/validators");
const { DEFAULT_SYSTEM, DEFAULT_MEMORY, SYSTEM_PATH, MEMORY_PATH, readPromptFile } = require("../lib/prompts");
const { withMemoryLock } = require("../lib/auto-learn");

const BACKUPS_DIR = path.join(__dirname, "..", "prompts", "backups");

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
    res.status(500).json({ error: err.message });
  }
});

router.post("/settings/reset", async (req, res) => {
  try {
    // 备份旧 prompts
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const [oldSystem, oldMemory] = await Promise.all([
      readPromptFile(SYSTEM_PATH),
      readPromptFile(MEMORY_PATH),
    ]);
    const backupFile = path.join(BACKUPS_DIR, `${Date.now()}.json`);
    await fsp.writeFile(backupFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      system: oldSystem,
      memory: oldMemory,
    }, null, 2), "utf-8");
    await pruneBackups(BACKUPS_DIR);

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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
