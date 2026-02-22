const fs = require("fs");
const fsp = fs.promises;
const router = require("express").Router();
const { getClientForModel, formatProviderError } = require("../lib/clients");
const { getConversationPath, readConfig } = require("../lib/config");
const { readPromptFile, SYSTEM_PATH, MEMORY_PATH } = require("../lib/prompts");

// ===== API: 对话总结生成 Prompt =====
// 第一步：从对话中提取新发现（不改动现有 prompt）
const SUMMARIZE_PROMPT = `你是一个对话分析专家。请分析用户与 AI 的多段历史对话，提取有价值的新发现。

## 重要原则
你的任务是**只提取新信息**，不要重写或修改用户现有的 Prompt 和记忆。
你会收到用户现有的系统提示词和记忆文件作为参考——用来**去重**，避免重复提取已有的信息。

## 任务一：提取人格风格发现（newSystemFindings）
从对话中提取关于 AI 应有的人格、风格、行为规范方面的新发现：
- 用户对 AI 的称呼、语气、风格要求
- 用户喜欢或讨厌的 AI 回复方式
- 对话中体现的交流模式偏好
- 每条以 "- " 开头，简明扼要
- 如果该信息在现有 Prompt 中已存在，**跳过不提取**
- 如果没有新发现，输出空字符串

## 任务二：提取用户画像发现（newMemoryFindings）
从对话中提取关于用户本人的新事实：
- 身份、职业、兴趣、偏好、习惯、经历等
- 每条以 "- " 开头，不超过 30 字
- 如果该信息在现有记忆中已存在，**跳过不提取**
- 如果没有新发现，输出空字符串

## 任务三：发现摘要（notes）
简短说明你发现了什么，2-5 条。

请严格按以下 JSON 格式输出，不要输出其他内容：
\`\`\`json
{
  "newSystemFindings": "- 发现1\\n- 发现2",
  "newMemoryFindings": "- 用户事实1\\n- 用户事实2",
  "notes": "- 摘要1\\n- 摘要2"
}
\`\`\``;

// 第二步：将新发现融合到现有 prompt 中
const MERGE_PROMPT = `你是一个 Prompt 融合专家。请将新发现的信息融合到用户现有的 Prompt 和记忆中。

## 重要原则
- 现有内容是用户精心调整过的，**必须保留原文的结构、风格和所有内容**
- 你的工作是**追加和微调**，不是重写
- 只在必要时做措辞调整以自然融入新信息
- 如果新发现与现有内容矛盾，以新发现为准（更新而非删除）

## 任务一：融合系统提示词（mergedSystem）
将新的人格风格发现融合到现有系统提示词中：
- 保持现有 Prompt 的整体结构和段落划分
- 在合适的位置插入或补充新信息
- 如果现有 Prompt 为空，则基于新发现从零生成

## 任务二：融合用户记忆（mergedMemory）
将新的用户画像发现追加到现有记忆中：
- 保留全部现有记忆条目
- 将新发现追加在末尾
- 格式统一为 "- " 开头

请严格按以下 JSON 格式输出，不要输出其他内容：
\`\`\`json
{
  "mergedSystem": "融合后的完整系统提示词",
  "mergedMemory": "融合后的完整记忆内容"
}
\`\`\``;

