// Web Worker: 解析 ChatGPT 导出的 conversations.json
// 在独立线程中执行 JSON 解析和树形结构展平，避免大文件阻塞 UI

onmessage = function (e) {
  try {
    const jsonData = JSON.parse(e.data);
    if (!Array.isArray(jsonData)) {
      postMessage({ error: "文件格式不正确，期望一个 JSON 数组" });
      return;
    }

    const conversations = [];
    const usedIds = new Set();

    for (const conv of jsonData) {
      if (!conv.mapping) continue;

      // 找到起始节点：优先用 current_node，否则找时间戳最新的叶子节点
      let startNode = conv.current_node;
      if (!startNode || !conv.mapping[startNode]) {
        // fallback: 找所有叶子节点中 create_time 最大的（最新分支）
        let bestLeaf = null;
        let bestTime = -1;
        for (const [nodeId, node] of Object.entries(conv.mapping)) {
          if (!node.children || node.children.length === 0) {
            var t = (node.message && node.message.create_time) || 0;
            if (t > bestTime || bestLeaf === null) {
              bestTime = t;
              bestLeaf = nodeId;
            }
          }
        }
        if (bestLeaf) startNode = bestLeaf;
      }
      if (!startNode || !conv.mapping[startNode]) continue;

      // 从叶子节点沿 parent 链向上遍历到根
      const chain = [];
      let nodeId = startNode;
      const visited = new Set(); // 防止循环引用
      while (nodeId && conv.mapping[nodeId] && !visited.has(nodeId)) {
        visited.add(nodeId);
        chain.push(conv.mapping[nodeId]);
        nodeId = conv.mapping[nodeId].parent;
      }
      chain.reverse(); // 根→叶顺序

      // 提取有效消息（只要 user 和 assistant 的文本消息）
      const messages = [];
      for (const node of chain) {
        const msg = node.message;
        if (!msg || !msg.content) continue;
        const role = msg.author && msg.author.role;
        if (role !== "user" && role !== "assistant") continue;
        if (msg.content.content_type !== "text") continue;
        const parts = (msg.content.parts || []).filter(function (p) {
          return typeof p === "string";
        });
        const text = parts.join("\n").trim();
        if (!text) continue;
        messages.push({ role: role, content: text });
      }
      if (messages.length === 0) continue;

      // 生成兼容 ID（create_time 秒→毫秒，确保 10-16 位纯数字）
      const ts = conv.create_time || conv.update_time || Date.now() / 1000;
      let id = Math.round(ts * 1000).toString();
      if (id.length < 10) id = id.padStart(10, "0");
      if (id.length > 16) id = id.slice(0, 16);

      // 处理 ID 冲突（Worker 内部去重）
      while (usedIds.has(id)) {
        id = (parseInt(id, 10) + 1).toString();
      }
      usedIds.add(id);

      const title = (conv.title || "未命名对话").slice(0, 200);
      conversations.push({
        id: id,
        title: title,
        messages: messages,
        messageCount: messages.length,
        createTime: ts,
      });
    }

    // 按 createTime 倒序（最新的在前）
    conversations.sort(function (a, b) {
      return (b.createTime || 0) - (a.createTime || 0);
    });

    postMessage({ conversations: conversations });
  } catch (err) {
    postMessage({
      error: err.message || "JSON 解析失败，请确认是 ChatGPT 导出的 conversations.json",
    });
  }
};
