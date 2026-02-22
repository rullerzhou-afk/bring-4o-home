# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GPT-4o 私人聊天界面——开源的 AI 对话系统，支持三渠道多模型（OpenAI / 火山引擎 / OpenRouter）、自定义人格、用户记忆管理、联网搜索、思考链展示、SSE 流式回复。许可证 CC BY-NC 4.0（不可商用）。

## 开发命令

```bash
npm install
npm start          # node server.js，默认监听 127.0.0.1:3000
npm test           # vitest run，跑全部测试
npm run test:watch # vitest watch 模式
npx vitest run tests/validators.test.js   # 跑单个测试文件
npx vitest run -t "test name"             # 按测试名过滤
```

无 lint 或构建步骤。`.env` 必须存在且至少配一个 API Key（`OPENAI_API_KEY` / `ARK_API_KEY` / `OPENROUTER_API_KEY` 三选一），否则 `process.exit(1)`。环境变量参考 `.env.example`。

### 测试

使用 vitest，测试文件在 `tests/`。`tests/setup.js` 设置 dummy 环境变量以绕过 `clients.js` 的启动检查。`tests/helpers/mock-clients.js` 提供模拟客户端。测试覆盖后端 `lib/` 模块（validators、config、auth、prompts、search、clients、auto-learn）和前端 `import-worker`。

## 技术栈

- **后端**: Node.js + Express + OpenAI SDK (`openai` v4)，**CommonJS**（`require`/`module.exports`）
- **前端**: 纯 Vanilla JS（**ES Modules**, `import`/`export`）+ HTML + CSS（无框架），CDN 引入 marked.js + DOMPurify
- **持久化**: 对话存于 `data/conversations/`（JSON 文件）；Prompt 和模型配置存于 `prompts/`；导入图片存于 `data/images/`；auth token 存于浏览器 localStorage

## 架构

### 后端

`server.js` 是薄入口（~36 行），只负责 Express 中间件挂载和启动。业务逻辑拆分为：

**`lib/` — 工具模块**（被 routes 引用）：
- `clients.js` — 三个 OpenAI SDK 客户端实例、`getClientForModel()` 路由、`DEFAULT_CONFIG`
- `config.js` — 对话文件路径、`readConfig()`/`saveConfig()`、`normalizeConfig()` 参数钳位
- `prompts.js` — 读写 `system.md`/`memory.md`、`buildSystemPrompt()` 组装系统提示词
- `validators.js` — 所有写入端点的输入验证函数（类型检查、长度限制、白名单字段）
- `auth.js` — `/api` 全局鉴权中间件（Bearer token 或 loopback IP）
- `search.js` — Serper.dev Google 搜索、`web_search` tool 定义
- `auto-learn.js` — 自动记忆提取逻辑、`resolveAutoLearnModel()`、`MEMORY_BLOCKLIST` 安全过滤

**`routes/` — 路由模块**（每个文件导出一个 Express Router）：
- `chat.js` — SSE 流式聊天，支持多轮 function calling（web_search，最多 3 轮）、思考链转发
- `conversations.js` — 对话 CRUD + 全文搜索（id 为 10-16 位纯数字字符串）
- `models.js` — 列出已配置渠道的可用模型（白名单过滤）
- `config.js` — 读写 `config.json`
- `prompts.js` — 读写 `system.md` 和 `memory.md`
- `auto-learn.js` — 自动记忆触发端点
- `images.js` — 图片上传（multer, MIME + 扩展名白名单, 10MB 限制）
- `summarize.js` — 对话总结 & Prompt 融合（两步式：提取新发现 → 智能合并）

### 前端

`public/app.js` 是薄入口（~200 行），只负责事件绑定和初始化。逻辑拆分到 `public/modules/`：

- `state.js` — 共享可变状态对象 `state`、DOM 元素引用、`getCurrentConv()`
- `api.js` — `apiFetch()` 封装（自动附加 Bearer token、离线检测）
- `chat.js` — `sendMessage()`、SSE 流接收与解析、auto-learn 触发
- `conversations.js` — 对话列表渲染、时间分组、批量管理、搜索、服务端同步
- `render.js` — 消息气泡渲染、Markdown 解析、代码高亮、思考链折叠
- `images.js` — 图片压缩、预览、拖拽/粘贴上传
- `settings.js` — 设置面板（4 个 Tab：人格/记忆/参数/导入）
- `theme.js` — 亮/暗/跟随系统三档主题
- `import.js` — ChatGPT 数据导入 UI 逻辑（配合 `import-worker.js` Web Worker 后台解析）

**模块设计要点**：前端使用 `<script type="module">` 加载，共享状态通过 `state` 对象封装（避免 ES Module 导出不可变绑定问题）。`getCurrentConv()` 放在 `state.js` 中以打破 `conversations ↔ render` 循环依赖。

### Prompt 系统 (prompts/)

- `system.md` — 人格指令
- `memory.md` — 用户画像 + 长期记忆（auto-learn 自动追加，带 `[YYYY-MM-DD]` 日期前缀）
- `config.json` — 模型参数（model、temperature、top_p、presence_penalty、frequency_penalty、context_window）

三个文件均可通过前端设置面板实时编辑，无需重启服务。恢复默认时旧设置自动备份到 `prompts/backups/`。

## 核心机制

### 三渠道模型路由 (`lib/clients.js: getClientForModel`)

根据模型 ID 自动选择 API 客户端：
- 含 `/` → OpenRouter（如 `anthropic/claude-3.5-sonnet`）
- 匹配 `/^(gpt|o[0-9]|chatgpt)/i` → OpenAI
- 其他 → 火山引擎（如 `glm-4-plus`）

### 搜索工具兼容性

`noToolsModel` 正则 `/(-r1|-thinking)|(^|\/)glm-/i` 自动跳过 tools 参数——推理模型和 GLM 不支持 function calling。

### SSE 流协议

前端用 `fetch` + `ReadableStream` 手动解析（非 EventSource）。事件类型：
- `{"content":"..."}` — 正文
- `{"reasoning":"..."}` — 思考链
- `{"status":"..."}` — 搜索状态
- `{"meta":{...}}` — token 用量
- `{"error":"..."}` — 错误
- `[DONE]` — 结束

### Auto-Learn 安全

blocklist 正则过滤注入式内容（`MEMORY_BLOCKLIST`），单条事实 ≤80 字，memory 总量 ≤50KB，冷却期默认 300 秒。`resolveAutoLearnModel()` 自动适配渠道格式。

## 关键设计决策

- 图片上传：前端压缩为 base64 data URL（≤4MB），以 OpenAI vision `image_url` content part 发送；导入的 ChatGPT 图片存服务端 `data/images/`，发送模型前自动转 base64
- 请求体限制 20MB，`/api/chat` 120 秒超时保护
- 客户端断开时通过 AbortController 中止上游请求
- 前端无路由、无打包，Express 直接 serve `public/` 静态文件
- 三个 OpenAI SDK 客户端实例共用同一个 `openai` 包，通过不同 `baseURL` / `apiKey` 区分渠道
- `data/conversations/` 和 `data/images/` 在启动时自动创建（`mkdirSync recursive`）
- 对话列表前端 localStorage 缓存 + 服务端 JSON 文件双向同步
