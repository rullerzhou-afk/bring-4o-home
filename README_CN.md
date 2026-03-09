# Memoria.chat

[English](./README.md) | [中文](./README_CN.md)

**换过 AI 模型吗？换完它就不认识你了。**

你的名字、你的习惯、你们之间的默契——全没了。每换一个模型都要从头来过。导出 ChatGPT 聊天记录？新平台用不了。精心调好的人格？模型一更新就走样。

Memoria 是一个自部署的 AI 聊天客户端，核心是**持久化的结构化记忆**。无论你切换模型、更换平台还是开新对话，你的 AI 都记得你是谁——而且越聊越懂你。

## 为什么选 Memoria？

大多数 AI 聊天客户端只是帮你调模型。Memoria 让你和 AI **建立关系**。

| 功能 | Memoria | LobeChat | ChatBox | NextChat |
|------|:-------:|:--------:|:-------:|:--------:|
| 跨模型持久记忆 | **有** | 无 | 无 | 无 |
| 对话自动学习 | **有** | 无 | 无 | 无 |
| 结构化记忆（身份 / 偏好 / 动态） | **有** | 无 | 无 | 无 |
| 记忆重要性评分 + 智能注入 | **有** | 无 | 无 | 无 |
| 人格版本管理 + 回滚 | **有** | 面具 | 无 | 面具 |
| ChatGPT 数据导入 + 记忆融合 | **有** | 无 | 无 | 无 |
| 多渠道（OpenAI / 火山引擎 / OpenRouter） | **有** | 有 | 有 | 有 |
| 语音对话模式 | **有** | 无 | 无 | 无 |
| 文件阅读（PDF / Word / TXT） | **有** | 插件 | 无 | 无 |
| 联网搜索 | **有** | 插件 | 无 | 插件 |
| 自部署，无需数据库 | **有** | 需要 DB | 桌面端 | 有 |
| 零构建步骤 | **有** | 需要构建 | N/A | 需要构建 |

## 快速开始

