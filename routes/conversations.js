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
    console.error("[conversations] list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/conversations/search", async (req, res) => {
  const q = (req.body?.q || "").trim().toLowerCase();
  if (!q || q.length > 200) {
    return res.status(400).json({ error: "Search query invalid (1-200 chars)." });
  }

  const MAX_RESULTS = 50;
  const CONCURRENCY = 10;
  const TIMEOUT_MS = 5000;

  try {
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter(
      (f) => f.endsWith(".json") && f !== "_index.json"
    );
    const results = [];
    const deadline = Date.now() + TIMEOUT_MS;

    function searchFile(file) {
      return fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8").then((raw) => {
        const data = JSON.parse(raw);
        let matchSnippet = "";
        if (data.title && data.title.toLowerCase().includes(q)) {
          matchSnippet = data.title;
        } else if (Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            const text =
              typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ")
                  : "";
            if (text.toLowerCase().includes(q)) {
              const idx = text.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 20);
              const end = Math.min(text.length, idx + q.length + 40);
              matchSnippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
              break;
            }
          }
        }
        if (matchSnippet) return { id: data.id, title: data.title, snippet: matchSnippet };
        return null;
      }).catch(() => null);
    }

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      if (results.length >= MAX_RESULTS || Date.now() > deadline) break;
      const chunk = files.slice(i, i + CONCURRENCY);
      const hits = await Promise.all(chunk.map(searchFile));
      for (const hit of hits) {
        if (hit && results.length < MAX_RESULTS) results.push(hit);
      }
    }

    results.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(results);
  } catch (err) {
    console.error("[conversations] search error:", err);
    res.status(500).json({ error: "Internal server error" });
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
    console.error("[conversations] get error:", err);
    res.status(500).json({ error: "Internal server error" });
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
      ...validated.value,
      updatedAt: new Date().toISOString(),
    };
    await atomicWrite(filePath, JSON.stringify(toSave));
    await updateIndexEntry(validated.value.id, validated.value.title, validated.value.messages.length).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error("[conversations] save error:", err);
    res.status(500).json({ error: "Internal server error" });
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
    console.error("[conversations] delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
