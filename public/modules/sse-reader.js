/**
 * 共享 SSE 流解析工具
 * chat.js 和 voice controller 共用，避免逻辑重复
 */

/**
 * 解析 SSE 流，分发事件到回调
 * @param {ReadableStream} body - fetch response.body
 * @param {object} handlers - 回调函数
 * @param {function} [handlers.onContent]   - (text: string) => void
 * @param {function} [handlers.onReasoning] - (text: string) => void
 * @param {function} [handlers.onStatus]    - (status: string) => void
 * @param {function} [handlers.onMeta]      - (meta: object) => void
 * @param {function} [handlers.onError]     - (errorMsg: string) => void
 * @param {function} [handlers.onChunk]     - () => void, 每次收到数据时调用（用于重置超时等）
 * @param {number}   [maxParseErrors=3]     - 连续 JSON 解析失败次数上限
 */
export async function parseSseStream(body, handlers = {}, maxParseErrors = 3) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  let parseErrors = 0;

  try {
    while (!done) {
      const result = await reader.read();
      if (result.done) break;
      handlers.onChunk?.();

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          done = true;
          await reader.cancel();
          break;
        }

        try {
          const parsed = JSON.parse(data);
          parseErrors = 0;
          if (parsed.error) {
            handlers.onError?.(parsed.error);
          } else if (parsed.reasoning) {
            handlers.onReasoning?.(parsed.reasoning);
          } else if (parsed.status) {
            handlers.onStatus?.(parsed.status);
          } else if (parsed.meta) {
            handlers.onMeta?.(parsed.meta);
          } else if (parsed.content) {
            handlers.onContent?.(parsed.content);
          }
        } catch {
          parseErrors++;
          if (parseErrors >= maxParseErrors) {
            await reader.cancel();
            break;
          }
        }
      }
    }

    // flush decoder 残余字节
    const flushed = decoder.decode();
    if (flushed) buffer += flushed;
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) handlers.onContent?.(parsed.content);
          else if (parsed.reasoning) handlers.onReasoning?.(parsed.reasoning);
          else if (parsed.meta) handlers.onMeta?.(parsed.meta);
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { parseErrors };
}
