# GPT-4o Chat

把 GPT-4o 搬回家——开源的私人 AI 聊天界面，零代码基础也能部署。

网页版下线了，API 还在。同一个模型、同一个脑子，只是换了个入口。

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/你的用户名/gpt-4o-chat.git
cd gpt-4o-chat

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 4. 启动
npm start
# 打开浏览器访问 http://127.0.0.1:3000
```

## 功能特性

- **三渠道多模型** — OpenAI (GPT-4o/4.1/o3) + 火山引擎 (GLM/Kimi) + OpenRouter (Claude/Gemini/Llama 等)
- **SSE 流式回复** — 实时显示生成内容，打字机效果
- **自定义人格** — 通过 system prompt 定义 AI 的性格、语气、技能
- **自动记忆** — 对话后自动提取用户信息存入长期记忆
- **联网搜索** — 通过 Serper.dev Google 搜索（需模型支持 function calling）
- **思考链展示** — DeepSeek R1 等推理模型的思考过程可折叠查看
- **图片上传** — 支持 vision 模型的图片理解
- **对话持久化** — 服务端存储，聊天记录不丢失
- **聊天历史搜索** — 全文搜索历史对话内容
- **亮/暗主题切换** — 暗色、亮色、跟随系统三档
- **Token 用量显示** — 每条回复显示 token 数、模型名、响应时间

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 三选一 | OpenAI API 密钥 |
| `ARK_API_KEY` | 三选一 | 火山引擎方舟平台 API key（GLM、Kimi） |
| `OPENROUTER_API_KEY` | 三选一 | OpenRouter API key（无国际信用卡也可用） |
| `ADMIN_TOKEN` | 否 | 鉴权 token；未设置时仅允许本机访问 |
| `SERPER_API_KEY` | 否 | Serper.dev 搜索 API key；配置后自动启用联网搜索 |
| `HOST` / `PORT` | 否 | 监听地址，默认 `127.0.0.1:3000` |
| `MODEL` | 否 | 默认模型，fallback `gpt-4o` |
| `AUTO_LEARN_MODEL` | 否 | 自动记忆提取模型，默认 `gpt-4o-mini` |
| `AUTO_LEARN_COOLDOWN` | 否 | 自动记忆冷却秒数，默认 `300` |

> 三个 API Key 至少配置一个，下拉框只会显示已配置渠道的模型。

## 自定义你的 AI

项目内置了三个可编辑文件，也可以通过网页右上角的设置面板实时修改：

| 文件 | 用途 | 说明 |
|------|------|------|
| `prompts/system.md` | 人格指令 | 定义 AI 的性格、语气、规则 |
| `prompts/memory.md` | 用户记忆 | 你的画像 + 长期记忆（auto-learn 会自动追加） |
| `prompts/config.json` | 模型参数 | model、temperature、frequency_penalty 等 |

### 推荐参数

```json
{
  "model": "gpt-4o-2024-11-20",
  "temperature": 0.85,
  "presence_penalty": 0,
  "frequency_penalty": 0.15
}
```

- `gpt-4o-2024-11-20` — 人格最稳定的 4o 版本
- `temperature: 0.85` — 比默认 1 略低，人格一致性更好
- `frequency_penalty: 0.15` — 减少重复用词，回复更自然

## 模型渠道与路由

| 渠道 | 模型 ID 特征 | 示例 |
|------|-------------|------|
| OpenAI | `gpt-*`、`o3-*` | `gpt-4o`、`gpt-4.1`、`o3-mini` |
| 火山引擎 | 不含 `/` 的国产模型 | `glm-4-plus`、`kimi-xxx` |
| OpenRouter | 含 `/` | `anthropic/claude-3.5-sonnet`、`google/gemini-2.0-flash` |

## 联网搜索支持

联网搜索依赖模型的 **function calling** 能力：

| 模型 | 搜索 | 说明 |
|------|:----:|------|
| GPT-4o / GPT-4.1 / o3 系列 | :white_check_mark: | OpenAI 原生 function calling |
| OpenRouter 多数模型 (Claude/Gemini 等) | :white_check_mark: | 支持 function calling |
| DeepSeek R1 等推理模型 | :x: | 推理模型不支持 function calling |
| GLM 系列 | :x: | 不返回结构化 `tool_calls` |

> 不支持搜索的模型会自动跳过 tools 参数，不影响正常对话。

## 技术栈

- **后端**: Node.js + Express + OpenAI SDK (v4)
- **前端**: 纯 HTML/CSS/JS（无框架），marked.js + DOMPurify (CDN)
- **存储**: 文件系统（JSON）

无构建步骤、无数据库、无框架依赖，一个 `npm start` 就跑起来。

## 关于费用

- ChatGPT Plus：$20/月
- API 日常聊天（每天 30-50 条）：约 $1-3/月

## License

MIT
