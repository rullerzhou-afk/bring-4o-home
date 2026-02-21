const fs = require('fs');
const prompts = require('../lib/prompts');

describe('lib/prompts', () => {
  let readFileSpy;

  beforeEach(() => {
    readFileSpy = vi.spyOn(fs.promises, 'readFile');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readPromptFile', () => {
    it('returns file content when file exists', async () => {
      readFileSpy.mockResolvedValue('hello prompt');

      const result = await prompts.readPromptFile('some/path.md');

      expect(result).toBe('hello prompt');
      expect(readFileSpy).toHaveBeenCalledWith('some/path.md', 'utf-8');
    });

    it('returns empty string when file does not exist', async () => {
      readFileSpy.mockRejectedValue(new Error('ENOENT'));

      const result = await prompts.readPromptFile('missing.md');

      expect(result).toBe('');
    });
  });

  describe('buildSystemPrompt', () => {
    it('concatenates system and memory with separator', async () => {
      readFileSpy.mockImplementation((filePath) => {
        if (filePath === prompts.SYSTEM_PATH) return Promise.resolve('system');
        if (filePath === prompts.MEMORY_PATH) return Promise.resolve('memory');
        return Promise.reject(new Error('unexpected path'));
      });

      const result = await prompts.buildSystemPrompt();

      expect(result).toBe('system\n\n---\n\n# 关于用户的记忆\n\nmemory');
    });

    it('returns only system when memory is empty', async () => {
      readFileSpy.mockImplementation((filePath) => {
        if (filePath === prompts.SYSTEM_PATH) return Promise.resolve('system');
        if (filePath === prompts.MEMORY_PATH) return Promise.resolve('');
        return Promise.reject(new Error('unexpected path'));
      });

      const result = await prompts.buildSystemPrompt();

      expect(result).toBe('system');
    });

    it('returns only memory section when system is empty', async () => {
      readFileSpy.mockImplementation((filePath) => {
        if (filePath === prompts.SYSTEM_PATH) return Promise.resolve('');
        if (filePath === prompts.MEMORY_PATH) return Promise.resolve('memory');
        return Promise.reject(new Error('unexpected path'));
      });

      const result = await prompts.buildSystemPrompt();

      expect(result).toBe('\n---\n\n# 关于用户的记忆\n\nmemory');
    });

    it('returns empty string when both are empty', async () => {
      readFileSpy.mockResolvedValue('');

      const result = await prompts.buildSystemPrompt();

      expect(result).toBe('');
    });
  });

  describe('constants', () => {
    it('DEFAULT_SYSTEM is a non-empty string', () => {
      expect(typeof prompts.DEFAULT_SYSTEM).toBe('string');
      expect(prompts.DEFAULT_SYSTEM.trim().length).toBeGreaterThan(0);
    });

    it('DEFAULT_MEMORY is a non-empty string', () => {
      expect(typeof prompts.DEFAULT_MEMORY).toBe('string');
      expect(prompts.DEFAULT_MEMORY.trim().length).toBeGreaterThan(0);
    });

    it('SYSTEM_PATH contains system.md', () => {
      expect(prompts.SYSTEM_PATH).toContain('system.md');
    });

    it('MEMORY_PATH contains memory.md', () => {
      expect(prompts.MEMORY_PATH).toContain('memory.md');
    });
  });
});
