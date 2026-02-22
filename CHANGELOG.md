# Changelog

## 2026-02-22

### New Features
- **消息悬浮工具栏** — 鼠标悬停消息时显示时间戳、复制、编辑（用户消息）或重新生成（AI 消息）按钮，替代原有的复制按钮
- **编辑用户消息** — 点击编辑按钮进入 textarea 编辑模式，提交后截断后续消息并重新生成 AI 回复
- **重新生成 AI 回复** — 点击重新生成按钮删除当前 AI 回复并重新请求，复用 `streamAssistantReply` 共享流式逻辑
- **发送后智能滚动** — 发送消息后用户消息自动滚到视口顶部，AI 回复在下方逐步展开；scroll-spacer 占位符随回复增长动态缩小，回复足够长时自然过渡到跟随底部滚动
- **移动端响应式适配** — 小屏（≤768px）侧边栏变为固定覆盖层 + 半透明遮罩，选择对话后自动收起；设置弹窗全屏显示；使用 `100dvh` 适配 iOS 地址栏

### Code Quality (Batch 7 — Performance, Security & Compatibility)
- **搜索端点性能加固** — 对话全文搜索从串行逐个读取改为 10 路并发分块处理，新增结果上限 50 条和 5 秒超时截止，防止对话量大时搜索卡死或被 DoS
- **模型列表 TTL 缓存** — `GET /models` 结果在内存中缓存 3 分钟，重复请求直接返回，避免慢网或限流时拖慢设置页
- **图片上传安全加固** — multer `fileFilter` 从静默跳过改为主动拒绝（明确错误提示）；上传后校验 PNG/JPEG/GIF/WebP magic bytes 文件头，伪造扩展名的非图片文件不再通过
- **流式缓冲残余修复** — SSE 流结束后 flush TextDecoder 并处理 buffer 中剩余的完整行，极端情况下最后一段文字不再丢失
- **DOMPurify 配置加固** — Markdown 渲染的 HTML 清理从默认配置改为显式白名单（`ALLOWED_TAGS` / `ALLOWED_ATTR`），关闭 `data-*` 属性，缩小 XSS 攻击面
- **Firefox 文件夹拖拽兼容** — `webkitGetAsEntry` 加 `getAsEntry()` 标准 API fallback，Firefox 用户拖入文件夹不再无响应
- **超时错误友好提示** — 对话总结和 Prompt 融合接口的 `AbortError` 从通用 500 改为 504 + "请求超时，请稍后重试"

### Code Quality (Batch 6 — Cleanup & Performance)
- **备份逻辑统一** — 两个路由的重复备份代码提取为 `backupPrompts()` 公共函数，内部使用 `atomicWrite` 和异步 `mkdir`，消除同步 I/O 阻塞
- **模型名过滤** — `validateConfigPatch` 对 model 字段增加字符白名单校验，含换行符等特殊字符的模型名不再通过验证，防止日志注入
- **context_window 整数化** — `normalizeConfig` 对 `context_window` 加 `Math.round()`，`10.5` 这样的浮点值不再被原样保存
- **JSON 提取智能回退** — 总结/融合接口的 LLM 输出解析从贪婪正则改为 `extractJsonFromLLM()` 渐进式回退（code block → 从最后一个 `}` 向前尝试 `JSON.parse`），多 JSON 输出或夹杂文字时不再匹配错误内容
- **索引重建并行化** — `rebuildIndex` 从串行逐个 `await` 改为 `Promise.all` 并行读取，1000 个对话文件时重建速度大幅提升
- **模型列表扫描上限** — 三个 `models.list()` 循环加 `MAX_MODELS_SCAN=500` 上限 break，API 返回超大模型列表时不再无限迭代

### Code Quality (Batch 5 — Security & Robustness)
- **对话保存校验统一** — `validateConversation` 复用 `validateMessages` 统一校验逻辑，过滤多余字段、拒绝未知 content part type、限制 multi-part 数量，保存到磁盘的数据与发送给模型的一样干净
- **聊天超时改为空闲超时** — 固定 120 秒硬超时改为空闲超时，有 chunk 到达就自动续期，长回复持续产出不再被中途掐断
- **流式解析防护** — `chunk.choices` 加可选链保护，第三方 API 返回异常结构时不再抛 TypeError 中断流
- **Token 时序攻击防护** — ADMIN_TOKEN 比较从 `!==` 改为 `crypto.timingSafeEqual`，防止通过响应时间逐字节猜测
- **Auto-Learn 冷却原子化** — 冷却检查和时间戳设置合并为原子操作 `tryAcquireCooldown()`，并发请求不再同时通过冷却检查
- **403 不再泄露客户端 IP** — 非本地访问被拒时错误消息不再包含 `req.ip`，改为只记服务端日志
- **500 错误消息统一** — 所有路由的 `catch` 块不再将 `err.message` 直接返回给客户端，统一为 `"Internal server error"`，原始错误仅记录到服务端日志
- **Cookie 解析防崩溃** — `readCookieToken` 中 `decodeURIComponent` 加 try/catch，畸形 cookie 不再导致 500
- **Auto-Learn 角色标签修正** — system 消息从误标 "AI" 改为 "系统"，避免人格指令被误判为 AI 说的话

