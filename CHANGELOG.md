# Changelog

## 2026-02-21

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