router.post("/conversations/summarize", async (req, res) => {
  const ids = req.body?.conversationIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
    return res.status(400).json({ error: "请选择 1-50 条对话" });
  }
  const model = (typeof req.body?.model === "string" && req.body.model.trim())
    ? req.body.model.trim()
    : (await readConfig()).model;

  // 读取现有 Prompt 作为基线
  const [currentSystem, currentMemory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);

  // 逐条加载对话并采样，超预算则停止，告知用户实际分析了多少条
  const TOTAL_BUDGET = 24000; // 对话内容总字符预算
  const MSG_SAMPLE = 10; // 每条对话均匀采样消息数
  const MSG_CHAR_LIMIT = 500; // 每条消息截取字符上限

  function sampleEvenly(arr, count) {
    if (arr.length <= count) return arr;
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round(i * (arr.length - 1) / (count - 1));
      result.push(arr[idx]);
    }
    return result;
  }

  const allSamples = [];
  let usedChars = 0;
  const analyzedTitles = [];
  const skippedTitles = [];
  let budgetHit = false;

  for (const id of ids) {
    const filePath = getConversationPath(id);
    if (!filePath) continue;
    try {
      const data = JSON.parse(await fsp.readFile(filePath, "utf-8"));
      const title = (data.title || "未命名").slice(0, 30);

      if (budgetHit) {
        skippedTitles.push(title);
        continue;
      }

      const allMsgs = (data.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant");
      const sampled = sampleEvenly(allMsgs, MSG_SAMPLE);
      const sample = sampled
        .map((m) => {
          const text =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(m.content)
                ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
                : "";
          return `${m.role === "user" ? "用户" : "AI"}: ${text.slice(0, MSG_CHAR_LIMIT)}`;
        })
        .join("\n");
      if (!sample) continue;

      const entry = `### ${title}\n${sample}`;
      if (usedChars + entry.length > TOTAL_BUDGET) {
        budgetHit = true;
        skippedTitles.push(title);
        continue;
      }
      allSamples.push(entry);
      usedChars += entry.length;
      analyzedTitles.push(title);
    } catch {
      // 跳过读取失败的对话
    }
  }

  if (allSamples.length === 0) {
    return res.status(400).json({ error: "没有可用的对话内容" });
  }

  // 构建用户消息（含现有 Prompt 基线 + 对话样本）
  let userContent = "## 现有系统提示词\n\n";
  userContent += currentSystem || "（空）";
  userContent += "\n\n## 现有用户记忆\n\n";
  userContent += currentMemory || "（空）";
  userContent += "\n\n## 历史对话摘要\n\n";
  userContent += allSamples.join("\n\n---\n\n");

  try {
    const client = getClientForModel(model);
    console.log(`[summarize] model: ${model}, conversations: ${allSamples.length}, content: ${userContent.length} chars`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        temperature: 0.7,
        messages: [
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content: userContent },
        ],
      }, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }

    const output = response.choices[0]?.message?.content || "";

    // 解析 JSON 输出（兼容 ```json 代码块）
    let parsed;
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)```/)
                     || output.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : output;
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return res.status(502).json({
        error: "模型返回格式异常，无法解析为 JSON。请重试或更换模型。",
      });
    }

    res.json({
      newSystemFindings: String(parsed.newSystemFindings || ""),
      newMemoryFindings: String(parsed.newMemoryFindings || ""),
      notes: String(parsed.notes || ""),
      analyzedCount: analyzedTitles.length,
      totalSelected: ids.length,
      skippedTitles,
    });
  } catch (err) {
    const message = formatProviderError(err);
    console.error("Summarize API error:", message);
    res.status(500).json({ error: message });
  }
});

// ===== API: 融合 Prompt =====
router.post("/conversations/merge-prompt", async (req, res) => {
  const { newSystemFindings, newMemoryFindings, model: reqModel } = req.body || {};

  if (!newSystemFindings && !newMemoryFindings) {
    return res.status(400).json({ error: "没有需要融合的新发现" });
  }

  const model = (typeof reqModel === "string" && reqModel.trim())
    ? reqModel.trim()
    : (await readConfig()).model;

  const [currentSystem, currentMemory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);

  let userContent = "## 现有系统提示词\n\n";
  userContent += currentSystem || "（空）";
  userContent += "\n\n## 现有用户记忆\n\n";
  userContent += currentMemory || "（空）";
  userContent += "\n\n## 新发现的人格风格信息\n\n";
  userContent += newSystemFindings || "（无）";
  userContent += "\n\n## 新发现的用户画像信息\n\n";
  userContent += newMemoryFindings || "（无）";

  try {
    const client = getClientForModel(model);
    console.log(`[merge-prompt] model: ${model}, content: ${userContent.length} chars`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: MERGE_PROMPT },
          { role: "user", content: userContent },
        ],
      }, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }

    const output = response.choices[0]?.message?.content || "";

    let parsed;
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)```/)
                     || output.match(/\{[\s\S]*"mergedSystem"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : output;
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return res.status(502).json({
        error: "模型返回格式异常，无法解析为 JSON。请重试或更换模型。",
      });
    }

    res.json({
      mergedSystem: String(parsed.mergedSystem || ""),
      mergedMemory: String(parsed.mergedMemory || ""),
    });
  } catch (err) {
    const message = formatProviderError(err);
    console.error("Merge prompt API error:", message);
    res.status(500).json({ error: message });
  }
});

module.exports = router;
