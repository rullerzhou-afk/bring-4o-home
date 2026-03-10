// routes/conversations.js 路由层测试
// 策略: vi.spyOn 替代 vi.mock（vitest 4 不拦截 CJS require）

const fs = require("fs");
const fsp = fs.promises;
const { createReq, createRes } = require("./helpers/mock-req-res");
const { extractHandler } = require("./helpers/extract-handler");

// 1. Load real dependency modules
const config = require("../lib/config");
const validators = require("../lib/validators");
const clients = require("../lib/clients");

// 2. Spy on function exports BEFORE loading route
vi.spyOn(config, "atomicWrite").mockResolvedValue();
vi.spyOn(config, "readIndex").mockResolvedValue({});
vi.spyOn(config, "rebuildIndex").mockResolvedValue({});
vi.spyOn(config, "updateIndexEntry").mockResolvedValue();
vi.spyOn(config, "removeIndexEntry").mockResolvedValue();
vi.spyOn(config, "removeIndexEntries").mockResolvedValue();
vi.spyOn(config, "withConvLock").mockImplementation((id, fn) => fn());
vi.spyOn(validators, "validateConversation");
vi.spyOn(clients, "getClientForModel");

// 3. Load route (captures spied functions)
const routerMod = require("../routes/conversations");
const router = routerMod;
const { extractImageFilenames } = routerMod;

// 4. Default mock implementations
beforeEach(() => {
  vi.clearAllMocks();
  config.readIndex.mockResolvedValue({});
  config.rebuildIndex.mockResolvedValue({});
  config.atomicWrite.mockResolvedValue();
  config.updateIndexEntry.mockResolvedValue();
  config.removeIndexEntry.mockResolvedValue();
  config.removeIndexEntries.mockResolvedValue();
  config.withConvLock.mockImplementation((id, fn) => fn());
  validators.validateConversation.mockImplementation((body) => {
    if (!body || !body.id) return { ok: false, error: "id required" };
    return { ok: true, value: body };
  });
});

// ===== 纯函数: extractImageFilenames =====

describe("extractImageFilenames", () => {
  it("空数组 → []", () => expect(extractImageFilenames([])).toEqual([]));
  it("null → []", () => expect(extractImageFilenames(null)).toEqual([]));
  it("undefined → []", () => expect(extractImageFilenames(undefined)).toEqual([]));
  it("非数组 → []", () => expect(extractImageFilenames("string")).toEqual([]));

  it("提取 /images/ 路径", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: "/images/abc.png" } }] }];
    expect(extractImageFilenames(msgs)).toEqual(["abc.png"]);
  });

  it("过滤含 .. 的文件名", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: "/images/../etc/passwd" } }] }];
    expect(extractImageFilenames(msgs)).toEqual([]);
  });

  it("过滤含 / 的文件名", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: "/images/sub/file.png" } }] }];
    expect(extractImageFilenames(msgs)).toEqual([]);
  });

  it("跳过 string content", () => {
    expect(extractImageFilenames([{ content: "hello" }])).toEqual([]);
  });

  it("跳过非 /images/ URL", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }] }];
    expect(extractImageFilenames(msgs)).toEqual([]);
  });

  it("多条消息多张图", () => {
    const msgs = [
      { content: [{ type: "image_url", image_url: { url: "/images/a.png" } }] },
      { content: [{ type: "image_url", image_url: { url: "/images/b.jpg" } }, { type: "image_url", image_url: { url: "/images/c.webp" } }] },
    ];
    expect(extractImageFilenames(msgs)).toEqual(["a.png", "b.jpg", "c.webp"]);
  });

  it("空文件名 → 不包含", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: "/images/" } }] }];
    expect(extractImageFilenames(msgs)).toEqual([]);
  });

  it("url 非 string → 跳过", () => {
    const msgs = [{ content: [{ type: "image_url", image_url: { url: 123 } }] }];
    expect(extractImageFilenames(msgs)).toEqual([]);
  });
});

// ===== GET /conversations =====

describe("GET /conversations", () => {
  const getHandler = () => extractHandler(router, "get", "/conversations");

  it("正常返回排序列表", async () => {
    config.readIndex.mockResolvedValue({
      "1234567890": { title: "A" },
      "1234567890123": { title: "B" },
    });
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._json).toHaveLength(2);
    expect(res._json[0].id).toBe("1234567890123");
  });

  it("readIndex null → 触发 rebuildIndex", async () => {
    config.readIndex.mockResolvedValue(null);
    config.rebuildIndex.mockResolvedValue({ "1234567890": { title: "重建" } });
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(config.rebuildIndex).toHaveBeenCalled();
    expect(res._json).toHaveLength(1);
  });

  it("readIndex 抛错 → 500", async () => {
    config.readIndex.mockRejectedValue(new Error("err"));
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._status).toBe(500);
  });

  it("空索引 → 空列表", async () => {
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._json).toEqual([]);
  });
});

