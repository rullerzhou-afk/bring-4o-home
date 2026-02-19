const path = require("path");
const fsp = require("fs").promises;

// ===== Prompt 文件路径 =====
const SYSTEM_PATH = path.join(__dirname, "..", "prompts", "system.md");
const MEMORY_PATH = path.join(__dirname, "..", "prompts", "memory.md");

async function readPromptFile(filePath) {
  try {
    return await fsp.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function buildSystemPrompt() {
  const [system, memory] = await Promise.all([
    readPromptFile(SYSTEM_PATH),
    readPromptFile(MEMORY_PATH),
  ]);
  const parts = [];
  if (system) parts.push(system);
  if (memory) parts.push("\n---\n\n# 关于用户的记忆\n\n" + memory);
  return parts.join("\n");
}

module.exports = {
  SYSTEM_PATH,
  MEMORY_PATH,
  readPromptFile,
  buildSystemPrompt,
};
