const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { createMutex } = require("./config");

const LOG_PATH = path.join(__dirname, "..", "data", "memory-log.jsonl");
const MAX_LOG_LINES = 5000;

const withLogLock = createMutex();

let _lineCount = -1; // lazy-init on first append

/**
 * Append an entry to the memory audit log.
 * @param {{ ts: string, convId: string, ops: Array }} entry
 */
async function appendMemoryLog(entry) {
  return withLogLock(async () => {
    try {
      // Lazy init: count lines once on first call
      if (_lineCount < 0) {
        try {
          const content = await fsp.readFile(LOG_PATH, "utf-8");
          _lineCount = content.split("\n").filter(Boolean).length;
        } catch (e) {
          if (e.code === "ENOENT") _lineCount = 0;
          else throw e;
        }
      }

      await fsp.appendFile(LOG_PATH, JSON.stringify(entry) + "\n");
      _lineCount++;

      if (_lineCount > MAX_LOG_LINES) {
        const content = await fsp.readFile(LOG_PATH, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        const kept = lines.slice(lines.length - MAX_LOG_LINES);
        await fsp.writeFile(LOG_PATH, kept.join("\n") + "\n");
        _lineCount = kept.length;
      }
    } catch (err) {
      console.warn("[memory-log] appendMemoryLog failed:", err.message);
    }
  });
}

/**
 * Read the memory audit log, newest-first.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function readMemoryLog(limit = 200) {
  return withLogLock(async () => {
    try {
      const content = await fsp.readFile(LOG_PATH, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch (_) {
          // skip parse failures
        }
      }
      entries.reverse();
      return entries.slice(0, limit);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      console.warn("[memory-log] readMemoryLog failed:", err.message);
      return [];
    }
  });
}

/**
 * Clear the memory audit log.
 */
async function clearMemoryLog() {
  return withLogLock(async () => {
    try {
      await fsp.writeFile(LOG_PATH, "");
      _lineCount = 0;
    } catch (err) {
      console.warn("[memory-log] clearMemoryLog failed:", err.message);
    }
  });
}

// Reset internal counter (for tests only)
function _resetLineCount() { _lineCount = -1; }

module.exports = { LOG_PATH, appendMemoryLog, readMemoryLog, clearMemoryLog, _resetLineCount };