// ===== POST /conversations/search =====

describe("POST /conversations/search", () => {
  const getHandler = () => extractHandler(router, "post", "/conversations/search");
  let readdirSpy, readFileSpy;

  beforeEach(() => {
    readdirSpy = vi.spyOn(fsp, "readdir");
    readFileSpy = vi.spyOn(fsp, "readFile");
  });
  afterEach(() => { readdirSpy.mockRestore(); readFileSpy.mockRestore(); });

  it("空查询 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: { q: "" } }), res);
    expect(res._status).toBe(400);
  });

  it("q 缺失 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: {} }), res);
    expect(res._status).toBe(400);
  });

  it("超长查询 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: { q: "x".repeat(201) } }), res);
    expect(res._status).toBe(400);
  });

  it("匹配标题", async () => {
    readdirSpy.mockResolvedValue(["123.json"]);
    readFileSpy.mockResolvedValue(JSON.stringify({ id: "123", title: "Hello World", messages: [] }));
    const res = createRes();
    await getHandler()(createReq({ body: { q: "hello" } }), res);
    expect(res._json.results).toHaveLength(1);
    expect(res._json.results[0].snippet).toBe("Hello World");
    expect(res._json.truncated).toBe(false);
  });

  it("匹配消息内容", async () => {
    readdirSpy.mockResolvedValue(["123.json"]);
    readFileSpy.mockResolvedValue(JSON.stringify({
      id: "123", title: "无关", messages: [{ role: "user", content: "包含关键词的内容" }],
    }));
    const res = createRes();
    await getHandler()(createReq({ body: { q: "关键词" } }), res);
    expect(res._json.results).toHaveLength(1);
    expect(res._json.results[0].snippet).toContain("关键词");
  });

  it("不匹配 → 空", async () => {
    readdirSpy.mockResolvedValue(["123.json"]);
    readFileSpy.mockResolvedValue(JSON.stringify({ id: "123", title: "标题", messages: [] }));
    const res = createRes();
    await getHandler()(createReq({ body: { q: "不存在" } }), res);
    expect(res._json.results).toEqual([]);
    expect(res._json.truncated).toBe(false);
  });

  it("跳过 _index.json", async () => {
    readdirSpy.mockResolvedValue(["_index.json", "123.json"]);
    readFileSpy.mockResolvedValue(JSON.stringify({ id: "123", title: "Match", messages: [] }));
    const res = createRes();
    await getHandler()(createReq({ body: { q: "match" } }), res);
    expect(res._json.results).toHaveLength(1);
  });

  it("损坏文件被跳过", async () => {
    readdirSpy.mockResolvedValue(["bad.json"]);
    readFileSpy.mockRejectedValue(new Error("read error"));
    const res = createRes();
    await getHandler()(createReq({ body: { q: "test" } }), res);
    expect(res._json.results).toEqual([]);
  });
});

// ===== GET /conversations/:id =====

describe("GET /conversations/:id", () => {
  const getHandler = () => extractHandler(router, "get", "/conversations/:id");
  let readFileSpy;
  beforeEach(() => { readFileSpy = vi.spyOn(fsp, "readFile"); });
  afterEach(() => { readFileSpy.mockRestore(); });

  it("无效 id → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ params: { id: "bad" } }), res);
    expect(res._status).toBe(400);
  });

  it("正常读取", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ id: "1234567890", messages: [] }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._json.id).toBe("1234567890");
  });

  it("不存在 → 404", async () => {
    readFileSpy.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(404);
  });

  it("读取异常 → 500", async () => {
    readFileSpy.mockRejectedValue(new Error("disk error"));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(500);
  });
});

// ===== PUT /conversations/:id =====

