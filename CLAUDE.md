# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Memoria.chat——带记忆和人格的私人 AI 聊天客户端，支持三渠道多模型（OpenAI / 火山引擎 / OpenRouter）、结构化长期记忆（自动学习 + 冲突检测 + 优先级注入）、人格工程（自定义人格 + 版本管理）、联网搜索、思考链展示、SSE 流式回复。许可证 CC BY-NC 4.0（不可商用）。

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

### Code Review with Codex

如果环境中安装了 `codex` CLI（OpenAI Codex），可用于深度代码审查：

```bash
codex review "Review focus: concurrency bugs, security vulnerabilities, memory leaks, edge cases, performance bottlenecks. Check lib/ routes/ public/modules/" --timeout 600000
```

**重要提示**: Codex review 非常慢但很细致，需要预留 **10 分钟以上**的执行时间（建议设置 `--timeout 600000` 即 10 分钟超时）。它会逐文件扫描并进行深度静态分析，比常规 linter 更能发现隐蔽的并发问题和边界情况。

### 测试

使用 vitest，测试文件在 `tests/`。

**测试环境设置:**
- `tests/setup.js` 设置 dummy 环境变量 (`OPENAI_API_KEY = "test-key-for-vitest"`) 以绕过 `clients.js` 的启动检查
- `tests/helpers/mock-clients.js` 提供模拟客户端工厂函数，返回带 `chat.completions.create()` 方法的 mock 对象
- 测试覆盖后端 `lib/` 模块（validators、config、auth、prompts、search、clients、auto-learn）和前端 `import-worker`

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
- `auto-learn.js` — 自动记忆提取逻辑、`resolveAutoLearnModel()`、冷却期控制、长度过滤

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

**模块设计要点**：
- 前端使用 `<script type="module">` 加载，共享状态通过 `state` 对象封装（避免 ES Module 导出不可变绑定问题）
- `getCurrentConv()` 放在 `state.js` 中以打破 `conversations ↔ render` 循环依赖（conversations 需要 render 渲染消息，render 需要 getCurrentConv 获取当前对话，通过 state 作为中间层解耦）

### Prompt 系统 (prompts/)

- `system.md` — 人格指令
- `memory.json` — 结构化记忆存储（三层分类：identity / preferences / events，每条含 id、text、date、source）
- `memory.md` — 兼容层（由 `memory.json` 自动生成，供 routes/summarize.js 读取）
- `config.json` — 模型参数（model、temperature、top_p、presence_penalty、frequency_penalty、context_window）

**记忆系统迁移:**
首次启动时，`lib/prompts.js: readMemoryStore()` 自动将旧版 `memory.md` 迁移到 `memory.json`。迁移逻辑：解析 Markdown bullet，提取 `[YYYY-MM-DD]` 日期前缀（有日期标记为 `ai_inferred`，无日期标记为 `user_stated`），按 `##` 标题分类到 identity/preferences/events。迁移后两个文件同步更新（memory.json 为主，memory.md 为渲染结果）。

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

### Auto-Learn 防膨胀

不做内容审查（开源项目不管控用户内容，用户用自己的 API key 有权自主使用）。防膨胀措施：
- 单条事实 ≤80 字（`lib/prompts.js: MAX_MEMORY_FACT_LENGTH`）
- memory.json 总量 ≤50KB（`MAX_MEMORY_TOTAL_LENGTH`）
- 冷却期默认 300 秒（`AUTO_LEARN_COOLDOWN`）
- `resolveAutoLearnModel()` 自动适配渠道格式（OpenAI → `gpt-4o-mini`，OpenRouter → `openai/gpt-4o-mini`，火山引擎 → `doubao-1-5-lite-32k-250115`）

**记忆注入优先级:** `lib/prompts.js: selectMemoryForPrompt()` 按 token 预算选择记忆注入上下文——identity 全量注入，preferences/events 按日期降序逐条检查预算（默认 1500 tokens）。

## 关键设计决策

- **对话 ID 格式:** 10-16 位纯数字字符串（`Date.now()` 生成，`lib/validators.js` 校验）
- **图片上传:** 前端压缩为 base64 data URL（≤4MB），以 OpenAI vision `image_url` content part 发送；导入的 ChatGPT 图片存服务端 `data/images/`，发送模型前自动转 base64
- **请求保护:** 请求体限制 20MB，`/api/chat` 120 秒空闲超时（有 chunk 到达就续期），客户端断开时通过 AbortController 中止上游请求
- **前端架构:** 无路由、无打包，Express 直接 serve `public/` 静态文件
- **客户端复用:** 三个 OpenAI SDK 客户端实例共用同一个 `openai` 包，通过不同 `baseURL` / `apiKey` 区分渠道
- **数据初始化:** `data/conversations/` 和 `data/images/` 在启动时自动创建（`mkdirSync recursive`）
- **双向同步:** 对话列表前端 localStorage 缓存 + 服务端 JSON 文件双向同步（前端读取缓存快速渲染，后台异步拉服务端数据合并）
