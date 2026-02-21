# GPT-4o Chat

把 GPT-4o 搬回家——开源的私人 AI 聊天界面，零代码基础也能部署。

网页版下线了，API 还在。同一个模型、同一个脑子，只是换了个入口。

## 快速开始

**前置条件：** 安装 [Node.js](https://nodejs.org/)（推荐 v20）和 [Git](https://git-scm.com/downloads)。

```bash
# 1. 克隆项目
git clone https://github.com/rullerzhou-afk/bring-4o-home.git
cd bring-4o-home

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
```

用文本编辑器打开 `.env`，填入你的 API Key（三个渠道选一个填就行）：

- **Windows**: `notepad .env`
- **Mac / Linux**: `nano .env`

> 本机使用不需要设置 `ADMIN_TOKEN`。如果要从手机、其他电脑访问或使用 Docker 部署，参考下方「手机 / 远程访问」或「Docker 部署」章节。

```bash
# 4. 启动
npm start
# 打开浏览器访问 http://127.0.0.1:3000
```

**后续更新：**

```bash
git pull && npm install && npm start
```

## 功能特性

- **三渠道多模型** — OpenAI (GPT-4o/4.1/o3) + 火山引擎 (GLM/Kimi) + OpenRouter (Claude/Gemini/Llama 等)
- **SSE 流式回复** — 实时显示生成内容，打字机效果
- **自定义人格** — 通过 system prompt 定义 AI 的性格、语气、技能
- **自动记忆** — 对话后自动提取用户信息存入长期记忆
- **联网搜索** — 通过 Serper.dev Google 搜索（需配置搜索 API Key）
- **思考链展示** — DeepSeek R1 等推理模型的思考过程可折叠查看
- **图片上传** — 支持 vision 模型的图片理解
- **对话导入与 Prompt 生成** — 导入 ChatGPT 导出的完整文件夹，历史图片也能恢复；AI 分析后智能融合到现有 Prompt
- **批量管理对话** — 侧边栏「管理」模式，支持全选/多选批量删除
- **时间分组侧边栏** — 对话按时间倒序排列，自动按月份/季度/年份分组显示
- **上下文条数控制** — 可调节每次发送的历史消息条数（4-500），平衡上下文记忆与 token 消耗
- **个性化设置** — 自定义 AI 名称和你的称呼，输入框和欢迎语自动变为个性化内容
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
| `ADMIN_TOKEN` | 视情况 | 鉴权 token；Docker 部署或从其他设备访问时**必须设置**，仅本机 `npm start` 可不填 |
| `SERPER_API_KEY` | 否 | Serper.dev 搜索 API key；配置后自动启用联网搜索 |
| `HOST` / `PORT` | 否 | 监听地址，默认 `127.0.0.1:3000` |
| `MODEL` | 否 | 默认模型，fallback `gpt-4o` |
| `AUTO_LEARN_MODEL` | 否 | 自动记忆提取模型；建议留空，系统按已配置渠道自动选择 |
| `AUTO_LEARN_COOLDOWN` | 否 | 自动记忆冷却秒数，默认 `300` |

> 只要不是在本机 `npm start` + `localhost` 的场景，就必须设置 `ADMIN_TOKEN`。包括：Docker 部署、手机访问、其他电脑访问。

## 手机 / 远程访问

默认只能在本机（localhost）访问。想用手机或其他电脑访问，有三种方案，按难度从低到高排列。

### 方案一：Tailscale 组网（最简单，推荐）

[Tailscale](https://tailscale.com/) 是一个免费的虚拟局域网工具，不需要公网 IP、不需要域名、不需要买服务器。原理是在你的设备之间建一条加密隧道，让它们像在同一个局域网一样互相访问。

**步骤：**

1. 在 [tailscale.com](https://tailscale.com/) 注册账号（支持 Google / GitHub 登录）
2. 在你跑项目的电脑上安装 Tailscale 客户端，登录
3. 在手机上也安装 Tailscale App（iOS / Android 都有），用同一个账号登录
4. 修改项目的 `.env` 文件，添加两行：
   ```
   HOST=0.0.0.0
   ADMIN_TOKEN=随便写一个你自己的密码
   ```
5. 重启项目 `npm start`
6. 在电脑的 Tailscale 客户端里找到你的 Tailscale IP（类似 `100.x.x.x`）
7. 手机浏览器打开 `http://100.x.x.x:3000`，输入你设置的 ADMIN_TOKEN 即可

**优点：** 零配置、流量加密、免费、5 分钟搞定

**缺点：** 手机需要一直挂着 Tailscale（后台运行即可，不费电）

### 方案二：内网穿透（不想买服务器）

如果你的电脑在家里的内网（没有公网 IP），可以用内网穿透工具把本地端口暴露到公网。

#### 选项 A：Cloudflare Tunnel（免费，推荐）

1. 注册 [Cloudflare](https://dash.cloudflare.com/) 账号（免费）
2. 安装 `cloudflared` 命令行工具：
   - Windows: `winget install cloudflare.cloudflared`
   - Mac: `brew install cloudflared`
   - Linux: 参考 [官方文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
3. 修改 `.env`：
   ```
   HOST=0.0.0.0
   ADMIN_TOKEN=你的密码
   ```
4. 启动项目 `npm start`
5. 开一个新终端，运行：
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
6. 终端里会显示一个 `https://xxx-xxx-xxx.trycloudflare.com` 的地址
7. 手机浏览器打开这个地址就能用了

> 每次运行 `cloudflared` 会生成一个随机域名。如果你想固定域名，需要把自己的域名托管到 Cloudflare 并创建持久隧道，具体参考 Cloudflare 官方文档。

#### 选项 B：ngrok

1. 注册 [ngrok](https://ngrok.com/)（免费版够用）
2. 安装 ngrok 并配置 authtoken
3. 修改 `.env` 同上
4. 启动项目后运行 `ngrok http 3000`
5. 用 ngrok 给的 HTTPS 地址访问

### 方案三：部署到云服务器（VPS）

如果你想随时随地访问、不依赖家里的电脑，可以把项目部署到云服务器上。

**购买服务器：**

| 平台 | 最低配置 | 参考价格 |
|------|----------|----------|
| [腾讯云轻量应用服务器](https://cloud.tencent.com/product/lighthouse) | 2核2G | ~¥50/月 |
| [阿里云轻量应用服务器](https://www.aliyun.com/product/swas) | 2核2G | ~¥50/月 |
| [Vultr](https://www.vultr.com/) / [DigitalOcean](https://www.digitalocean.com/) | 1核1G | ~$5/月 |

> 这个项目很轻，1核1G 就够跑了。

**部署步骤（以 Ubuntu 为例）：**

```bash
# 1. 在服务器上安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. 克隆项目
git clone https://github.com/rullerzhou-afk/bring-4o-home.git
cd bring-4o-home
npm install

# 3. 配置环境变量
cp .env.example .env
nano .env
# 必须设置：
#   OPENAI_API_KEY=你的key（或其他渠道的 key）
#   HOST=0.0.0.0
#   ADMIN_TOKEN=一个强密码（重要！！！）

# 4. 用 pm2 保持后台运行（服务器关掉终端也不会停）
sudo npm install -g pm2
pm2 start server.js --name gpt-chat
pm2 save
pm2 startup    # 开机自启
```

**配置 HTTPS（强烈推荐）：**

裸 HTTP 在公网上传输密码和聊天内容很不安全。推荐用 Caddy 自动配置 HTTPS：

```bash
# 安装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# 配置反向代理（把 your-domain.com 换成你的域名）
echo 'your-domain.com {
    reverse_proxy localhost:3000
}' | sudo tee /etc/caddy/Caddyfile

# 重启 Caddy（会自动申请 HTTPS 证书）
sudo systemctl restart caddy
```

然后手机浏览器访问 `https://your-domain.com` 就行了。

> 没有域名也能用 IP 直接访问（`http://服务器IP:3000`），但没有 HTTPS 加密，不推荐在公网长期使用。

### 手机浏览器小技巧

手机访问后，可以把网页"添加到主屏幕"，这样打开就像一个独立 App：

- **iOS Safari**：点底部分享按钮 → 「添加到主屏幕」
- **Android Chrome**：点右上角菜单 → 「添加到主屏幕」或「安装应用」

### 安全提醒

> **只要不是在本机 localhost 访问，就必须设置 `ADMIN_TOKEN`。** 不设的话，任何人都能用你的 API Key 聊天、读你的聊天记录、改你的 Prompt。这不是开玩笑——你的 API Key 每一次调用都在花钱。

## Docker 部署

如果你不想在电脑上直接装 Node.js，或者想部署到服务器上更方便管理，可以用 Docker。

### 前置条件

安装 Docker Desktop（[下载地址](https://www.docker.com/products/docker-desktop/)）。Windows / Mac / Linux 都支持。

安装后打开 Docker Desktop，确认左下角显示绿色「Running」。

### 一键启动

```bash
# 1. 克隆项目
git clone https://github.com/rullerzhou-afk/bring-4o-home.git
cd bring-4o-home

# 2. 配置环境变量
cp .env.example .env
```

然后用文本编辑器打开 `.env` 文件，填入你的 API Key 和 ADMIN_TOKEN：

- **Windows**: `notepad .env`
- **Mac / Linux**: `nano .env`

> **Docker 部署必须设置 `ADMIN_TOKEN`**，不设的话打开页面会提示"服务器拒绝访问"。原因见下方注意事项。

填好保存后，启动容器：

```bash
# 3. 启动（首次会自动构建镜像，需要几分钟）
docker compose up -d
```

然后打开浏览器访问 `http://localhost:3000`，搞定。

> **`-d`** 表示后台运行。不加 `-d` 可以看到实时日志，按 Ctrl+C 停止。

### 常用命令

```bash
# 查看运行状态
docker compose ps

# 查看日志（实时跟踪）
docker compose logs -f

# 停止
docker compose down

# 更新到最新版本
git pull
docker compose up -d --build
```

**修改 `.env` 后怎么生效？**

`docker compose restart` **不会**重新读取 `.env`——它只是重启已有容器，环境变量还是旧的。正确做法是销毁旧容器再重建：

```bash
docker compose down
docker compose up -d
```

> 放心，你的聊天记录和 Prompt 在宿主机的 `data/` 和 `prompts/` 文件夹里，销毁容器不会丢数据。

### 数据说明

你的聊天记录和 Prompt 存在宿主机的 `data/` 和 `prompts/` 文件夹里，不在容器内部。这意味着：

- 停止/删除/重建容器都**不会丢失数据**
- 可以直接在宿主机编辑 `prompts/system.md` 等文件
- 备份只需要复制这两个文件夹

### 注意事项

- **`ADMIN_TOKEN` 在 Docker 部署中是必须的**。即使你在本机用 `localhost` 访问，请求经过 Docker 网络转发后，容器内看到的来源 IP 不是 `127.0.0.1`，所以不设 token 会被拒绝访问。如果忘了设置，编辑 `.env` 加上 `ADMIN_TOKEN` 后，运行 `docker compose down` 再 `docker compose up -d` 即可
- **从手机或其他电脑访问也必须设置 `ADMIN_TOKEN`**，不管是不是 Docker 部署。具体方案参考上方「手机 / 远程访问」章节
- `.env` 文件必须在项目根目录，Docker 启动时会自动读取
- 容器内会自动设置 `HOST=0.0.0.0`，你不需要在 `.env` 里手动写
- 想换端口？在 `.env` 里加 `PORT=8080`，然后 `docker compose down` + `docker compose up -d`

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

### 关于上下文条数

每次发送消息时，系统只会携带最近 N 条历史消息作为上下文（默认 50 条）。**如果你的对话超过 50 轮，AI 会"忘记"更早的内容**——这不是 bug，是为了控制 token 消耗。

在设置面板的「上下文条数」滑块可以调整这个值（范围 4-500）：

| 场景 | 建议条数 | 单次请求 token 参考 |
|------|----------|-------------------|
| 短对话、问答 | 10-20 | ~2,000-5,000 |
| 日常闲聊 | 50（默认） | ~10,000-40,000 |
| 长篇连续创作/角色扮演 | 100-200 | 轻松破 50,000+ |
| 需要记住完整对话 | 拉满 | 费用爆炸，慎用 |

> **注意**：50 条日常聊天就可能跑到 40,000 tokens——别觉得 50 条很少，token 涨得比你想象中快。调高上下文条数前，先看看你的钱包准备好了没。

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

1. **上传文件** — 支持两种方式：
   - **拖入整个导出文件夹**（推荐）— 对话和图片一起导入，DALL-E 生成的图、你发的截图都能恢复
   - **只上传 `conversations.json`** — 纯文本导入，图片位置会显示占位提示
2. **勾选对话** — 可以只导入部分对话，也可以不导入直接总结现有本地对话
3. **点击「导入选中对话」** — 进度条实时显示，导入后的对话按时间分组出现在侧边栏

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