describe("PUT /conversations/:id", () => {
  const getHandler = () => extractHandler(router, "put", "/conversations/:id");
  let readFileSpy;
  beforeEach(() => { readFileSpy = vi.spyOn(fsp, "readFile"); });
  afterEach(() => { readFileSpy.mockRestore(); });

  it("无效 id → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ params: { id: "bad" }, body: {} }), res);
    expect(res._status).toBe(400);
  });

  it("validate 失败 → 400", async () => {
    validators.validateConversation.mockReturnValue({ ok: false, error: "bad" });
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" }, body: { id: "1234567890" } }), res);
    expect(res._status).toBe(400);
  });

  it("正常保存", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [{ role: "user", content: "hi" }] },
    });
    readFileSpy.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" }, body: { title: "T", messages: [] } }), res);
    expect(res._json.ok).toBe(true);
    expect(config.atomicWrite).toHaveBeenCalled();
  });

  it("请求带 summary → 写入", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [] },
    });
    const summaryObj = { text: "my summary", upToIndex: 10, generatedAt: "2026-01-01T00:00:00Z" };
    const res = createRes();
    await getHandler()(createReq({
      params: { id: "1234567890" },
      body: { title: "T", messages: [], summary: summaryObj },
    }), res);
    const written = JSON.parse(config.atomicWrite.mock.calls[0][1]);
    expect(written.summary).toEqual(summaryObj);
  });

  it("请求带字符串 summary（旧格式兼容）→ 200", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [] },
    });
    const res = createRes();
    await getHandler()(createReq({
      params: { id: "1234567890" },
      body: { title: "T", messages: [], summary: "legacy string" },
    }), res);
    expect(res._json.ok).toBe(true);
    const written = JSON.parse(config.atomicWrite.mock.calls[0][1]);
    expect(written.summary).toBe("legacy string");
  });

  it("请求带非法 summary（数组）→ 400", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [] },
    });
    const res = createRes();
    await getHandler()(createReq({
      params: { id: "1234567890" },
      body: { title: "T", messages: [], summary: [1, 2, 3] },
    }), res);
    expect(res._status).toBe(400);
  });

  it("不带 summary → 保留旧的", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [] },
    });
    readFileSpy.mockResolvedValue(JSON.stringify({ id: "1234567890", summary: "old" }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" }, body: { title: "T", messages: [] } }), res);
    const written = JSON.parse(config.atomicWrite.mock.calls[0][1]);
    expect(written.summary).toBe("old");
  });

  it("withConvLock 被调用", async () => {
    validators.validateConversation.mockReturnValue({
      ok: true,
      value: { id: "1234567890", title: "T", messages: [] },
    });
    readFileSpy.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" }, body: {} }), res);
    expect(config.withConvLock).toHaveBeenCalledWith("1234567890", expect.any(Function));
  });
});

// ===== DELETE /conversations/:id =====

describe("DELETE /conversations/:id", () => {
  const getHandler = () => extractHandler(router, "delete", "/conversations/:id");
  let readFileSpy, unlinkSpy;
  beforeEach(() => { readFileSpy = vi.spyOn(fsp, "readFile"); unlinkSpy = vi.spyOn(fsp, "unlink"); });
  afterEach(() => { readFileSpy.mockRestore(); unlinkSpy.mockRestore(); });

  it("无效 id → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ params: { id: "bad" } }), res);
    expect(res._status).toBe(400);
  });

  it("正常删除", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ messages: [] }));
    unlinkSpy.mockResolvedValue();
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._json.ok).toBe(true);
    expect(config.removeIndexEntry).toHaveBeenCalledWith("1234567890");
  });

  it("ENOENT → ok: true", async () => {
    readFileSpy.mockRejectedValue(Object.assign(new Error("x"), { code: "ENOENT" }));
    unlinkSpy.mockRejectedValue(Object.assign(new Error("x"), { code: "ENOENT" }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._json.ok).toBe(true);
  });

  it("其他错误 → 500", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ messages: [] }));
    unlinkSpy.mockRejectedValue(new Error("perm"));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(500);
  });
});

// ===== POST /conversations/:id/generate-title =====

describe("POST /conversations/:id/generate-title", () => {
  const getHandler = () => extractHandler(router, "post", "/conversations/:id/generate-title");
  let readFileSpy;
  beforeEach(() => { readFileSpy = vi.spyOn(fsp, "readFile"); });
  afterEach(() => { readFileSpy.mockRestore(); });

  it("无效 id → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ params: { id: "bad" } }), res);
    expect(res._status).toBe(400);
  });

  it("消息 < 2 → 400", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(400);
  });

  it("LLM 正常返回", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({
      id: "1234567890",
      messages: [{ role: "user", content: "你好" }, { role: "assistant", content: "你好！" }],
    }));
    clients.getClientForModel.mockReturnValue({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "问候对话" } }],
      }) } },
    });
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._json.title).toBe("问候对话");
  });

  it("LLM 返空 → 500", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({
      id: "1234567890",
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    }));
    clients.getClientForModel.mockReturnValue({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "" } }],
      }) } },
    });
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(500);
  });

  it("AbortError → 504", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({
      id: "1234567890",
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    }));
    const err = new Error("aborted"); err.name = "AbortError";
    clients.getClientForModel.mockReturnValue({
      chat: { completions: { create: vi.fn().mockRejectedValue(err) } },
    });
    const res = createRes();
    await getHandler()(createReq({ params: { id: "1234567890" } }), res);
    expect(res._status).toBe(504);
  });
});

