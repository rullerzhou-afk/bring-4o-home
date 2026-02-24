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
const { getClientForModel } = require("../lib/clients");
const { AUTO_LEARN_MODEL } = require("../lib/auto-learn");
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

/** 尽力删除图片文件，记录失败的文件名 */
async function cleanupImages(filenames) {
  const results = await Promise.allSettled(
    filenames.map((f) => fsp.unlink(path.join(IMAGES_DIR, f)))
  );
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed.push(filenames[i]);
    }
  });
  if (failed.length > 0) {
    console.warn(`[cleanupImages] Failed to delete ${failed.length} file(s):`, failed);
  }
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

// ===== 自动生成对话标题 =====

const TITLE_PROMPT = `根据以下对话内容生成一个简洁的标题。要求：
- 不超过20个字
- 直接输出标题文本，不加引号、标点前缀或其他格式
- 用对话内容的主要语言`;

router.post("/conversations/:id/generate-title", async (req, res) => {
  const filePath = getConversationPath(req.params.id);
  if (!filePath) return res.status(400).json({ error: "Invalid conversation id." });
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    const conv = JSON.parse(raw);
    if (!Array.isArray(conv.messages) || conv.messages.length < 2) {
      return res.status(400).json({ error: "Need at least 2 messages." });
    }

    // 取前 2 条消息，文本截断到 500 字
    const sample = conv.messages.slice(0, 2).map((m) => {
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ")
          : "";
      return { role: m.role, content: text.slice(0, 500) };
    });

    const client = getClientForModel(AUTO_LEARN_MODEL);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);

    let title;
    try {
      const completion = await client.chat.completions.create(
        {
          model: AUTO_LEARN_MODEL,
          messages: [
            { role: "system", content: TITLE_PROMPT },
            ...sample,
            { role: "user", content: "请为以上对话生成标题。" },
          ],
          max_tokens: 50,
          temperature: 0.3,
        },
        { signal: abort.signal }
      );
      title = (completion.choices?.[0]?.message?.content || "").trim().slice(0, 60);
    } finally {
      clearTimeout(timer);
    }

    if (!title) {
      return res.status(500).json({ error: "Title generation returned empty." });
    }

    // 重新读取最新文件，只改 title，避免覆盖期间新增的消息
    const freshRaw = await fsp.readFile(filePath, "utf-8");
    const freshConv = JSON.parse(freshRaw);
    freshConv.title = title;
    freshConv.updatedAt = new Date().toISOString();
    await atomicWrite(filePath, JSON.stringify(freshConv));
    await updateIndexEntry(freshConv.id, title, freshConv.messages.length).catch(() => {});

    res.json({ title });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Title generation timed out." });
    }
    console.error("[conversations] generate-title error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 清理孤儿图片：扫描 data/images/ 中不再被任何对话引用的图片文件
 * 管理员可定期手动调用此端点，或通过定时任务自动清理
 */
router.post("/conversations/cleanup-orphan-images", async (req, res) => {
  try {
    // 1. 读取所有对话，收集被引用的图片文件名
    const files = (await fsp.readdir(CONVERSATIONS_DIR)).filter(
      (f) => f.endsWith(".json") && f !== "_index.json"
    );
    const referenced = new Set();
    await Promise.all(
      files.map(async (file) => {
        try {
          const raw = await fsp.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8");
          const conv = JSON.parse(raw);
          const images = extractImageFilenames(conv.messages || []);
          images.forEach((img) => referenced.add(img));
        } catch (err) {
          console.warn(`[cleanup-orphans] Skip damaged file: ${file}`, err.message);
        }
      })
    );

    // 2. 扫描 images 目录，找出未被引用的文件
    const allImages = await fsp.readdir(IMAGES_DIR);
    const orphans = allImages.filter((img) => !referenced.has(img));

    // 3. 删除孤儿文件
    if (orphans.length === 0) {
      return res.json({ deleted: 0, orphans: [] });
    }

    const results = await Promise.allSettled(
      orphans.map((img) => fsp.unlink(path.join(IMAGES_DIR, img)))
    );
    const deleted = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        deleted.push(orphans[i]);
      } else {
        failed.push({ file: orphans[i], error: r.reason?.message || "Unknown error" });
      }
    });

    console.log(`[cleanup-orphans] Deleted ${deleted.length} orphan image(s)`);
    if (failed.length > 0) {
      console.warn(`[cleanup-orphans] Failed to delete ${failed.length} file(s):`, failed);
    }

    res.json({ deleted: deleted.length, orphans: deleted, failed });
  } catch (err) {
    console.error("[cleanup-orphans] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
