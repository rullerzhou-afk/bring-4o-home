// 测试环境 setup：设置 dummy 环境变量，防止 clients.js 的 process.exit(1)
process.env.OPENAI_API_KEY = "test-key-for-vitest";
