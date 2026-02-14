# Changelog

## 2026-02-15

### New Features
- 新增「导入与总结」功能：设置面板第 4 个 Tab，支持一键导入 ChatGPT 导出的 `conversations.json` 历史对话。
- Web Worker 后台解析：大文件（50MB+）JSON 解析在独立线程执行，不阻塞 UI。
- 对话范围切换：「本次导入」与「全部本地」两种视图，灵活选择要总结的对话。
- 两步式 Prompt 生成：第一步 AI 只提取新发现（不改动现有 Prompt），第二步用户审核后点击「融合」智能合并到现有 Prompt。
- 总结结果预览与应用：生成的 Prompt 建议可编辑预览，应用前自动备份旧版本到 `prompts/backups/`。
- 导入进度动画：逐条导入带平滑进度条 + 计数显示。

### Improvements
- 打开「导入与总结」Tab 时默认显示「全部本地」对话列表，无需先上传文件即可总结现有对话。
- 总结按钮点击后显示加载动画（按钮文字变为「正在分析中...」+ spinner）。
- 对话采样改为均匀分布：从每条对话的头部、中部、尾部各取消息，覆盖面更广。
- 内容超限时明确告知用户哪些对话未被纳入分析（显示对话标题），而非静默截断。

### Bug Fixes
- 修复总结接口 JSON 解析失败时 fallback 返回空 memory 的高风险问题：改为直接报错，防止误清空用户记忆。
- 修复前端未限制总结对话数量的问题：提交前拦截超过 50 条的选择。
- 修复 Worker 在 `current_node` 缺失时随机选取叶子节点的问题：改为按消息时间戳选取最新分支。

## 2026-02-14

### Improvements
- 修复 OpenRouter 在不同机器/访问地址下可能触发 403 的问题：请求头改为可配置（`OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`）。
- 新增多渠道 `BASE_URL` 配置能力：支持 `OPENAI_BASE_URL`、`ARK_BASE_URL`、`OPENROUTER_BASE_URL`，降低环境差异导致的接入问题。
- 修复自动长期记忆在 OpenRouter-only 场景下的模型路由问题：`AUTO_LEARN_MODEL` 可自动纠偏为 OpenRouter 模型格式。
- 增强自动记忆可观测性：前端不再静默吞错，失败和跳过原因会在控制台输出。
- 调整新手默认配置：`ADMIN_TOKEN` 在示例环境变量中默认注释关闭，并补充“跨机器访问必须设置 `ADMIN_TOKEN`”文档说明。
- 同步文档与实现细节：补全新增环境变量说明并对齐火山 Auto-Learn 默认模型命名。
