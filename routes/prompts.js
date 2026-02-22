const router = require("express").Router();
const { readPromptFile, SYSTEM_PATH, MEMORY_PATH } = require("../lib/prompts");
const { validatePromptPatch } = require("../lib/validators");
const { atomicWrite, backupPrompts } = require("../lib/config");
const { withMemoryLock } = require("../lib/auto-learn");

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
    if (wantBackup) {
      await backupPrompts();
    }

    const writes = [];
    if (system !== undefined) writes.push(atomicWrite(SYSTEM_PATH, system));
    if (memory !== undefined) writes.push(withMemoryLock(() => atomicWrite(MEMORY_PATH, memory)));
    await Promise.all(writes);
    res.json({ ok: true });
  } catch (err) {
    console.error("[prompts] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
