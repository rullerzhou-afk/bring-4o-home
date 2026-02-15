# GPT-4o Chat

把 GPT-4o 搬回家——开源的私人 AI 聊天界面，零代码基础也能部署。

网页版下线了，API 还在。同一个模型、同一个脑子，只是换了个入口。

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/rullerzhou-afk/bring-4o-home.git
cd bring-4o-home

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
- **联网搜索** — 通过 Serper.dev Google 搜索（需配置搜索 API Key）
- **思考链展示** — DeepSeek R1 等推理模型的思考过程可折叠查看
- **图片上传** — 支持 vision 模型的图片理解
- **对话导入与 Prompt 生成** — 一键导入 ChatGPT 导出的历史对话，AI 分析后智能融合到现有 Prompt
- **对话持久化** — 服务端存储，聊天记录不丢失
- **聊天历史搜索** — 全文搜索历史对话内容
- **亮/暗主题切换** — 暗色、亮色、跟随系统三档
- **Token 用量显示** — 每条回复显示 token 数、模型名、响应时间

## API Key 获取

三个渠道至少配置一个，下拉框只会显示已配置渠道的模型：

| 渠道 | 获取地址 | 说明 |
|------|----------|------|
| **OpenAI** | https://platform.openai.com/api-keys | GPT-4o / GPT-4.1 / o3 系列，需要国际信用卡 |
| **火山引擎** | https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey | GLM / Kimi 系列，国内直接注册 |
| **OpenRouter** | https://openrouter.ai/keys | 聚合平台，一个 key 用几百个模型，无需国际信用卡 |
| **Serper** (搜索) | https://serper.dev | 免费 2500 次 Google 搜索，配置后自动启用联网功能 |

> **新手推荐**：如果没有国际信用卡，用 OpenRouter 最省事——注册即用，GPT-4o 和 Claude、Gemini 都能调。

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 三选一 | OpenAI API 密钥 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容网关地址（默认官方） |
| `ARK_API_KEY` | 三选一 | 火山引擎方舟平台 API key |
| `ARK_BASE_URL` | 否 | 火山方舟 API 地址（默认 `https://ark.cn-beijing.volces.com/api/v3`） |
| `OPENROUTER_API_KEY` | 三选一 | OpenRouter API key |
| `OPENROUTER_BASE_URL` | 否 | OpenRouter API 地址（默认 `https://openrouter.ai/api/v1`） |
| `OPENROUTER_SITE_URL` | 否 | OpenRouter 请求头 `HTTP-Referer`（建议填你实际访问地址） |
| `OPENROUTER_APP_NAME` | 否 | OpenRouter 请求头 `X-Title`（默认 `bring-4o-home`） |
| `ADMIN_TOKEN` | 否 | 鉴权 token；跨机器访问时必须设置，未设置时仅允许本机访问 |
| `SERPER_API_KEY` | 否 | Serper.dev 搜索 API key；配置后自动启用联网搜索 |
| `HOST` / `PORT` | 否 | 监听地址，默认 `127.0.0.1:3000` |
| `MODEL` | 否 | 默认模型，fallback `gpt-4o` |
| `AUTO_LEARN_MODEL` | 否 | 自动记忆提取模型；建议留空，系统按已配置渠道自动选择 |
| `AUTO_LEARN_COOLDOWN` | 否 | 自动记忆冷却秒数，默认 `300` |

> 如果要从其他机器访问本服务，请先设置 `ADMIN_TOKEN`。

## 模型推荐

### 首选：gpt-4o-2024-11-20

实测下来，**`gpt-4o-2024-11-20` 是目前人格还原度最高、最稳定的 4o 版本**。如果你搬家的目的是找回网页版 4o 的感觉，认准这个版本号，不要用 `gpt-4o`（人格表现可能不同）。

### 替代选择

