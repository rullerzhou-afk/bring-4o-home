const router = require("express").Router();
const { readConfig, saveConfig, normalizeConfig } = require("../lib/config");
const { validateConfigPatch } = require("../lib/validators");

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

module.exports = router;
