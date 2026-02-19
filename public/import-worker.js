// Web Worker: 解析 ChatGPT 导出的 conversations.json
// 在独立线程中执行 JSON 解析和树形结构展平，避免大文件阻塞 UI
// 支持 text、multimodal_text 消息，以及 DALL-E tool 消息

onmessage = function (e) {
  try {
    var input = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    // 支持两种调用方式：直接传 JSON 字符串，或传 { json, hasImages } 对象
    var jsonData = input;
    var hasImages = false;
    if (input && !Array.isArray(input) && input.json) {
      jsonData = typeof input.json === "string" ? JSON.parse(input.json) : input.json;
      hasImages = !!input.hasImages;
    }

    if (!Array.isArray(jsonData)) {
      postMessage({ error: "文件格式不正确，期望一个 JSON 数组" });
      return;
    }

    var conversations = [];
    var usedIds = new Set();

    for (var ci = 0; ci < jsonData.length; ci++) {
      var conv = jsonData[ci];
      if (!conv.mapping) continue;

      // 找到起始节点：优先用 current_node，否则找时间戳最新的叶子节点
      var startNode = conv.current_node;
      if (!startNode || !conv.mapping[startNode]) {
        var bestLeaf = null;
        var bestTime = -1;
        for (var nodeId in conv.mapping) {
          var node = conv.mapping[nodeId];
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
      var chain = [];
      var curNode = startNode;
      var visited = new Set();
      while (curNode && conv.mapping[curNode] && !visited.has(curNode)) {
        visited.add(curNode);
        chain.push(conv.mapping[curNode]);
        curNode = conv.mapping[curNode].parent;
      }
      chain.reverse();

      // 提取有效消息
      var messages = [];
      var imageFileIds = [];

      for (var ni = 0; ni < chain.length; ni++) {
        var msg = chain[ni].message;
        if (!msg || !msg.content) continue;

        var role = msg.author && msg.author.role;
        // 支持 user、assistant、tool（DALL-E 图片生成）
        if (role !== "user" && role !== "assistant" && role !== "tool") continue;

        var ct = msg.content.content_type;
        if (ct !== "text" && ct !== "multimodal_text") continue;

        var outputRole = (role === "tool") ? "assistant" : role;
        var parts = msg.content.parts || [];

        if (ct === "text") {
          // 纯文本消息（原有逻辑）
          var textParts = [];
          for (var pi = 0; pi < parts.length; pi++) {
            if (typeof parts[pi] === "string") textParts.push(parts[pi]);
          }
          var text = textParts.join("\n").trim();
          if (!text) continue;
          messages.push({ role: outputRole, content: text });
        } else {
          // multimodal_text：混合文本和图片
          var contentParts = [];

          for (var pi2 = 0; pi2 < parts.length; pi2++) {
            var part = parts[pi2];
            if (typeof part === "string") {
              var trimmed = part.trim();
              if (trimmed) {
                contentParts.push({ type: "text", text: trimmed });
              }
            } else if (part && typeof part === "object") {
              // 图片资源引用
              var pointer = part.asset_pointer || "";
              var fileId = null;

              if (pointer.startsWith("file-service://")) {
                fileId = pointer.replace("file-service://", "");
              } else if (pointer.startsWith("sediment://")) {
                fileId = pointer.replace("sediment://", "");
              }

              if (fileId) {
                imageFileIds.push(fileId);
                if (hasImages) {
                  // 有图片文件可用，标记为待替换的图片占位
                  contentParts.push({
                    type: "image_asset_pointer",
                    file_id: fileId,
                  });
                } else {
                  // 没有图片文件，显示占位文本
                  var dallePrompt = part.metadata && part.metadata.dalle && part.metadata.dalle.prompt;
                  if (dallePrompt) {
                    contentParts.push({
                      type: "text",
                      text: "[图片: DALL-E 生成, 提示词: " + dallePrompt + "]",
                    });
                  } else {
                    contentParts.push({
                      type: "text",
                      text: "[图片: 已从 ChatGPT 导入，需上传完整导出文件夹以恢复图片]",
                    });
                  }
                }
              }
            }
          }

          if (contentParts.length === 0) continue;

          // 如果所有 part 都是纯文本，合并为字符串（节省空间）
          var allText = contentParts.every(function (p) { return p.type === "text"; });
          if (allText) {
            var combined = contentParts.map(function (p) { return p.text; }).join("\n").trim();
            if (!combined) continue;
            messages.push({ role: outputRole, content: combined });
          } else {
            messages.push({ role: outputRole, content: contentParts });
          }
        }
      }

      if (messages.length === 0) continue;

      // 生成兼容 ID
      var ts = conv.create_time || conv.update_time || Date.now() / 1000;
      var id = Math.round(ts * 1000).toString();
      if (id.length < 10) id = id.padStart(10, "0");
      if (id.length > 16) id = id.slice(0, 16);
      while (usedIds.has(id)) {
        id = (parseInt(id, 10) + 1).toString();
      }
      usedIds.add(id);

      // 去重 imageFileIds
      var uniqueIds = [];
      var seen = new Set();
      for (var ii = 0; ii < imageFileIds.length; ii++) {
        if (!seen.has(imageFileIds[ii])) {
          seen.add(imageFileIds[ii]);
          uniqueIds.push(imageFileIds[ii]);
        }
      }

      var title = (conv.title || "未命名对话").slice(0, 200);
      conversations.push({
        id: id,
        title: title,
        messages: messages,
        messageCount: messages.length,
        createTime: ts,
        imageFileIds: uniqueIds,
      });
    }

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