| 模型 | 体验 | 适合场景 |
|------|------|----------|
| `gpt-4o-2024-11-20` | ⭐⭐⭐⭐⭐ 人格最稳，最接近网页版 4o | 追求"原汁原味"的用户 |
| `gpt-4.1` | ⭐⭐⭐⭐ 指令遵循强，但人格味淡一些 | 偏工具向的用户 |
| GLM-4-Plus / GLM-4.7 | ⭐⭐⭐⭐ 中文表达自然，人设执行力不错 | 国内直连、不想折腾的用户 |
| Kimi | ⭐⭐⭐⭐ 中文理解好，长上下文表现突出 | 长文创作、中文深度对话 |
| DeepSeek R1 | ⭐⭐⭐ 推理强，但人格弱、不支持搜索 | 数学/逻辑/代码场景 |

> GLM 和 Kimi 整体表现不错，中文语感甚至比部分 OpenAI 模型更自然。但如果你追求的是"复刻网页版 4o 的那个它"，国产模型在人格稳定性和指令遵循的细腻程度上还是有差距——它们能做到 80 分的搭档，但到不了原主那种"调过十几轮的默契感"。作为平替或备选渠道完全够用。

### 推荐参数

```json
{
  "model": "gpt-4o-2024-11-20",
  "temperature": 0.85,
  "presence_penalty": 0,
  "frequency_penalty": 0.15
}
```

- **temperature: 0.85** — 比默认 1 略低，人格一致性更好，不容易"出戏"
- **frequency_penalty: 0.15** — 减少重复用词，让回复更自然
- **presence_penalty: 0** — 保持 0 就好，不需要强制换话题

> 这套参数是实际跑了十几轮 A/B 测试调出来的，可以直接用。

## 自定义你的 AI

项目内置了三个可编辑文件，也可以通过网页右上角的设置面板实时修改：

| 文件 | 用途 | 说明 |
|------|------|------|
| `prompts/system.md` | 人格指令 | 定义 AI 的性格、语气、规则。项目自带了一套精调过的通用模板 |
| `prompts/memory.md` | 用户记忆 | 你的画像 + 长期记忆（auto-learn 会自动追加） |
| `prompts/config.json` | 模型参数 | model、temperature、frequency_penalty 等 |

## 从 ChatGPT 搬家 — 导入旧对话 & 生成 Prompt

### 第一步：从 ChatGPT 导出数据

