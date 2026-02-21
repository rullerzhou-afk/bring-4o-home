// clients.js 在加载时检查环境变量，无 API key 会 process.exit(1)
// 所有间接依赖 clients.js 的模块测试都需要先 vi.mock
// 用法：在测试文件顶部 import 或直接复制 vi.mock 调用

vi.mock("../lib/clients", () => ({
  openaiClient: { chat: { completions: { create: vi.fn() } } },
  arkClient: null,
  openrouterClient: null,
  getClientForModel: vi.fn(),
  resolveDefaultModel: vi.fn(() => "gpt-4o"),
  formatProviderError: vi.fn((err) => err.message || "error"),
  DEFAULT_CONFIG: {
    model: "gpt-4o",
    temperature: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  },
}));