### Code Quality (Batch 4 — Critical Fixes)
- **导入图片上传修复** — 前端图片上传字段名与后端不匹配，导致 ChatGPT 导入时图片始终上传失败；修正后导入图片功能恢复正常
- **索引与记忆并发保护** — 新增 `createMutex()` 互斥锁，`_index.json` 和 `memory.md` 的读-改-写操作加锁串行化，防止并发请求导致数据丢失覆盖
- **全局错误处理中间件** — 未匹配的 `/api` 路由返回 JSON 404（而非 HTML）；全局 error handler 区分 JSON 解析失败、multer 错误和兜底 500，不再返回默认 Express 错误页

### Code Quality (Batch 3 — Lower Priority)
- **图片孤儿清理** — 删除对话时自动清理该对话引用的 `data/images/` 图片文件（单删、批量删除均覆盖），不再磁盘泄漏
- **多标签页同步** — 监听 `storage` 事件实现跨标签页对话列表同步，其他标签页删除/新建/重命名对话后当前标签页自动更新，保留已加载的消息内容
- **导入分支选择改进** — ChatGPT 导入时 `current_node` 缺失的回退策略从"时间最新的叶子"改为"消息链最长的叶子"，避免短分支的重新生成覆盖主对话

### Code Quality (Batch 2 — Medium Severity, Design Required)
- **会话列表索引** — `GET /conversations` 不再全量读取并解析每个对话 JSON 文件，改为维护 `_index.json` 轻量索引；CRUD 操作自动联动更新索引；首次请求自动从文件重建索引
- **启动同步并发化** — 本地独有对话上传从串行逐个 `await` 改为 3 并发 worker 队列，对话多时冷启动同步提速约 3 倍
- **Auto-Learn 移除内容审查** — 删除 `MEMORY_BLOCKLIST` 和 `INSTRUCTION_PATTERN` 内容过滤。开源项目不做用户内容管控，仅保留单条长度限制（≤80 字）和 memory 总量限制（≤50KB）防止膨胀

### Code Quality (Batch 1 — Medium Severity)
- **文件写入原子化** — 新增 `atomicWrite` 工具函数（写临时文件 → fsync → rename），对话保存、配置保存、记忆追加、Prompt 写入等 5 处替换，异常中断不再损坏原文件
- **modelSelector 全量覆盖修复** — 顶栏切换模型从「GET 全量 + PUT 全量」改为只 PUT `{ model }`，不再覆盖其他地方正在修改的参数
- **总结接口 JSON 回退正则修正** — 回退匹配从过时的 `suggestedSystem` 键名改为通用 `{...}` 对象提取
- **backups 自动清理** — 新增 `pruneBackups`，备份目录自动保留最近 20 份，超出自动删除
- **localStorage 溢出渐进降级** — `QuotaExceededError` 时逐级尝试 75%→50%→25%→20→10 条缓存，并弹 toast 提示用户

### Security & Robustness
- **`/images` 目录鉴权** — 图片静态目录纳入 `authMiddleware` 保护，配置了 ADMIN_TOKEN 的部署不再允许未认证访问；auth 中间件新增 cookie 读取支持（`<img>` 标签无法发 Bearer header），前端自动同步 token 到 cookie
- **图片上传唯一文件名** — 上传图片改用 `crypto.randomBytes` 生成随机文件名，不同对话上传同名文件不再互相覆盖
- **后台 API 调用超时保护** — auto-learn、对话总结、Prompt 融合三个端点的模型 API 调用统一加 60 秒超时（AbortController），防止请求卡死无限期挂起

