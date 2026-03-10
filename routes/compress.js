const fs = require("fs");
const fsp = fs.promises;
const router = require("express").Router();
const { getClientForModel, formatProviderError } = require("../lib/clients");
const { readConfig, getConversationPath, atomicWrite, withConvLock } = require("../lib/config");
const { isValidConvId, validateMessages } = require("../lib/validators");

const COMPRESS_PROMPT = `你是一个对话摘要专家。请将以下对话历史压缩为一段简洁的叙事摘要。

## 要求
- 用第三人称叙述（"用户说..."、"AI回复..."）
- 保留关键信息：用户的问题、AI的核心回答、做出的决策、重要的上下文
- 省略寒暄、重复、无实质内容的来回
- 保持时间顺序
- 控制在 500 字以内
- 直接输出摘要文本，不要加标题、引号或其他格式包装
- 用对话中的主要语言书写`;

const MAX_SAMPLE = 40;
const MAX_MSG_CHARS = 400;
const MAX_TOTAL_CHARS = 16000;

/**
 * 从数组中均匀采样 count 个元素
 */
function sampleEvenly(arr, count) {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= count) return arr.slice();
  const result = [];
  const step = (arr.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

/**
 * 将消息数组准备为压缩用的纯文本
 * 跳过图片消息，截取长消息，控制总预算
 */
function prepareMessagesForCompress(messages) {
  const sampled = sampleEvenly(messages, MAX_SAMPLE);
  const lines = [];
  let totalChars = 0;

  for (const msg of sampled) {
    // 提取纯文本
    let text;
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text);
      if (textParts.length === 0) continue; // 纯图片消息，跳过
      text = textParts.join("\n");
    } else {
      continue;
    }

    // 截取长消息
    const chars = Array.from(text);
    if (chars.length > MAX_MSG_CHARS) {
      text = chars.slice(0, MAX_MSG_CHARS).join("") + "...";
    }

    const roleName = msg.role === "user" ? "用户" : "AI";
    const line = `${roleName}: ${text}`;

    const lineLen = Array.from(line).length;
    if (totalChars + lineLen > MAX_TOTAL_CHARS) break;
    totalChars += lineLen;
    lines.push(line);
  }

  return lines.join("\n\n");
}

router.post("/compress", async (req, res) => {
  const { convId, messages, originalCount } = req.body || {};

  if (!isValidConvId(convId)) {
    return res.status(400).json({ error: "Invalid convId." });
  }
  if (!Array.isArray(messages) || messages.length < 2) {
    return res.status(400).json({ error: "Need at least 2 messages to compress." });
  }
  const mv = validateMessages(messages);
  if (!mv.ok) {
    return res.status(400).json({ error: mv.error });
  }
  if (originalCount !== undefined && (!Number.isInteger(originalCount) || originalCount < 0)) {
    return res.status(400).json({ error: "`originalCount` must be a non-negative integer." });
  }

  try {
    const config = await readConfig();
    const client = getClientForModel(config.model);

    const prepared = prepareMessagesForCompress(messages);
    if (!prepared) {
      return res.status(400).json({ error: "No text content to compress." });
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);

    let summary;
    try {
      const completion = await client.chat.completions.create(
        {
          model: config.model,
          messages: [
            { role: "system", content: COMPRESS_PROMPT },
            { role: "user", content: prepared },
          ],
          max_tokens: 1000,
          temperature: 0.3,
        },
        { signal: abort.signal },
      );
      summary = (completion.choices?.[0]?.message?.content || "").trim();
    } finally {
      clearTimeout(timer);
    }

    if (!summary) {
      return res.status(500).json({ error: "Summary generation returned empty." });
    }

    const generatedAt = new Date().toISOString();
    const compressedCount = (Number.isInteger(originalCount) && originalCount >= messages.length)
      ? originalCount
      : messages.length;

    // 写入对话文件的 summary 字段
    const filePath = getConversationPath(convId);
    if (filePath) {
      await withConvLock(convId, async () => {
        try {
          const raw = await fsp.readFile(filePath, "utf-8");
          const conv = JSON.parse(raw);
          conv.summary = {
            text: summary,
            upToIndex: compressedCount,
            generatedAt,
          };
          await atomicWrite(filePath, JSON.stringify(conv));
        } catch (e) {
          console.warn("[compress] Failed to save summary to conv file:", e.message);
        }
      });
    }

    res.json({ summary, compressedCount, generatedAt });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Compress timed out." });
    }
    console.error("[compress] error:", err);
    const message = formatProviderError(err);
    res.status(500).json({ error: message });
  }
});

module.exports = router;
module.exports.sampleEvenly = sampleEvenly;
module.exports.prepareMessagesForCompress = prepareMessagesForCompress;
