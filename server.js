require("dotenv").config();

const express = require("express");
const path = require("path");
const { IMAGES_DIR } = require("./lib/config");
const { ADMIN_TOKEN, authMiddleware } = require("./lib/auth");
const { readConfig } = require("./lib/config");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", authMiddleware);
app.use("/images", authMiddleware, express.static(IMAGES_DIR));

app.use("/api", require("./routes/images"));
app.use("/api", require("./routes/prompts"));
app.use("/api", require("./routes/config"));
app.use("/api", require("./routes/auto-learn"));
app.use("/api", require("./routes/conversations"));
app.use("/api", require("./routes/models"));
app.use("/api", require("./routes/summarize"));
app.use("/api", require("./routes/chat"));

// 404 兜底（未匹配的 /api 路由返回 JSON 而非 HTML）
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 全局错误处理中间件（JSON parse 失败、multer 错误等）
app.use((err, req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ error: err.message });
  }
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, async () => {
  const config = await readConfig();
  console.log(`服务已启动: http://${HOST}:${PORT}`);
  console.log(`当前模型: ${config.model}`);
  console.log(`温度: ${config.temperature}`);
  if (!ADMIN_TOKEN) {
    console.log("未设置 ADMIN_TOKEN，仅允许本机访问 /api。");
  }
});