### Performance
- **流式收尾二阶段优化** — 流式结束后先移除光标并画一帧纯文本，再异步执行 Markdown 渲染，消除原来同步全量重渲染导致的 200-500ms 卡顿
- **思考链懒渲染** — 折叠状态下跳过 Markdown 解析，用户展开时才渲染，减少收尾阶段一半的 CPU 开销
- **DocumentFragment 单次 DOM 提交** — 用 `bubble.replaceChildren(frag)` 替代 `innerHTML="" + 多次 appendChild`，减少重排次数
- **滚动延迟到下一帧** — 收尾滚动放到 `requestAnimationFrame` 中执行，避免和 DOM 更新冲突导致布局抖动

## 2026-02-21

### New Features
- **个性化设置** — 设置面板「长期记忆」Tab 新增个性化区域：
  - **AI 名称**：自定义后输入框占位符变为「给 xxx 发消息...」，不填则显示「给 4o 发消息...」
  - **你的称呼**：设置后欢迎语变为「鹿鹿，今天想聊点什么？」等个性化问候，不填则使用通用欢迎语
  - 后端 `config.json` 新增 `ai_name` / `user_name` 可选字段，`normalizeConfig` 和 `validateConfigPatch` 同步支持
  - 保存后立即生效（`applyPersonalization()`），无需刷新页面
  - 恢复默认时自动清空个性化字段

### Bug Fixes
- **401 弹窗重复 3 次**：页面加载时 3 个并发 API 请求同时收到 401，各自独立弹出 `window.prompt()`。改用 deferred Promise 锁模式，确保只弹一次输入框，其余请求等待同一个结果
- **错误 Token 无反馈**：输入错误的 ADMIN_TOKEN 后静默失败，用户不知道发生了什么。现在会弹出 toast 提示「验证失败，请刷新重试」并自动清除 localStorage 中的坏 token
- **Docker 403 无提示**：未设置 ADMIN_TOKEN 的 Docker 部署返回 403，前端无任何反馈。新增 toast 提示「请在 .env 中设置 ADMIN_TOKEN 后重启服务」

### Documentation
- **Docker 部署文档增强**：
  - 新增 `notepad .env` / `nano .env` 编辑步骤，降低新手门槛
  - 新增「修改 `.env` 后怎么生效」章节，说明 `docker compose restart` 不会重新读取 `.env`，必须 `down` + `up`
  - 新增 Docker 更新命令 `git pull` + `docker compose up -d --build`
  - 移除误导性的 `docker compose restart` 常用命令
- **ADMIN_TOKEN 文档统一**：
  - `.env.example` 注释明确三种场景（远程访问/Docker/本机）
  - README 环境变量表 ADMIN_TOKEN 从「否」改为「视情况」
  - 新增醒目提示：Docker 部署、手机访问、其他电脑访问均必须设置

## 2026-02-19

### UI Improvements
- **管理按钮配色**：边框和文字改为主题绿色（`--accent`），hover 时填充绿底白字，与设置按钮视觉区分
- **分组标签增强**：字号 11px→12px，新增底部分隔线，增加上间距，提升辨识度
- **对话列表分组折叠**：
  - 当年月份/季度：单级折叠，点击标题收起/展开
  - 往年（2025、2024…）：默认折叠，显示年份+对话数；展开后按月份子分组，月份也可独立折叠
  - 折叠箭头 ▾/▸ 带旋转动画，搜索模式下不显示分组
- **融合按钮提示**：「融合到现有 Prompt」上方新增说明文字，提示该操作会调用 AI 并消耗 token
- **对话列表默认折叠优化**：打开应用时只展开当月对话，其余月份/季度/年份默认折叠，减少视觉干扰
- **恢复默认设置**：设置面板底部新增「恢复默认」按钮，一键重置人格指令、长期记忆和模型参数为出厂值，保留当前模型选择和已导入的对话不受影响。旧设置自动备份到 `prompts/backups/`

### Refactoring — 大文件拆分 (P3)
- **后端 server.js (1447行) → 16 个模块文件**
  - `server.js` 精简为 36 行薄入口（Express 中间件挂载 + 启动）
  - `lib/` 7 个工具模块：clients、config、prompts、validators、auth、search、auto-learn
  - `routes/` 8 个路由模块：chat、conversations、models、config、prompts、images、auto-learn、summarize
- **前端 app.js (2187行) → 10 个 ES Module 文件**
  - `public/app.js` 精简为 204 行薄入口（事件绑定 + 初始化）
  - `public/modules/` 9 个模块：state、api、render、images、conversations、chat、settings、theme、import
  - 共享可变状态通过 `state` 对象封装，避免 ES Module 导出不可变绑定问题
  - `getCurrentConv()` 放入 state.js 打破 conversations ↔ render 循环依赖
  - `index.html` 改用 `<script type="module">` 加载

