const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const router = require("express").Router();
const { readPromptFile, SYSTEM_PATH, MEMORY_PATH } = require("../lib/prompts");
const { validatePromptPatch } = require("../lib/validators");
const { atomicWrite, pruneBackups } = require("../lib/config");
const { withMemoryLock } = require("../lib/auto-learn");

const BACKUPS_DIR = path.join(__dirname, "..", "prompts", "backups");

router.get("/prompts", async (req, res) => {
  const [system, memory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);
  res.json({ system, memory });
});

router.put("/prompts", async (req, res) => {
  // 提取 backup 标志（不参与 validate）
  const wantBackup = !!req.body?.backup;
  const body = { ...req.body };
  delete body.backup;

  const validated = validatePromptPatch(body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const { system, memory } = validated.value;
  try {
    // 备份旧 Prompt
    if (wantBackup) {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      const [oldSystem, oldMemory] = await Promise.all([
        readPromptFile(SYSTEM_PATH),
        readPromptFile(MEMORY_PATH),
      ]);
      const backupData = {
        timestamp: new Date().toISOString(),
        system: oldSystem,
        memory: oldMemory,
      };
      const backupFile = path.join(BACKUPS_DIR, `${Date.now()}.json`);
      await fsp.writeFile(backupFile, JSON.stringify(backupData, null, 2), "utf-8");
      await pruneBackups(BACKUPS_DIR);
      console.log(`Prompt backup saved: ${backupFile}`);
    }

    const writes = [];
    if (system !== undefined) writes.push(atomicWrite(SYSTEM_PATH, system));
    if (memory !== undefined) writes.push(withMemoryLock(() => atomicWrite(MEMORY_PATH, memory)));
    await Promise.all(writes);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
