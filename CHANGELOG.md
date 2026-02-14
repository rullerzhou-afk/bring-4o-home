# Changelog

## 2026-02-15

### New Features
- 新增「导入与总结」功能（设置面板第 4 个 Tab）：
  - 一键导入 ChatGPT 导出的 `conversations.json`，Web Worker 后台解析大文件不卡 UI
  - 「本次导入」与「全部本地」两种范围切换，无需导入也可直接总结现有对话
  - 两步式 Prompt 生成：先提取新发现（不改动现有 Prompt）→ 用户审核 → 点击「融合」智能合并
  - 融合结果可编辑预览，应用前自动备份旧版本到 `prompts/backups/`
- 对话采样策略：均匀取样（头/中/尾），内容超限时列出未纳入的对话标题，用户可自行调整选择

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