### New Features
- **导入 ChatGPT 图片支持 (P1)**：拖入完整导出文件夹即可恢复对话中的真实图片
  - 后端新增 `POST /api/images` 图片上传端点（multer, MIME 白名单, 10MB 限制）
  - 图片存储于 `data/images/`，对话 JSON 引用服务端路径，发送模型前自动转 base64
  - `import-worker.js` 全面重构：支持 `multimodal_text` 消息、DALL-E `tool` 角色、`sediment://` / `file-service://` 资源指针
  - 前端支持文件夹拖拽和 `webkitdirectory` 文件夹选择，自动建立 `fileId → File` 映射并批量上传
  - 仅上传 `conversations.json` 时图片显示占位文本，引导用户上传完整文件夹
- **批量删除对话**：侧边栏新增「管理」模式，支持全选/多选批量删除（最多 2000 条）
- **对话列表按时间分组**：侧边栏按倒序排列，自动插入时间分组标题
  - 当前季度内按月显示（如「2月」「1月」）
  - 过去季度按范围（如「1-3月」）
  - 往年仅显示年份（如「2025」「2024」）
  - 跨年自动降级，无需额外处理

### Bug Fixes
- 修复导入的图片对话继续聊天报错「Only user messages can have multi-part content」：允许 assistant 消息携带数组内容，发送模型前自动展平为纯文本
- 修复多模态消息渲染 bug：循环内 `textContent` 被覆盖导致只显示最后一段文本

### Security & Robustness (Code Review)
- 修复图片路径校验可被 `..` 绕过的路径穿越风险
- 修复图片上传仅校验 MIME 不校验扩展名的绕过风险，文件名消毒增强（连续点号、前导点号）
- 修复 assistant 纯图片消息展平后变空串导致模型 API 报错，改为 `[图片]` 占位
- 修复文件夹导入 `entry.file()` 缺少 reject 回调，读取失败时 Promise 永远 pending
- 修复灯箱重复创建：快速连点图片会叠加多个遮罩层
- 修复图片 base64 转换失败后静默吞错，改为降级显示 `[图片不可用]`

### Error Handling & Reliability (P2)
- 新增全局 `showToast` 通知组件：右下角弹出，支持 error/warning 类型，4 秒自动消失
- 新增 `unhandledrejection` 全局捕获，未处理的异步错误自动弹出 toast 提示
- SSE 流式解析错误从静默忽略改为计数器，连续 5 次失败时提示用户
- `apiFetch` 新增 `navigator.onLine` 离线检测，断网时立即提示而非等待超时
- `saveConversationToServer` 新增 `res.ok` 校验，HTTP 错误和网络异常均弹 toast 提示
- `/api/memory/auto-learn` 新增严格输入校验：role 白名单、content 类型检查、单条内容 20000 字符上限

## 2026-02-15

### New Features
- 新增「导入与总结」功能（设置面板第 4 个 Tab）：
  - 一键导入 ChatGPT 导出的 `conversations.json`，Web Worker 后台解析大文件不卡 UI
  - 「本次导入」与「全部本地」两种范围切换，无需导入也可直接总结现有对话
  - 两步式 Prompt 生成：先提取新发现（不改动现有 Prompt）→ 用户审核 → 点击「融合」智能合并
  - 融合结果可编辑预览，应用前自动备份旧版本到 `prompts/backups/`
- 对话采样策略：均匀取样（头/中/尾），内容超限时列出未纳入的对话标题，用户可自行调整选择
- 导入面板内置 ChatGPT 数据导出指引（可折叠），ZIP 文件误传时给出针对性提示
- 侧边栏底部显示项目名称和版本号，链接到 GitHub 仓库
- README 新增完整的导入三步流程说明

### Bug Fixes
- 总结接口 JSON 解析失败时直接报错，防止误清空用户记忆
- 前端限制总结对话数量上限 50 条
- Worker 在 `current_node` 缺失时按时间戳选取最新叶子节点

## 2026-02-14

### Improvements
- 修复 OpenRouter 403 问题：请求头改为可配置（`OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`）
- 新增 `OPENAI_BASE_URL`、`ARK_BASE_URL`、`OPENROUTER_BASE_URL` 配置能力
- 修复 Auto-Learn 在 OpenRouter-only 场景下的模型路由问题
- 增强自动记忆可观测性：失败和跳过原因在控制台输出
