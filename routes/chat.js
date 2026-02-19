const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const router = require("express").Router();
const { getClientForModel, formatProviderError } = require("../lib/clients");
const { readConfig, IMAGES_DIR } = require("../lib/config");
const { buildSystemPrompt } = require("../lib/prompts");
const { validateMessages } = require("../lib/validators");
const { SERPER_API_KEY, MAX_TOOL_ROUNDS, SEARCH_TOOL, executeWebSearch } = require("../lib/search");

router.post("/chat", async (req, res) => {
  const validated = validateMessages(req.body?.messages);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const abortController = new AbortController();
  const onClientDisconnect = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  req.on("aborted", onClientDisconnect);
  res.on("close", onClientDisconnect);
  let startedSse = false;

  // 120 秒超时保护，防止请求卡死整个服务器
  const requestTimeout = setTimeout(() => {
    console.error("[chat] request timeout (120s), aborting");
    abortController.abort();
  }, 120_000);

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
      res.socket.setTimeout(0);
    }
    startedSse = true;

    // 立即发一个状态事件：给用户即时反馈 + 冲刷连接缓冲
    res.write(`data: ${JSON.stringify({ status: "思考中..." })}\n\n`);

    const [config, systemPrompt] = await Promise.all([readConfig(), buildSystemPrompt()]);
    const client = getClientForModel(config.model);

    const baseParams = {
      model: config.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: config.temperature ?? 1,
    };
    if (config.top_p !== undefined) baseParams.top_p = config.top_p;
    if (config.presence_penalty !== undefined) baseParams.presence_penalty = config.presence_penalty;
    if (config.frequency_penalty !== undefined) baseParams.frequency_penalty = config.frequency_penalty;

    // 配置了 Serper API Key 时启用搜索工具
    // 以下模型不支持标准 function calling，需要跳过：
    //   - 推理模型（deepseek-r1、doubao-thinking）：无 tool_calls 能力
    //   - GLM 系列：会输出"调用工具"文本但不返回结构化 tool_calls
    const noToolsModel = /(-r1|-thinking)|(^|\/)glm-/i.test(config.model);
    if (SERPER_API_KEY && !noToolsModel) {
      baseParams.tools = [SEARCH_TOOL];
    }

    const allMessages = [];
    if (systemPrompt) {
      allMessages.push({ role: "system", content: systemPrompt });
    }
    allMessages.push(...validated.value);

    // 将服务端图片路径转为 base64 data URL（模型只认 base64 或公网 URL）
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("/images/")) {
          try {
            const imgPath = path.join(IMAGES_DIR, path.basename(part.image_url.url));
            const buf = await fsp.readFile(imgPath);
            const ext = path.extname(imgPath).slice(1).toLowerCase();
            const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
            part.image_url.url = "data:" + (mimeMap[ext] || "image/png") + ";base64," + buf.toString("base64");
          } catch (e) {
            console.error("Failed to read image:", part.image_url.url, e.message);
            part.type = "text";
            part.text = "[图片不可用]";
            delete part.image_url;
          }
        }
      }
    }

    // assistant 多模态消息降级为纯文本（模型不需要看自己以前生成的图片）
    for (const msg of allMessages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textParts = msg.content.filter((p) => p.type === "text").map((p) => p.text);
        msg.content = textParts.join("\n") || "[图片]";
      }
    }

    // Token 统计（跨多轮累加）
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // 多轮 tool-call 循环
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (abortController.signal.aborted || res.writableEnded) break;

      console.log(`[chat] round ${round + 1}/${MAX_TOOL_ROUNDS}, messages: ${allMessages.length}, model: ${baseParams.model}, tools: ${baseParams.tools ? "yes" : "no"}`);
      const stream = await client.chat.completions.create(
        { ...baseParams, messages: allMessages },
        { signal: abortController.signal },
      );
      console.log("[chat] stream created, reading chunks...");

      let assistantContent = "";
      let toolCalls = [];
      let finishReason = null;
      let chunkCount = 0;

      for await (const chunk of stream) {
        chunkCount++;
        if (abortController.signal.aborted || res.writableEnded) break;

        // 收集 usage（最后一个 chunk 才有，此时 choices 可能为空）
        if (chunk.usage) {
          totalPromptTokens += chunk.usage.prompt_tokens || 0;
          totalCompletionTokens += chunk.usage.completion_tokens || 0;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          console.log(`[chat] finish_reason: ${finishReason}`);
        }

        const delta = choice.delta;
        if (!delta) continue;

        // 思考链（DeepSeek R1、doubao-thinking 等模型）→ 转发给前端展示
        if (delta.reasoning_content) {
          res.write(`data: ${JSON.stringify({ reasoning: delta.reasoning_content })}\n\n`);
        }

        // 正常内容 → 直接转发
        if (delta.content) {
          assistantContent += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        // tool_calls 增量拼接
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      console.log(`[chat] stream done, ${chunkCount} chunks, finishReason: ${finishReason}`);

      // 不是 tool_calls → 跳出循环
      if (finishReason !== "tool_calls" || toolCalls.length === 0) {
        console.log(`[chat] no tool_calls, finishing`);
        break;
      }

      console.log(`[chat] tool_calls detected: ${toolCalls.map((t) => t.function.name).join(", ")}`);

      // 将 assistant 的 tool_calls 消息追加到对话
      allMessages.push({ role: "assistant", content: assistantContent || null, tool_calls: toolCalls });

      // 逐个执行 tool call
      for (const tc of toolCalls) {
        if (tc.function.name === "web_search") {
          let args;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { query: tc.function.arguments };
          }
          console.log(`[chat] searching: "${args.query}"`);
          res.write(`data: ${JSON.stringify({ status: `正在搜索：${args.query}` })}\n\n`);
          const result = await executeWebSearch(args.query);
          console.log(`[chat] search done, result length: ${result.length}`);
          allMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
        } else {
          allMessages.push({ role: "tool", tool_call_id: tc.id, content: `Unknown tool: ${tc.function.name}` });
        }
      }
      // 循环继续 → 带着 tool results 再次调 OpenAI
    }

    if (!res.writableEnded) {
      // 发送 meta 信息（token 用量 + 模型名）
      if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
        res.write(`data: ${JSON.stringify({
          meta: {
            model: config.model,
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalPromptTokens + totalCompletionTokens,
          },
        })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    clearTimeout(requestTimeout);
    if (abortController.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    const message = formatProviderError(err);
    console.error("Model API error:", message);
    if (startedSse && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
      return;
    }
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  } finally {
    clearTimeout(requestTimeout);
    req.off("aborted", onClientDisconnect);
    res.off("close", onClientDisconnect);
  }
});

module.exports = router;
