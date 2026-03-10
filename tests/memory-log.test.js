const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const {
  LOG_PATH,
  appendMemoryLog,
  readMemoryLog,
  clearMemoryLog,
  _resetLineCount,
} = require("../lib/memory-log");

describe("memory-log", () => {
  beforeEach(async () => {
    await fsp.unlink(LOG_PATH).catch(() => {});
    _resetLineCount();
  });

  afterAll(async () => {
    await fsp.unlink(LOG_PATH).catch(() => {});
  });

  // --- appendMemoryLog ---

  it("appendMemoryLog appends valid JSONL", async () => {
    const entry = {
      ts: "2026-01-01T00:00:00.000Z",
      convId: "1234567890123",
      ops: [{ op: "add", text: "test" }],
    };
    await appendMemoryLog(entry);

    const raw = await fsp.readFile(LOG_PATH, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(entry);
  });

  it("appendMemoryLog appends multiple entries as separate lines", async () => {
    await appendMemoryLog({ ts: "t1", convId: "c1", ops: [] });
    await appendMemoryLog({ ts: "t2", convId: "c2", ops: [] });

    const raw = await fsp.readFile(LOG_PATH, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).convId).toBe("c1");
    expect(JSON.parse(lines[1]).convId).toBe("c2");
  });

  // --- readMemoryLog ---

  it("readMemoryLog returns newest-first", async () => {
    await appendMemoryLog({ ts: "2026-01-01T00:00:00Z", convId: "c1", ops: [] });
    await appendMemoryLog({ ts: "2026-01-02T00:00:00Z", convId: "c2", ops: [] });
    await appendMemoryLog({ ts: "2026-01-03T00:00:00Z", convId: "c3", ops: [] });

    const entries = await readMemoryLog();
    expect(entries).toHaveLength(3);
    expect(entries[0].convId).toBe("c3");
    expect(entries[1].convId).toBe("c2");
    expect(entries[2].convId).toBe("c1");
  });

  it("readMemoryLog respects limit", async () => {
    await appendMemoryLog({ ts: "2026-01-01T00:00:00Z", convId: "c1", ops: [] });
    await appendMemoryLog({ ts: "2026-01-02T00:00:00Z", convId: "c2", ops: [] });
    await appendMemoryLog({ ts: "2026-01-03T00:00:00Z", convId: "c3", ops: [] });

    const entries = await readMemoryLog(2);
    expect(entries).toHaveLength(2);
    expect(entries[0].convId).toBe("c3");
    expect(entries[1].convId).toBe("c2");
  });

  it("readMemoryLog returns empty array when file does not exist", async () => {
    const entries = await readMemoryLog();
    expect(entries).toEqual([]);
  });

  it("readMemoryLog skips corrupted/invalid JSON lines", async () => {
    const content = [
      '{"ts":"t1","convId":"c1","ops":[]}',
      "NOT_VALID_JSON",
      '{"ts":"t2","convId":"c2","ops":[]}',
      "",
    ].join("\n");
    await fsp.writeFile(LOG_PATH, content);

    const entries = await readMemoryLog();
    expect(entries).toHaveLength(2);
    // newest-first
    expect(entries[0].convId).toBe("c2");
    expect(entries[1].convId).toBe("c1");
  });

  // --- clearMemoryLog ---

  it("clearMemoryLog empties the log", async () => {
    await appendMemoryLog({ ts: "2026-01-01T00:00:00Z", convId: "c1", ops: [] });
    await appendMemoryLog({ ts: "2026-01-02T00:00:00Z", convId: "c2", ops: [] });

    await clearMemoryLog();
    const entries = await readMemoryLog();
    expect(entries).toEqual([]);
  });

  // --- auto-truncation ---

  it("auto-truncates when exceeding MAX_LOG_LINES (5000)", async () => {
    // Write 5002 lines directly to the file
    const lines = [];
    for (let i = 0; i < 5002; i++) {
      lines.push(JSON.stringify({ ts: `t${i}`, convId: `c${i}`, ops: [] }));
    }
    await fsp.writeFile(LOG_PATH, lines.join("\n") + "\n");

    // Append one more entry to trigger truncation check
    await appendMemoryLog({ ts: "trigger", convId: "trigger", ops: [] });

    const raw = await fsp.readFile(LOG_PATH, "utf-8");
    const remaining = raw.trim().split("\n").filter(Boolean);
    expect(remaining.length).toBeLessThanOrEqual(5000);

    // The last entry should be our trigger
    const last = JSON.parse(remaining[remaining.length - 1]);
    expect(last.convId).toBe("trigger");

    // The oldest entries should have been dropped
    const first = JSON.parse(remaining[0]);
    expect(first.convId).not.toBe("c0");
  });
});