// ===== POST /conversations/batch-delete =====

describe("POST /conversations/batch-delete", () => {
  const getHandler = () => extractHandler(router, "post", "/conversations/batch-delete");
  let readFileSpy, unlinkSpy;
  beforeEach(() => { readFileSpy = vi.spyOn(fsp, "readFile"); unlinkSpy = vi.spyOn(fsp, "unlink"); });
  afterEach(() => { readFileSpy.mockRestore(); unlinkSpy.mockRestore(); });

  it("ids 缺失 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: {} }), res);
    expect(res._status).toBe(400);
  });

  it("ids 空 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: { ids: [] } }), res);
    expect(res._status).toBe(400);
  });

  it("ids > 2000 → 400", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: { ids: Array(2001).fill("1234567890") } }), res);
    expect(res._status).toBe(400);
  });

  it("正常删除", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ messages: [] }));
    unlinkSpy.mockResolvedValue();
    const res = createRes();
    await getHandler()(createReq({ body: { ids: ["1234567890", "1234567891"] } }), res);
    expect(res._json.ok).toBe(true);
    expect(res._json.deleted).toBe(2);
  });

  it("ENOENT 算成功", async () => {
    readFileSpy.mockRejectedValue(Object.assign(new Error("x"), { code: "ENOENT" }));
    unlinkSpy.mockRejectedValue(Object.assign(new Error("x"), { code: "ENOENT" }));
    const res = createRes();
    await getHandler()(createReq({ body: { ids: ["1234567890"] } }), res);
    expect(res._json.deleted).toBe(1);
  });

  it("无效 id → failed 计数", async () => {
    const res = createRes();
    await getHandler()(createReq({ body: { ids: ["bad-id"] } }), res);
    expect(res._json.failed).toBe(1);
  });

  it("调用 removeIndexEntries", async () => {
    readFileSpy.mockResolvedValue(JSON.stringify({ messages: [] }));
    unlinkSpy.mockResolvedValue();
    const res = createRes();
    await getHandler()(createReq({ body: { ids: ["1234567890"] } }), res);
    expect(config.removeIndexEntries).toHaveBeenCalledWith(["1234567890"]);
  });
});

// ===== POST /conversations/cleanup-orphan-images =====

describe("POST /conversations/cleanup-orphan-images", () => {
  const getHandler = () => extractHandler(router, "post", "/conversations/cleanup-orphan-images");
  let readdirSpy, readFileSpy, unlinkSpy;
  beforeEach(() => {
    readdirSpy = vi.spyOn(fsp, "readdir");
    readFileSpy = vi.spyOn(fsp, "readFile");
    unlinkSpy = vi.spyOn(fsp, "unlink");
  });
  afterEach(() => { readdirSpy.mockRestore(); readFileSpy.mockRestore(); unlinkSpy.mockRestore(); });

  it("无孤儿 → deleted: 0", async () => {
    readdirSpy.mockImplementation((dir) => {
      if (dir === config.CONVERSATIONS_DIR) return Promise.resolve(["123.json"]);
      if (dir === config.IMAGES_DIR) return Promise.resolve(["used.png"]);
      return Promise.resolve([]);
    });
    readFileSpy.mockResolvedValue(JSON.stringify({
      messages: [{ content: [{ type: "image_url", image_url: { url: "/images/used.png" } }] }],
    }));
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._json.deleted).toBe(0);
  });

  it("有孤儿 → 删除并返回", async () => {
    readdirSpy.mockImplementation((dir) => {
      if (dir === config.CONVERSATIONS_DIR) return Promise.resolve([]);
      if (dir === config.IMAGES_DIR) return Promise.resolve(["orphan.png"]);
      return Promise.resolve([]);
    });
    unlinkSpy.mockResolvedValue();
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._json.deleted).toBe(1);
    expect(res._json.orphans).toContain("orphan.png");
  });

  it("部分失败 → 返回 failed", async () => {
    readdirSpy.mockImplementation((dir) => {
      if (dir === config.CONVERSATIONS_DIR) return Promise.resolve([]);
      if (dir === config.IMAGES_DIR) return Promise.resolve(["a.png", "b.png"]);
      return Promise.resolve([]);
    });
    unlinkSpy.mockImplementation((p) => p.includes("b.png") ? Promise.reject(new Error("perm")) : Promise.resolve());
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._json.deleted).toBe(1);
    expect(res._json.failed).toHaveLength(1);
  });

  it("readdir 失败 → 500", async () => {
    readdirSpy.mockRejectedValue(new Error("err"));
    const res = createRes();
    await getHandler()(createReq(), res);
    expect(res._status).toBe(500);
  });
});