**前置条件：** [Node.js](https://nodejs.org/) v18+ 和 [Git](https://git-scm.com/downloads)

```bash
git clone https://github.com/rullerzhou-afk/memoria-chat.git
cd memoria-chat
npm install
cp .env.example .env   # 编辑 .env，填入至少一个渠道的 API Key
npm start              # 访问 http://127.0.0.1:3000
```

**后续更新：** `git pull && npm install && npm start`

### Docker 部署

```bash
git clone https://github.com/rullerzhou-afk/memoria-chat.git
cd memoria-chat
cp .env.example .env    # 填入 API Key + ADMIN_TOKEN（Docker 部署必填）
docker compose up -d    # 访问 http://localhost:3000
```

```bash
docker compose logs -f                                  # 查看日志
docker compose down && docker compose up -d             # 修改 .env 后重建
git pull && docker compose up -d --build                # 更新版本
```

数据持久化在宿主机 `data/` 和 `prompts/`，删除容器不丢数据。

## 记忆系统

Memoria 的记忆分三层，通过对话自动维护：

| 层级 | 存储内容 | 示例 |
|------|---------|------|
| **身份（Identity）** | 很少变化的核心事实 | "在新加坡做软件工程师" |
| **偏好（Preferences）** | 习惯、品味、工作方式 | "喜欢简洁的回答，最好带代码示例" |
| **动态（Events）** | 近期活动、当前项目 | "这周在准备面试" |

**自动学习：** 每次对话后，Memoria 自动提取关键信息——新信息被添加，过时的被更新，矛盾的被替换。

**智能注入：** 不是每次都把所有记忆塞给模型。Memoria 按重要性和时效性给每条记忆打分，在 token 预算内择优注入。身份类必带，其余按相关性竞争。

**反思整合：** 手动触发洞察提炼——Memoria 分析你的近期动态，从中归纳出更高层的偏好和身份特征。

**生命周期：** 记忆可以晋升（动态 → 偏好 → 身份）、降级或衰减。不活跃的记忆会被标记为过期，低重要性的闲置记忆会被自动清理。

## 功能特性

### 人格工程
- 完全自定义的 system prompt，内置精调模板
- 自动版本快照——查看历史、一键回滚
- 自定义 AI 名称和你的称呼
- 优先级规则：用户指令 > 人格设定 > 记忆

### 对话能力
- **三渠道一个界面** — OpenAI、火山引擎、OpenRouter，根据模型 ID 自动路由
- **SSE 流式回复** — 实时显示生成内容
- **联网搜索** — 通过 Serper.dev，AI 自动判断是否需要搜索
- **思考链展示** — 推理模型的思考过程可折叠查看
- **图片理解** — 支持 vision 模型
- **文件阅读** — 拖入 PDF、Word、TXT、Markdown、CSV 或 JSON

### 语音对话
- **完整语音对话模式** — 点击麦克风说话，AI 语音回复，像打电话一样自然
- **灵活语音识别** — 浏览器内置（免费）、OpenAI Whisper API、Groq Whisper（免费极快）、本地 Whisper（`pip install faster-whisper`）
- **灵活语音合成** — Edge TTS（免费，10+ 音色）、OpenAI TTS API、或任意 OpenAI 兼容 TTS 服务
- **语音自动记忆** — 语音对话中的信息也会被自动学习，和文字聊天一致
- **对话同步** — 语音对话自动同步到主页，完整消息记录
- **实时音频球体** — 听说过程中的动态音频可视化

### 数据管理
- **ChatGPT 导入** — 拖入完整导出文件夹，对话、图片、记忆一起恢复和融合
- **对话持久化** — 服务端 JSON 存储，不丢数据
- **全文搜索** — 跨所有对话搜索
- **消息编辑与重新生成** — 编辑已发送消息或重新生成 AI 回复

### 其他
- 移动端响应式布局
- 亮色 / 暗色 / 跟随系统 三档主题
- 每条回复显示 token 数、模型名、响应时间
- 可调节上下文条数（4–500 条）

## API Key 获取

三个渠道至少配置一个，下拉框只会显示已配置渠道的模型：

| 渠道 | 获取地址 | 说明 |
|------|----------|------|
| **OpenRouter**（推荐新手） | [openrouter.ai/keys](https://openrouter.ai/keys) | 一个 key 用 GPT-4o、Claude、Gemini 等几百个模型 |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | GPT-4o / GPT-4.1 / o3 系列 |
| **火山引擎** | [console.volcengine.com](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) | GLM / Kimi 系列，国内直连 |
| **Serper**（搜索） | [serper.dev](https://serper.dev) | 免费 2500 次 Google 搜索，配置后自动启用 |

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 三选一 | OpenAI API 密钥 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容网关地址（默认官方） |
| `ARK_API_KEY` | 三选一 | 火山引擎方舟平台 API key |
| `ARK_BASE_URL` | 否 | 火山方舟 API 地址 |
| `OPENROUTER_API_KEY` | 三选一 | OpenRouter API key |
| `OPENROUTER_BASE_URL` | 否 | OpenRouter API 地址 |
| `OPENROUTER_SITE_URL` | 否 | OpenRouter 请求头 `HTTP-Referer` |
| `OPENROUTER_APP_NAME` | 否 | OpenRouter 请求头 `X-Title` |
| `ADMIN_TOKEN` | 视情况 | 鉴权 token；非 localhost 访问时**必须设置** |
| `SERPER_API_KEY` | 否 | Serper.dev 搜索 API key |
| `HOST` / `PORT` | 否 | 监听地址，默认 `127.0.0.1:3000` |
| `MODEL` | 否 | 默认模型，fallback `gpt-4o` |
| `AUTO_LEARN_MODEL` | 否 | 自动记忆提取模型，留空自动选择 |
| `AUTO_LEARN_COOLDOWN` | 否 | 自动记忆冷却秒数，默认 `300` |
| `TTS_BASE_URL` | 否 | 自定义 TTS 服务地址（如 Kokoro-FastAPI），OpenAI 兼容 |
| `TTS_API_KEY` | 否 | 自定义 TTS 服务的 API key |
| `STT_BASE_URL` | 否 | 自定义 STT 服务地址（推荐 [Groq](https://console.groq.com/) `https://api.groq.com/openai/v1`，免费极快），OpenAI 兼容 |
| `STT_API_KEY` | 否 | 自定义 STT 服务的 API key |
| `STT_MODEL` | 否 | STT 模型名（如 Groq 用 `whisper-large-v3`） |
| `WHISPER_MODEL` | 否 | 本地 Python STT 的 Whisper 模型大小，默认 `base` |
| `PYTHON_PATH` | 否 | Python 可执行文件路径，默认 `python` / `python3` |

## 远程访问

默认只监听 localhost。需要远程访问时，在 `.env` 中设置 `HOST=0.0.0.0` 和 `ADMIN_TOKEN`。推荐通过 [Tailscale](https://tailscale.com/)、[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 或 ngrok 暴露端口。

## 配置文件

通过网页设置面板或直接编辑文件，修改后无需重启：

| 文件 | 用途 |
|------|------|
| `prompts/system.md` | 人格指令（AI 的性格、语气、规则） |
| `prompts/memory.md` | 用户记忆（auto-learn 自动维护） |
| `prompts/config.json` | 模型参数（model、temperature 等） |

## 联网搜索

配置 `SERPER_API_KEY` 后自动启用。搜索依赖 function calling，部分模型不支持：

| 模型 | 搜索 | 说明 |
|------|:----:|------|
| GPT-4o / GPT-4.1 / o3 | ✅ | 原生 function calling |
| OpenRouter 多数模型 | ✅ | Claude / Gemini 等 |
| DeepSeek R1 等推理模型 | ❌ | 不支持 function calling |
| GLM / Kimi | ❌ | 不返回结构化工具调用 |

## 技术栈

- **后端**: Node.js + Express + OpenAI SDK v4
- **前端**: 纯 HTML/CSS/JS（无框架），marked.js + DOMPurify (CDN)
- **存储**: 文件系统（JSON）

无构建步骤、无数据库、无框架依赖，一个 `npm start` 就跑起来。

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — 可自由下载、学习、修改、分享，但不可商用。
