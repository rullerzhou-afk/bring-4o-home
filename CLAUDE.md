# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GPT-4o 私人聊天界面——开源的 AI 对话系统，支持三渠道多模型（OpenAI / 火山引擎 / OpenRouter）、自定义人格、用户记忆管理、联网搜索、思考链展示、SSE 流式回复。

## 技术栈

- **后端**: Node.js + Express + OpenAI SDK (`openai` v4)，单文件 `server.js`（~1040 行）
- **前端**: 纯 Vanilla JS + HTML + CSS（无框架），CDN 引入 marked.js + DOMPurify
- **持久化**: 对话存于服务端 `data/conversations/`（JSON 文件）；Prompt 和模型配置存于 `prompts/` 目录；auth token 存于浏览器 LocalStorage
- **许可证**: CC BY-NC 4.0（不可商用）

## 启动命令

```bash
npm install
npm start          # node server.js，默认监听 127.0.0.1:3000
```

无测试、lint 或构建步骤。`.env` 必须存在且至少配一个 API Key，否则 `process.exit(1)`。

## 环境变量

通过 `.env` 加载（参考 `.env.example`）：

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 三选一 | OpenAI API 密钥 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容网关地址（默认官方） |
| `ARK_API_KEY` | 三选一 | 火山引擎方舟平台 API key（GLM、Kimi） |
| `ARK_BASE_URL` | 否 | 火山方舟 API 地址（默认 `https://ark.cn-beijing.volces.com/api/v3`） |
| `OPENROUTER_API_KEY` | 三选一 | OpenRouter API key |
| `OPENROUTER_BASE_URL` | 否 | OpenRouter API 地址（默认 `https://openrouter.ai/api/v1`） |
| `OPENROUTER_SITE_URL` | 否 | OpenRouter 请求头 `HTTP-Referer` |
| `OPENROUTER_APP_NAME` | 否 | OpenRouter 请求头 `X-Title`（默认 `bring-4o-home`） |
| `ADMIN_TOKEN` | 否 | 鉴权 token；未设置时仅允许 loopback IP 访问 |
| `SERPER_API_KEY` | 否 | Serper.dev 搜索 API key；配置后自动启用联网搜索 |
| `HOST` / `PORT` | 否 | 监听地址，默认 `127.0.0.1:3000` |
| `MODEL` | 否 | 默认模型，fallback `gpt-4o` |
| `AUTO_LEARN_MODEL` | 否 | 自动记忆提取模型，自动按可用渠道选择 |
| `AUTO_LEARN_COOLDOWN` | 否 | 自动记忆冷却秒数，默认 `300` |

## 架构

### 后端 (server.js)

单文件 Express 服务器，所有逻辑在此。

**三渠道模型路由** (`getClientForModel`): 根据模型 ID 自动选择 API 客户端：
- 含 `/` → OpenRouter（如 `anthropic/claude-3.5-sonnet`）
- 匹配 `/^(gpt|o[0-9]|chatgpt)/i` → OpenAI
- 其他 → 火山引擎（如 `glm-4-plus`）

**模型白名单** (`/api/models`):
- OpenAI: 正则 `/^(gpt-4o(-2024-(05-13|08-06|11-20))?|gpt-4\.1(-mini|-nano)?|o3(-mini)?)$/`
- 火山引擎: ID 含 `glm` 或 `kimi`
- OpenRouter: 同 OpenAI 正则（按 `/` 后的 shortId 匹配）

**搜索工具兼容性**: 通过 `noToolsModel` 正则 `/(-r1|-thinking)|(^|\/)glm-/i` 自动跳过 tools 参数。匹配的模型不会收到 function calling 参数。

**Auto-Learn 模型解析** (`resolveAutoLearnModel`): 自动适配渠道格式——若只配了 OpenRouter 而未配 OpenAI，`gpt-4o-mini` 会自动转换为 `openai/gpt-4o-mini`。

**API 端点**:

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/chat` | POST | 核心：SSE 流式聊天，支持多轮 function calling（web_search，最多 3 轮）、思考链（`reasoning_content`）转发 |
| `/api/prompts` | GET/PUT | 读写 `system.md` 和 `memory.md` |
| `/api/config` | GET/PUT | 读写 `config.json`（model、temperature、top_p、presence_penalty、frequency_penalty） |
| `/api/memory/auto-learn` | POST | 轻量模型提取用户信息 → 追加到 `memory.md` |
| `/api/models` | GET | 列出所有已配置渠道的可用模型（白名单过滤） |
| `/api/conversations` | GET | 列出所有服务端存储的对话 |
| `/api/conversations/search` | POST | 全文搜索对话内容 |
| `/api/conversations/:id` | GET/PUT/DELETE | 单条对话的 CRUD（id 为 10-16 位纯数字字符串） |

**鉴权**: `/api` 全局中间件。设 `ADMIN_TOKEN` 时需 Bearer token；未设时仅允许 loopback IP。

**输入验证**: 所有写入端点都有 `validate*` 函数（类型检查、长度限制、白名单字段）。

### 前端 (public/)

- `index.html` — 页面结构，CDN 引入 marked.js + DOMPurify
- `app.js`（~1280 行） — 所有前端逻辑（状态管理、对话管理、图片处理、SSE 流接收、设置面板、auto-learn 触发）
- `style.css`（~1025 行） — 支持亮/暗/跟随系统三档主题

**SSE 解析**: 前端用 `fetch` + `ReadableStream` 手动解析 SSE（非 EventSource），支持 `content`、`reasoning`、`status`、`meta`、`error` 五种事件类型。

### Prompt 系统 (prompts/)

- `system.md` — 人格指令（可自定义）
- `memory.md` — 用户画像 + 长期记忆（auto-learn 自动追加，带日期前缀 `[YYYY-MM-DD]`）
- `config.json` — 模型参数

三个文件均可通过前端设置面板实时编辑，无需重启服务。

## 关键设计决策

- SSE 流格式：`data: {"content":"..."}\n\n`（正文）、`{"reasoning":"..."}`（思考链）、`{"status":"..."}`（搜索状态）、`{"meta":{...}}`（token 用量）、`{"error":"..."}`、`[DONE]`
- 图片上传：前端压缩为 base64 data URL（≤4MB），以 OpenAI vision `image_url` content part 发送
- 请求体限制 20MB
- Auto-learn 安全：blocklist 正则过滤注入式内容（`MEMORY_BLOCKLIST`），单条事实≤80 字，memory 总量≤50KB，冷却期默认 300 秒
- 前端无路由、无打包，Express 直接 serve `public/` 静态文件
- 120 秒请求超时保护（`/api/chat`），客户端断开时通过 AbortController 中止上游请求
- `data/conversations/` 目录在启动时自动创建（`mkdirSync recursive`）
- 三个 OpenAI SDK 客户端实例共用同一个 `openai` 包，通过不同 `baseURL` 和 `apiKey` 区分渠道
