# Changelog

## 2026-02-14

### Improvements
- 修复 OpenRouter 在不同机器/访问地址下可能触发 403 的问题：请求头改为可配置（`OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`）。
- 新增多渠道 `BASE_URL` 配置能力：支持 `OPENAI_BASE_URL`、`ARK_BASE_URL`、`OPENROUTER_BASE_URL`，降低环境差异导致的接入问题。
- 修复自动长期记忆在 OpenRouter-only 场景下的模型路由问题：`AUTO_LEARN_MODEL` 可自动纠偏为 OpenRouter 模型格式。
- 增强自动记忆可观测性：前端不再静默吞错，失败和跳过原因会在控制台输出。
- 调整新手默认配置：`ADMIN_TOKEN` 在示例环境变量中默认注释关闭，并补充“跨机器访问必须设置 `ADMIN_TOKEN`”文档说明。
- 同步文档与实现细节：补全新增环境变量说明并对齐火山 Auto-Learn 默认模型命名。
