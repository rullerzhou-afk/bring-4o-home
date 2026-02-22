const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const router = require("express").Router();
const {
  getConversationPath,
  CONVERSATIONS_DIR,
  atomicWrite,
  readIndex,
  rebuildIndex,
  updateIndexEntry,
  removeIndexEntry,
  removeIndexEntries,
} = require("../lib/config");
const { validateConversation } = require("../lib/validators");
const { IMAGES_DIR } = require("../lib/config");

/** 从对话消息中提取 /images/ 引用的文件名列表 */
function extractImageFilenames(messages) {
  if (!Array.isArray(messages)) return [];
  const filenames = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (
        part.type === "image_url" &&
        part.image_url &&
        typeof part.image_url.url === "string" &&
        part.image_url.url.startsWith("/images/")
      ) {
        const name = part.image_url.url.slice("/images/".length);
        if (name && !name.includes("/") && !name.includes("..")) {
          filenames.push(name);
        }
      }
    }
  }
  return filenames;
}

/** 尽力删除图片文件，失败静默忽略 */
async function cleanupImages(filenames) {
  await Promise.all(
    filenames.map((f) => fsp.unlink(path.join(IMAGES_DIR, f)).catch(() => {}))
  );
}

router.get("/conversations", async (req, res) => {
  try {
    let index = await readIndex();
    if (!index) {
      index = await rebuildIndex();
    }
    const list = Object.entries(index)
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => Number(b.id) - Number(a.id));
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
  const allImages = [];
  for (const id of ids) {
    const filePath = getConversationPath(id);
    if (!filePath) {
      results.failed++;
      continue;
    }
    try {
      const data = JSON.parse(await fsp.readFile(filePath, "utf-8"));
      allImages.push(...extractImageFilenames(data.messages));
    } catch { /* 文件不存在或损坏 */ }
    try {
      await fsp.unlink(filePath);
      results.deleted++;
    } catch (err) {
      if (err.code === "ENOENT") results.deleted++;
      else results.failed++;
    }
  }
  await removeIndexEntries(ids).catch(() => {});
  if (allImages.length > 0) cleanupImages(allImages).catch(() => {});
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
    await updateIndexEntry(body.id, body.title, body.messages.length).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/conversations/:id", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    // 先读取对话内容以提取图片引用
    let images = [];
    try {
      const data = JSON.parse(await fsp.readFile(filePath, "utf-8"));
      images = extractImageFilenames(data.messages);
    } catch { /* 文件不存在或损坏，跳过图片清理 */ }
    await fsp.unlink(filePath);
    await removeIndexEntry(req.params.id).catch(() => {});
    if (images.length > 0) cleanupImages(images).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.json({ ok: true });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
