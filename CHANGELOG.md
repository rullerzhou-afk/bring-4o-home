# Changelog

## 2026-02-15

### New Features
- 新增「导入与总结」功能：设置面板第 4 个 Tab，支持一键导入 ChatGPT 导出的 `conversations.json` 历史对话。
- Web Worker 后台解析：大文件（50MB+）JSON 解析在独立线程执行，不阻塞 UI。
- 对话范围切换：「本次导入」与「全部本地」两种视图，灵活选择要总结的对话。
- AI 总结生成 Prompt：勾选多条对话调用 LLM 分析，在现有 Prompt 基础上修订系统提示词和用户记忆，支持切换总结模型。
- 总结结果预览与应用：生成的 Prompt 建议可编辑预览，应用前自动备份旧版本到 `prompts/backups/`。
- 导入进度动画：逐条导入带平滑进度条 + 计数显示。

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