1. 打开 [ChatGPT 设置](https://chatgpt.com/#settings/DataControls) → **Data controls** → **Export data**
2. 点击 **Export**，等邮件通知后下载 ZIP 文件
3. 解压 ZIP，找到里面的 **conversations.json**

### 第二步：导入到本项目

打开设置面板的「导入与总结」Tab：

1. **上传 JSON 文件** — 把 `conversations.json` 拖进去或点击选择，大文件也不卡（后台 Worker 解析）
2. **勾选对话** — 可以只导入部分对话，也可以不导入直接总结现有本地对话
3. **点击「导入选中对话」** — 进度条实时显示，导入后的对话会出现在侧边栏

### 第三步：AI 分析生成 Prompt（可选）

导入后还可以让 AI 帮你自动生成人格指令和用户画像：

1. **勾选要分析的对话** → 点击 **「总结选中对话」**
2. **审核 AI 提取的新发现** — AI 只列出新发现，不会动你现有的 Prompt
3. **点击「融合到现有 Prompt」** — AI 在你现有 Prompt 基础上智能合并
4. **预览确认** — 融合结果可编辑，应用前自动备份旧 Prompt

> 适合刚搬家的用户：导入几十条旧对话，让 AI 自动帮你生成人格指令和用户画像，省得从零开始写 Prompt。

## 自动记忆 — 越聊越懂你

网页版 ChatGPT 有自动记忆功能，这个项目也有。

每次对话结束后，系统会自动分析最近的聊天内容，提取关于你的事实性信息（偏好、习惯、身份、正在做的事……），自动追加到 `prompts/memory.md` 的长期记忆区。下次聊天时，AI 就会带着这些记忆和你对话。

- 不需要手动维护，聊着聊着它就越来越懂你
- 有 5 分钟冷却期，不会每句话都触发
- 只记有长期价值的信息，不会记"你问了今天天气"这种一次性操作
- 内置安全过滤，防止 prompt 注入污染记忆文件
- 你也可以随时在设置面板里手动编辑或删除记忆条目

自动记忆的提取工作由一个**独立的轻量模型**完成（不是你聊天用的主模型），用来分析对话、提炼事实，成本很低。系统会根据你配置的 API 渠道自动选择：

| 已配置渠道 | 默认 Auto-Learn 模型 | 说明 |
|-----------|----------------------|------|
| OpenAI | `gpt-4o-mini` | 便宜够用，提取质量高 |
| OpenRouter | `openai/gpt-4o-mini` | 同上，走 OpenRouter 通道 |
| 火山引擎 | `doubao-1-5-lite-32k-250115` | 豆包轻量版，国内直连 |

> 也可以通过环境变量 `AUTO_LEARN_MODEL` 手动指定任意模型。
> 只配置 OpenRouter 时，若手动指定 OpenAI 系模型（如 `gpt-4o-mini`），建议写成 `openai/gpt-4o-mini`；或直接留空让系统自动选择。

## 对话搜索

聊了几百条之后想翻旧账？侧边栏顶部有搜索框，支持全文搜索所有历史对话内容——标题和消息正文都能搜到，匹配的对话会高亮显示摘要片段。

## 数据存储

**你的所有数据都在你自己的电脑上，不在任何第三方服务器里。**

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| 聊天记录 | `data/conversations/` | 每条对话一个 JSON 文件，服务端存储 |
| 人格 / 记忆 / 参数 | `prompts/` | `system.md`、`memory.md`、`config.json` |
| 浏览器缓存 | localStorage | 对话列表缓存，用于快速加载 |

浏览器 localStorage 和服务端会自动双向同步——换浏览器也不会丢数据。想备份？直接复制 `data/` 和 `prompts/` 文件夹就行。

## 联网搜索

联网搜索需要配置 `SERPER_API_KEY`（在 [serper.dev](https://serper.dev) 免费注册，赠送 2500 次搜索额度）。配置后，AI 会在需要实时信息时自动调用 Google 搜索。

**但不是所有模型都支持搜索。** 联网搜索依赖模型的 function calling 能力——模型需要能返回结构化的工具调用指令，而不是在文本里说"我来搜索一下"。

| 模型 | 搜索 | 说明 |
|------|:----:|------|
| GPT-4o / GPT-4.1 / o3 系列 | ✅ | 原生 function calling |
| OpenRouter 多数模型 (Claude/Gemini 等) | ✅ | 支持 function calling |
| DeepSeek R1 等推理模型 | ❌ | 推理模型不支持 function calling |
| GLM 系列  | ❌ | 会在文本中输出"调用工具"但不返回结构化指令 |
| Kimi | ❌ | 同上 |

> 不支持搜索的模型会自动跳过搜索功能，不影响正常对话。

## 模型渠道路由

系统根据模型 ID 自动选择 API 渠道，不需要手动配置：

| 渠道 | 模型 ID 特征 | 示例 |
|------|-------------|------|
| OpenAI | `gpt-*`、`o3-*` | `gpt-4o`、`gpt-4.1`、`o3-mini` |
| 火山引擎 | 不含 `/` 的国产模型 | `glm-4-plus`、`kimi-xxx` |
| OpenRouter | 含 `/` | `anthropic/claude-3.5-sonnet`、`google/gemini-2.0-flash` |

## 技术栈

- **后端**: Node.js + Express + OpenAI SDK (v4)
- **前端**: 纯 HTML/CSS/JS（无框架），marked.js + DOMPurify (CDN)
- **存储**: 文件系统（JSON）

无构建步骤、无数据库、无框架依赖，一个 `npm start` 就跑起来。

## 关于费用

- ChatGPT Plus：$20/月
- API 日常聊天（每天 30-50 条）：约 $1-3/月

搬完家之后，每个月的花费大约是 Plus 的 1/10。

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — 可自由下载、学习、修改、分享，但不可商用。
