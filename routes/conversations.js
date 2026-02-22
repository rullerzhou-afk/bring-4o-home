const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const router = require("express").Router();
const { getConversationPath, CONVERSATIONS_DIR, atomicWrite } = require("../lib/config");
const { validateConversation } = require("../lib/validators");

router.get("/conversations", async (req, res) => {
  try {
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter((f) => f.endsWith(".json"));
    const list = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8"));
        list.push({ id: data.id, title: data.title, messageCount: (data.messages || []).length });
      } catch {
        // 跳过损坏文件
      }
    }
    list.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/conversations/search", async (req, res) => {
  const q = (req.body?.q || "").trim().toLowerCase();
  if (!q || q.length > 200) {
    return res.status(400).json({ error: "Search query invalid (1-200 chars)." });
  }
  try {
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter((f) => f.endsWith(".json"));
    const results = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8"));
        let matched = false;
        let matchSnippet = "";
        if (data.title && data.title.toLowerCase().includes(q)) {
          matched = true;
          matchSnippet = data.title;
        }
        if (!matched && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            const text =
              typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ")
                  : "";
            if (text.toLowerCase().includes(q)) {
              matched = true;
              const idx = text.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 20);
              const end = Math.min(text.length, idx + q.length + 40);
              matchSnippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
              break;
            }
          }
        }
        if (matched) {
          results.push({ id: data.id, title: data.title, snippet: matchSnippet });
        }
      } catch {
        // 跳过损坏文件
      }
    }
    results.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量删除对话
router.post("/conversations/batch-delete", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "`ids` must be a non-empty array." });
  }
  if (ids.length > 2000) {
    return res.status(400).json({ error: "Too many ids (max 2000)." });
  }
  const results = { deleted: 0, failed: 0 };
  for (const id of ids) {
    const filePath = getConversationPath(id);
    if (!filePath) {
      results.failed++;
      continue;
    }
    try {
      await fsp.unlink(filePath);
      results.deleted++;
    } catch (err) {
      if (err.code === "ENOENT") results.deleted++;
      else results.failed++;
    }
  }
  res.json({ ok: true, ...results });
});

router.get("/conversations/:id", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "Conversation not found." });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put("/conversations/:id", async (req, res) => {
  const id = req.params.id;
  const filePath = getConversationPath(id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  const body = { ...req.body, id };
  const validated = validateConversation(body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }
  try {
    const toSave = {
      id: body.id,
      title: body.title,
      messages: body.messages,
      updatedAt: new Date().toISOString(),
    };
    await atomicWrite(filePath, JSON.stringify(toSave));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/conversations/:id", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    await fsp.unlink(filePath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.json({ ok: true });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
