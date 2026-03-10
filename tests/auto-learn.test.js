const fs = require('fs');

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ARK_API_KEY',
  'ARK_BASE_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_SITE_URL',
  'OPENROUTER_APP_NAME',
  'AUTO_LEARN_MODEL',
  'AUTO_LEARN_COOLDOWN',
  'MODEL',
];

const ORIGINAL_ENV = {};
for (const k of ENV_KEYS) {
  ORIGINAL_ENV[k] = process.env[k];
}

function loadAutoLearn(envOverrides = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  // auto-learn.js captures client refs at load time — must reload both
  delete require.cache[require.resolve('../lib/clients')];
  delete require.cache[require.resolve('../lib/auto-learn')];
  return require('../lib/auto-learn');
}

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('lib/auto-learn', () => {
  // ── parseAutoLearnOutput (pure function) ──────────────────────

  describe('parseAutoLearnOutput', () => {
    const { parseAutoLearnOutput } = require('../lib/auto-learn');

    it('parses categorized output correctly (legacy format)', () => {
      const output = `- [identity] 叫小王，95后
- [preferences] 喜欢深色主题
- [events] 在准备面试`;
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'add', category: 'identity', text: '叫小王，95后', importance: 2 },
        { op: 'add', category: 'preferences', text: '喜欢深色主题', importance: 2 },
        { op: 'add', category: 'events', text: '在准备面试', importance: 2 },
      ]);
    });

    it('returns empty array for NONE', () => {
      expect(parseAutoLearnOutput('NONE')).toEqual([]);
    });

    it('returns empty array for empty/null input', () => {
      expect(parseAutoLearnOutput('')).toEqual([]);
      expect(parseAutoLearnOutput(null)).toEqual([]);
      expect(parseAutoLearnOutput(undefined)).toEqual([]);
    });

    it('skips lines without valid category tag', () => {
      const output = `- [identity] valid item
- no category tag
- [unknown] bad category
some random text`;
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([{ op: 'add', category: 'identity', text: 'valid item', importance: 2 }]);
    });

    it('filters out facts exceeding 80 characters', () => {
      const longText = 'x'.repeat(81);
      const output = `- [identity] ${longText}\n- [identity] short`;
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([{ op: 'add', category: 'identity', text: 'short', importance: 2 }]);
    });

    it('keeps facts exactly at 80 characters', () => {
      const text80 = 'a'.repeat(80);
      const output = `- [identity] ${text80}`;
      const result = parseAutoLearnOutput(output);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe(text80);
    });

    it('handles mixed valid and invalid lines', () => {
      const output = `一些前言
- [identity] 叫小王
- bad line
- [preferences] 喜欢猫
结尾文字`;
      const result = parseAutoLearnOutput(output);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ op: 'add', category: 'identity', text: '叫小王', importance: 2 });
      expect(result[1]).toEqual({ op: 'add', category: 'preferences', text: '喜欢猫', importance: 2 });
    });

    // ── 新操作格式 ──────────────────────────────────

    it('parses ADD format', () => {
      const output = '- ADD [identity] 叫小王\n- ADD [events] 在学Python';
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'add', category: 'identity', text: '叫小王', importance: 2 },
        { op: 'add', category: 'events', text: '在学Python', importance: 2 },
      ]);
    });

    it('parses UPDATE format with target ID', () => {
      const output = '- UPDATE [m_1708000000000] [events] 已入职Google';
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'update', targetId: 'm_1708000000000', category: 'events', text: '已入职Google' },
      ]);
    });

    it('parses DELETE format', () => {
      const output = '- DELETE [m_1708000000000]';
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'delete', targetId: 'm_1708000000000' },
      ]);
    });

    it('parses mixed ADD/UPDATE/DELETE in one output', () => {
      const output = `- DELETE [m_1000000000000]
- ADD [events] 入职了Google
- UPDATE [m_1000000000001] [identity] 住在上海`;
      const result = parseAutoLearnOutput(output);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ op: 'delete', targetId: 'm_1000000000000' });
      expect(result[1]).toEqual({ op: 'add', category: 'events', text: '入职了Google', importance: 2 });
      expect(result[2]).toEqual({ op: 'update', targetId: 'm_1000000000001', category: 'identity', text: '住在上海' });
    });

    it('filters UPDATE with text exceeding 80 chars', () => {
      const output = `- UPDATE [m_1000000000000] [identity] ${'x'.repeat(81)}`;
      expect(parseAutoLearnOutput(output)).toEqual([]);
    });

    it('ignores UPDATE/DELETE with invalid ID format', () => {
      const output = '- UPDATE [bad_id] [identity] text\n- DELETE [123]';
      expect(parseAutoLearnOutput(output)).toEqual([]);
    });

    it('ignores UPDATE with invalid category', () => {
      const output = '- UPDATE [m_1000000000000] [unknown] some text';
      expect(parseAutoLearnOutput(output)).toEqual([]);
    });

    it('handles ADD with case-insensitive keyword', () => {
      const output = '- add [identity] test\n- Add [events] test2';
      const result = parseAutoLearnOutput(output);
      expect(result).toHaveLength(2);
      expect(result[0].op).toBe('add');
      expect(result[1].op).toBe('add');
    });

    it('mixes legacy and new format in same output', () => {
      const output = `- [identity] legacy item
- ADD [events] new item
- UPDATE [m_1000000000000] [preferences] updated item`;
      const result = parseAutoLearnOutput(output);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ op: 'add', category: 'identity', text: 'legacy item', importance: 2 });
      expect(result[1]).toEqual({ op: 'add', category: 'events', text: 'new item', importance: 2 });
      expect(result[2]).toEqual({ op: 'update', targetId: 'm_1000000000000', category: 'preferences', text: 'updated item' });
    });

    it('normalizes ID to lowercase for UPDATE/DELETE', () => {
      const output = '- UPDATE [M_1000000000000] [events] text\n- DELETE [M_2000000000000]';
      const result = parseAutoLearnOutput(output);
      expect(result[0].targetId).toBe('m_1000000000000');
      expect(result[1].targetId).toBe('m_2000000000000');
    });

    // ── importance 解析 ──────────────────────────────

    it('parses ADD with importance tag', () => {
      const output = '- ADD [identity] [importance:3] 核心身份信息\n- ADD [events] [importance:1] 临时计划';
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'add', category: 'identity', text: '核心身份信息', importance: 3 },
        { op: 'add', category: 'events', text: '临时计划', importance: 1 },
      ]);
    });

    it('defaults importance to 2 when tag is absent (ADD)', () => {
      const output = '- ADD [identity] 没有importance标签';
      const result = parseAutoLearnOutput(output);
      expect(result[0].importance).toBe(2);
    });

    it('parses UPDATE with importance tag', () => {
      const output = '- UPDATE [m_1708000000000] [events] [importance:3] 已入职Google';
      const result = parseAutoLearnOutput(output);
      expect(result).toEqual([
        { op: 'update', targetId: 'm_1708000000000', category: 'events', text: '已入职Google', importance: 3 },
      ]);
    });

    it('omits importance when tag is absent (UPDATE) to allow inheritance', () => {
      const output = '- UPDATE [m_1708000000000] [events] 无importance';
      const result = parseAutoLearnOutput(output);
      expect(result[0].importance).toBeUndefined();
    });

    it('truncates operations exceeding MAX_OPS_PER_CALL', () => {
      const { MAX_OPS_PER_CALL } = require('../lib/auto-learn');
      const lines = Array.from({ length: MAX_OPS_PER_CALL + 5 }, (_, i) =>
        `- ADD [identity] fact ${i}`
      ).join('\n');
      const result = parseAutoLearnOutput(lines);
      expect(result).toHaveLength(MAX_OPS_PER_CALL);
    });
  });

  // ── normalizeAutoLearnModel ───────────────────────────────────

  describe('normalizeAutoLearnModel', () => {
    it('returns empty string for empty/undefined/null input', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.normalizeAutoLearnModel('')).toBe('');
      expect(mod.normalizeAutoLearnModel(undefined)).toBe('');
      expect(mod.normalizeAutoLearnModel(null)).toBe('');
    });

    it('strips openai/ prefix when openaiClient exists and openrouterClient does not', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.normalizeAutoLearnModel('openai/gpt-4o')).toBe('gpt-4o');
    });

    it('keeps openai/ prefix when both clients exist', () => {
      const mod = loadAutoLearn({
        OPENAI_API_KEY: 'sk-test',
        OPENROUTER_API_KEY: 'or-test',
      });
      expect(mod.normalizeAutoLearnModel('openai/gpt-4o')).toBe(
        'openai/gpt-4o'
      );
    });

    it('adds openai/ prefix for OpenAI-style model when only openrouterClient exists', () => {
      const mod = loadAutoLearn({ OPENROUTER_API_KEY: 'or-test' });
      expect(mod.normalizeAutoLearnModel('gpt-4o')).toBe('openai/gpt-4o');
      expect(mod.normalizeAutoLearnModel('o3-mini')).toBe('openai/o3-mini');
      expect(mod.normalizeAutoLearnModel('chatgpt-4o-latest')).toBe(
        'openai/chatgpt-4o-latest'
      );
    });

    it('returns non-OpenAI model as-is', () => {
      const mod = loadAutoLearn({ ARK_API_KEY: 'ark-test' });
      expect(mod.normalizeAutoLearnModel('glm-4-plus')).toBe('glm-4-plus');
    });

    it('returns non-openai slash model as-is', () => {
      const mod = loadAutoLearn({ OPENROUTER_API_KEY: 'or-test' });
      expect(mod.normalizeAutoLearnModel('anthropic/claude-3.5-sonnet')).toBe(
        'anthropic/claude-3.5-sonnet'
      );
    });
  });

  // ── resolveAutoLearnModel / AUTO_LEARN_MODEL ──────────────────

  describe('resolveAutoLearnModel', () => {
    it('uses AUTO_LEARN_MODEL env when set', () => {
      const mod = loadAutoLearn({
        OPENAI_API_KEY: 'sk-test',
        AUTO_LEARN_MODEL: 'gpt-4o-mini',
      });
      expect(mod.AUTO_LEARN_MODEL).toBe('gpt-4o-mini');
    });

    it('defaults to gpt-4o-mini when openaiClient is available', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.AUTO_LEARN_MODEL).toBe('gpt-4o-mini');
    });

    it('defaults to openai/gpt-4o-mini when only openrouterClient', () => {
      const mod = loadAutoLearn({ OPENROUTER_API_KEY: 'or-test' });
      expect(mod.AUTO_LEARN_MODEL).toBe('openai/gpt-4o-mini');
    });

    it('defaults to doubao model when only arkClient', () => {
      const mod = loadAutoLearn({ ARK_API_KEY: 'ark-test' });
      expect(mod.AUTO_LEARN_MODEL).toBe('doubao-1-5-lite-32k-250115');
    });

    it('normalizes AUTO_LEARN_MODEL for openrouter-only config', () => {
      const mod = loadAutoLearn({
        OPENROUTER_API_KEY: 'or-test',
        AUTO_LEARN_MODEL: 'gpt-4o',
      });
      expect(mod.AUTO_LEARN_MODEL).toBe('openai/gpt-4o');
    });
  });

  // ── AUTO_LEARN_COOLDOWN ───────────────────────────────────────

  describe('AUTO_LEARN_COOLDOWN', () => {
    it('defaults to 300', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.AUTO_LEARN_COOLDOWN).toBe(300);
    });

    it('reads from env', () => {
      const mod = loadAutoLearn({
        OPENAI_API_KEY: 'sk-test',
        AUTO_LEARN_COOLDOWN: '600',
      });
      expect(mod.AUTO_LEARN_COOLDOWN).toBe(600);
    });
  });

  // ── lastAutoLearnTime getter/setter ───────────────────────────

  describe('lastAutoLearnTime', () => {
    it('starts at 0 and can be updated per conversation', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const convId1 = 'test-conv-123';
      const convId2 = 'test-conv-456';

      expect(mod.getLastAutoLearnTime(convId1)).toBe(0);
      expect(mod.getLastAutoLearnTime(convId2)).toBe(0);

      mod.setLastAutoLearnTime(convId1, 99999);
      expect(mod.getLastAutoLearnTime(convId1)).toBe(99999);
      expect(mod.getLastAutoLearnTime(convId2)).toBe(0); // 不同对话独立
    });
  });

  // ── tryAcquireCooldown ───────────────────────────────────────

  describe('tryAcquireCooldown', () => {
    it('returns true on first call for a convId', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test', AUTO_LEARN_COOLDOWN: '180' });
      expect(mod.tryAcquireCooldown('1700000000001')).toBe(true);
    });

    it('returns false when called again within cooldown', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test', AUTO_LEARN_COOLDOWN: '180' });
      mod.tryAcquireCooldown('1700000000002');
      expect(mod.tryAcquireCooldown('1700000000002')).toBe(false);
    });

    it('cools down independently per convId', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test', AUTO_LEARN_COOLDOWN: '180' });
      mod.tryAcquireCooldown('1700000000003');
      expect(mod.tryAcquireCooldown('1700000000004')).toBe(true); // different conv, should succeed
      expect(mod.tryAcquireCooldown('1700000000003')).toBe(false); // same conv, still cooling
    });

    it('returns false for non-string convId', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.tryAcquireCooldown(null)).toBe(false);
      expect(mod.tryAcquireCooldown(undefined)).toBe(false);
      expect(mod.tryAcquireCooldown(12345)).toBe(false);
    });

    it('returns false for invalid convId format', () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.tryAcquireCooldown('conv-abc')).toBe(false);
      expect(mod.tryAcquireCooldown('short')).toBe(false);
      expect(mod.tryAcquireCooldown('')).toBe(false);
      expect(mod.tryAcquireCooldown('12345678901234567')).toBe(false); // 17 digits, too long
    });
  });

  // ── constants ─────────────────────────────────────────────────

  describe('constants', () => {
    const mod = require('../lib/auto-learn');

    it('AUTO_LEARN_PROMPT is a non-empty string', () => {
      expect(typeof mod.AUTO_LEARN_PROMPT).toBe('string');
      expect(mod.AUTO_LEARN_PROMPT.length).toBeGreaterThan(0);
    });

    it('AUTO_LEARN_PROMPT mentions operation types', () => {
      expect(mod.AUTO_LEARN_PROMPT).toContain('ADD');
      expect(mod.AUTO_LEARN_PROMPT).toContain('UPDATE');
      expect(mod.AUTO_LEARN_PROMPT).toContain('DELETE');
    });

    it('MAX_MEMORY_FACT_LENGTH is 80', () => {
      expect(mod.MAX_MEMORY_FACT_LENGTH).toBe(80);
    });
  });

  // ── appendToLongTermMemory ────────────────────────────────────

  describe('appendToLongTermMemory', () => {
    const prompts = require('../lib/prompts');
    let readMemoryStoreSpy;
    let writeMemoryStoreSpy;

    beforeEach(() => {
      readMemoryStoreSpy = vi.spyOn(prompts, 'readMemoryStore');
      writeMemoryStoreSpy = vi.spyOn(prompts, 'writeMemoryStore').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('appends entries to the correct categories', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{ id: 'm_1000000000000', text: 'existing', date: '2026-01-01', source: 'user_stated' }],
        preferences: [],
        events: [],
      });

      await mod.appendToLongTermMemory([
        { category: 'identity', text: '叫小王' },
        { category: 'events', text: '在学 Python' },
      ]);

      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(2);
      expect(written.identity[1].text).toBe('叫小王');
      expect(written.identity[1].source).toBe('ai_inferred');
      expect(written.events).toHaveLength(1);
      expect(written.events[0].text).toBe('在学 Python');
    });

    it('generates unique IDs for each entry', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.appendToLongTermMemory([
        { category: 'identity', text: 'a' },
        { category: 'identity', text: 'b' },
        { category: 'preferences', text: 'c' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      const allIds = [...written.identity, ...written.preferences].map((i) => i.id);
      expect(new Set(allIds).size).toBe(3);
      allIds.forEach((id) => expect(id).toMatch(/^m_\d+/));
    });

    it('skips append when memory.json exceeds 50K', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      // Create a store that is over 50K when stringified
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      await mod.appendToLongTermMemory([{ category: 'identity', text: 'should not be written' }]);

      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('does nothing for empty entries', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      await mod.appendToLongTermMemory([]);
      expect(readMemoryStoreSpy).not.toHaveBeenCalled();
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('skips entries with invalid category', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.appendToLongTermMemory([
        { category: 'unknown', text: 'bad' },
        { category: 'identity', text: 'good' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('good');
    });
  });

  // ── applyMemoryOperations ─────────────────────────────────

  describe('applyMemoryOperations', () => {
    const prompts = require('../lib/prompts');
    let readMemoryStoreSpy;
    let writeMemoryStoreSpy;

    beforeEach(() => {
      readMemoryStoreSpy = vi.spyOn(prompts, 'readMemoryStore');
      writeMemoryStoreSpy = vi.spyOn(prompts, 'writeMemoryStore').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('adds entries with op:"add"', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: '叫小王' },
        { op: 'add', category: 'events', text: '在学Python' },
      ]);

      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('叫小王');
      expect(written.events).toHaveLength(1);
      expect(written.events[0].text).toBe('在学Python');
    });

    it('deletes entry on op:"delete"', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [{ id: 'm_1000000000000', text: '在找工作', date: '2026-02-15', source: 'ai_inferred' }],
      });

      await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_1000000000000' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(0);
    });

    it('replaces entry on op:"update" (delete old + add new)', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [{ id: 'm_1000000000000', text: '在找工作', date: '2026-02-15', source: 'ai_inferred' }],
      });

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'events', text: '已入职Google' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(1);
      expect(written.events[0].text).toBe('已入职Google');
      expect(written.events[0].id).not.toBe('m_1000000000000');
    });

    it('UPDATE can move entry across categories', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [{ id: 'm_1000000000000', text: '在找工作', date: '2026-02-15', source: 'ai_inferred' }],
      });

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: '在Google工作' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(0);
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('在Google工作');
    });

    it('ignores DELETE for non-existent ID but still processes ADDs', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_9999999999999' },
        { op: 'add', category: 'identity', text: '叫小王' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('叫小王');
    });

    it('handles mixed ADD/UPDATE/DELETE atomically', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{ id: 'm_1000000000000', text: '住在北京', date: '2026-02-10', source: 'user_stated' }],
        preferences: [],
        events: [{ id: 'm_1000000000001', text: '在找工作', date: '2026-02-15', source: 'ai_inferred' }],
      });

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: '住在上海' },
        { op: 'delete', targetId: 'm_1000000000001' },
        { op: 'add', category: 'events', text: '入职了Google' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('住在上海');
      expect(written.events).toHaveLength(1);
      expect(written.events[0].text).toBe('入职了Google');
    });

    it('skips pure ADDs when memory exceeds 50K', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: 'should not be written' },
      ]);

      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('allows DELETE when memory exceeds 50K (self-healing)', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_1000000000000' },
      ]);

      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(799);
    });

    it('allows UPDATE but skips ADD when memory exceeds 50K', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: 'updated' },
        { op: 'add', category: 'events', text: 'should be skipped' },
      ]);

      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      // 旧的被删，新的 update 被加，但 add 被跳过
      expect(written.identity).toHaveLength(800); // 800 - 1 + 1 = 800
      expect(written.events).toHaveLength(0); // add was skipped
    });

    it('does nothing for empty operations', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      await mod.applyMemoryOperations([]);
      expect(readMemoryStoreSpy).not.toHaveBeenCalled();
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('skips add for invalid category in operations', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.applyMemoryOperations([
        { op: 'add', category: 'unknown', text: 'bad' },
        { op: 'add', category: 'identity', text: 'good' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].text).toBe('good');
    });

    it('returns { overLimit: false, appliedOps } for normal operations', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      const result = await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: '叫小王' },
      ]);

      expect(result.overLimit).toBe(false);
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0].op).toBe('add');
      expect(result.appliedOps[0].text).toBe('叫小王');
      expect(result.appliedOps[0].category).toBe('identity');
      expect(result.appliedOps[0].id).toMatch(/^m_\d+/);
    });

    it('returns { overLimit: false, appliedOps: [] } for empty operations', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const result = await mod.applyMemoryOperations([]);
      expect(result).toEqual({ overLimit: false, appliedOps: [] });
    });

    it('returns { overLimit: true, appliedOps: [] } when pure ADDs are skipped due to 50K limit', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      const result = await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: 'should not be written' },
      ]);

      expect(result).toEqual({ overLimit: true, appliedOps: [] });
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('new entries include importance, useCount, lastReferencedAt', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: '叫小王', importance: 3 },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      const item = written.identity[0];
      expect(item.importance).toBe(3);
      expect(item.useCount).toBe(0);
      expect(item.lastReferencedAt).toBeNull();
    });

    it('ADD defaults importance to 2 when not specified', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      await mod.applyMemoryOperations([
        { op: 'add', category: 'identity', text: '测试' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.identity[0].importance).toBe(2);
    });

    it('UPDATE inherits useCount and lastReferencedAt from old entry', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{
          id: 'm_1000000000000',
          text: '住在北京',
          date: '2026-02-10',
          source: 'user_stated',
          importance: 2,
          useCount: 7,
          lastReferencedAt: '2026-02-25T10:00:00.000Z',
        }],
        preferences: [],
        events: [],
      });

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: '住在上海', importance: 3 },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      const updated = written.identity[0];
      expect(updated.text).toBe('住在上海');
      expect(updated.importance).toBe(3); // uses op's importance
      expect(updated.useCount).toBe(7); // inherited from old
      expect(updated.lastReferencedAt).toBe('2026-02-25T10:00:00.000Z'); // inherited from old
    });

    it('UPDATE without importance inherits old importance', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [{
          id: 'm_1000000000000',
          text: '在找工作',
          date: '2026-02-15',
          source: 'ai_inferred',
          importance: 1,
          useCount: 3,
          lastReferencedAt: null,
        }],
      });

      await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'events', text: '已入职' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      const updated = written.events[0];
      expect(updated.importance).toBe(1); // inherited from old (no op.importance)
      expect(updated.useCount).toBe(3); // inherited
    });

    // ── appliedOps 返回值 ──────────────────────────────

    it('appliedOps includes ADD with generated id', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      const result = await mod.applyMemoryOperations([
        { op: 'add', category: 'events', text: '在学Python', importance: 1 },
      ]);

      expect(result.appliedOps).toHaveLength(1);
      const applied = result.appliedOps[0];
      expect(applied.op).toBe('add');
      expect(applied.id).toMatch(/^m_\d+/);
      expect(applied.category).toBe('events');
      expect(applied.text).toBe('在学Python');
      expect(applied.importance).toBe(1);
      expect(applied.oldId).toBeUndefined();
    });

    it('appliedOps includes UPDATE with id and oldId', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{ id: 'm_1000000000000', text: '住在北京', date: '2026-01-01', source: 'user_stated', importance: 2 }],
        preferences: [],
        events: [],
      });

      const result = await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: '住在上海' },
      ]);

      expect(result.appliedOps).toHaveLength(1);
      const applied = result.appliedOps[0];
      expect(applied.op).toBe('update');
      expect(applied.id).toMatch(/^m_\d+/);
      expect(applied.oldId).toBe('m_1000000000000');
      expect(applied.text).toBe('住在上海');
    });

    it('appliedOps includes DELETE with oldId for existing entries', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [{ id: 'm_1000000000000', text: '在找工作', date: '2026-02-15', source: 'ai_inferred', importance: 2 }],
      });

      const result = await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_1000000000000' },
      ]);

      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0]).toEqual({ op: 'delete', oldId: 'm_1000000000000' });
    });

    it('appliedOps excludes DELETE for non-existent IDs', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({ version: 1, identity: [], preferences: [], events: [] });

      const result = await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_9999999999999' },
        { op: 'add', category: 'identity', text: '叫小王' },
      ]);

      // DELETE for non-existent should not appear in appliedOps
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0].op).toBe('add');
    });

    it('appliedOps excludes ADDs skipped due to overLimit', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      const result = await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: 'updated' },
        { op: 'add', category: 'events', text: 'should be skipped' },
      ]);

      // Only the UPDATE should appear in appliedOps, ADD was skipped
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0].op).toBe('update');
    });

    it('appliedOps includes mixed ADD/UPDATE/DELETE correctly', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{ id: 'm_1000000000000', text: '住在北京', date: '2026-02-10', source: 'user_stated', importance: 2 }],
        preferences: [],
        events: [{ id: 'm_1000000000001', text: '在找工作', date: '2026-02-15', source: 'ai_inferred', importance: 1 }],
      });

      const result = await mod.applyMemoryOperations([
        { op: 'update', targetId: 'm_1000000000000', category: 'identity', text: '住在上海' },
        { op: 'delete', targetId: 'm_1000000000001' },
        { op: 'add', category: 'events', text: '入职了Google', importance: 3 },
      ]);

      expect(result.appliedOps).toHaveLength(3);
      // DELETE comes first in appliedOps (processed before ADD/UPDATE loop)
      const deleteOp = result.appliedOps.find(o => o.op === 'delete');
      const updateOp = result.appliedOps.find(o => o.op === 'update');
      const addOp = result.appliedOps.find(o => o.op === 'add');

      expect(deleteOp).toEqual({ op: 'delete', oldId: 'm_1000000000001' });
      expect(updateOp.oldId).toBe('m_1000000000000');
      expect(updateOp.text).toBe('住在上海');
      expect(addOp.text).toBe('入职了Google');
      expect(addOp.importance).toBe(3);
    });

    // ── 去重合并 (dedup merge) ──────────────────────────

    it('ADD with high overlap is auto-merged into existing entry (dedupMerge)', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [{ id: 'm_1000000000000', text: '喜欢吃辣', date: '2026-01-01', source: 'ai_inferred', importance: 2, useCount: 5, lastReferencedAt: '2026-02-20T00:00:00.000Z' }],
        events: [],
      });

      // "最喜欢吃辣" vs "喜欢吃辣": bigram overlap = 3/4 = 0.75 > 0.6
      const result = await mod.applyMemoryOperations([
        { op: 'add', category: 'preferences', text: '最喜欢吃辣', importance: 3 },
      ]);

      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      // 旧条目被替换，只剩 1 条
      expect(written.preferences).toHaveLength(1);
      expect(written.preferences[0].text).toBe('最喜欢吃辣');
      expect(written.preferences[0].id).not.toBe('m_1000000000000');
      // appliedOps 标记 dedupMerge
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0].dedupMerge).toBe(true);
      expect(result.appliedOps[0].op).toBe('update');
      expect(result.appliedOps[0].oldId).toBe('m_1000000000000');
      // importance 取 max(3, 2) = 3
      expect(result.appliedOps[0].importance).toBe(3);
    });

    it('ADD with low overlap is added normally (no dedupMerge)', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [{ id: 'm_1000000000000', text: '喜欢吃辣', date: '2026-01-01', source: 'ai_inferred', importance: 2 }],
        events: [],
      });

      const result = await mod.applyMemoryOperations([
        { op: 'add', category: 'preferences', text: '喜欢用深色主题' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.preferences).toHaveLength(2);
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0].op).toBe('add');
      expect(result.appliedOps[0].dedupMerge).toBeUndefined();
    });

    it('ADD matching entry targeted by same-batch DELETE is not deduped', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [{ id: 'm_1000000000000', text: '喜欢吃辣', date: '2026-01-01', source: 'ai_inferred', importance: 2 }],
        events: [],
      });

      // "最喜欢吃辣" would normally match "喜欢吃辣" (0.75), but m_1000000000000 is in DELETE
      const result = await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_1000000000000' },
        { op: 'add', category: 'preferences', text: '最喜欢吃辣' },
      ]);

      const written = writeMemoryStoreSpy.mock.calls[0][0];
      // DELETE 执行 + ADD 正常新增 = 1 条
      expect(written.preferences).toHaveLength(1);
      expect(written.preferences[0].text).toBe('最喜欢吃辣');
      // ADD 不应被转为 merge
      const addOp = result.appliedOps.find(o => o.op === 'add');
      expect(addOp).toBeDefined();
      expect(addOp.dedupMerge).toBeUndefined();
    });

    it('returns { overLimit: true } when DELETE proceeds despite 50K limit', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const bigStore = {
        version: 1,
        identity: Array.from({ length: 800 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: 'x'.repeat(60),
          date: '2026-01-01',
          source: 'user_stated',
        })),
        preferences: [],
        events: [],
      };
      readMemoryStoreSpy.mockResolvedValue(bigStore);

      const result = await mod.applyMemoryOperations([
        { op: 'delete', targetId: 'm_1000000000000' },
      ]);

      expect(result.overLimit).toBe(true);
      expect(result.appliedOps).toHaveLength(1);
      expect(result.appliedOps[0]).toEqual({ op: 'delete', oldId: 'm_1000000000000' });
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── performDecayCheck ──────────────────────────────────

  describe('performDecayCheck', () => {
    const prompts = require('../lib/prompts');
    let readMemoryStoreSpy;
    let writeMemoryStoreSpy;

    beforeEach(() => {
      readMemoryStoreSpy = vi.spyOn(prompts, 'readMemoryStore');
      writeMemoryStoreSpy = vi.spyOn(prompts, 'writeMemoryStore').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function daysAgo(n) {
      return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    }

    it('does nothing when autoDecay is false', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const result = await mod.performDecayCheck({ memory: { autoDecay: false } });
      expect(result).toEqual({ decayed: [], staled: [] });
      expect(readMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('does nothing when config is null', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const result = await mod.performDecayCheck(null);
      expect(result).toEqual({ decayed: [], staled: [] });
    });

    it('deletes events with importance=1 exceeding idle days', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000001', text: '临时事件', date: daysAgo(40), source: 'ai_inferred', importance: 1, useCount: 0, lastReferencedAt: null, stale: false },
        ],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      expect(result.decayed).toHaveLength(1);
      expect(result.decayed[0].id).toBe('m_1000000000001');
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(0);
    });

    it('marks events with importance>=2 as stale when exceeding idle days', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000002', text: '一般事件', date: daysAgo(40), source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null, stale: false },
        ],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      expect(result.staled).toHaveLength(1);
      expect(result.staled[0].id).toBe('m_1000000000002');
      expect(result.decayed).toHaveLength(0);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(1);
      expect(written.events[0].stale).toBe(true);
    });

    it('marks preferences as stale after 90 days idle', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [
          { id: 'm_1000000000003', text: '喜欢深色主题', date: daysAgo(100), source: 'user_stated', importance: 2, useCount: 0, lastReferencedAt: null, stale: false },
        ],
        events: [],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      expect(result.staled).toHaveLength(1);
      expect(result.staled[0].category).toBe('preferences');
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.preferences[0].stale).toBe(true);
    });

    it('does not touch identity items', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [
          { id: 'm_1000000000004', text: '叫小王', date: daysAgo(200), source: 'user_stated', importance: 3, useCount: 0, lastReferencedAt: null, stale: false },
        ],
        preferences: [],
        events: [],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      expect(result.decayed).toHaveLength(0);
      expect(result.staled).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('does not re-mark already stale items', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000005', text: '已过期', date: daysAgo(60), source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null, stale: true },
        ],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      // Already stale, no new stale entries
      expect(result.staled).toHaveLength(0);
      expect(result.decayed).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('uses lastReferencedAt over date when available', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000006', text: '近期引用', date: daysAgo(60), source: 'ai_inferred', importance: 1, useCount: 3, lastReferencedAt: new Date(Date.now() - 5 * 86400000).toISOString(), stale: false },
        ],
      });

      // date is 60 days old (would decay) but lastReferencedAt is 5 days ago (should not decay)
      const result = await mod.performDecayCheck({ memory: { autoDecay: true, decayIdleDays: 30 } });

      expect(result.decayed).toHaveLength(0);
      expect(result.staled).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('uses default decayIdleDays=30 when not specified', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000007', text: '25天前', date: daysAgo(25), source: 'ai_inferred', importance: 1, useCount: 0, lastReferencedAt: null, stale: false },
        ],
      });

      const result = await mod.performDecayCheck({ memory: { autoDecay: true } });

      // 25 days < 30 default → should NOT decay
      expect(result.decayed).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });
  });

  // ── performPromotionCheck ──────────────────────────────

  describe('performPromotionCheck', () => {
    const prompts = require('../lib/prompts');
    let readMemoryStoreSpy;
    let writeMemoryStoreSpy;

    beforeEach(() => {
      readMemoryStoreSpy = vi.spyOn(prompts, 'readMemoryStore');
      writeMemoryStoreSpy = vi.spyOn(prompts, 'writeMemoryStore').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function daysAgo(n) {
      return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    }

    it('does nothing when autoPromotion is false', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const result = await mod.performPromotionCheck({ memory: { autoPromotion: false } });
      expect(result).toEqual({ promoted: [], demoted: [] });
      expect(readMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('does nothing when config is null', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      const result = await mod.performPromotionCheck(null);
      expect(result).toEqual({ promoted: [], demoted: [] });
    });

    it('promotes events → preferences when useCount and age meet thresholds', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_2000000000001', text: '经常提到的话题', date: daysAgo(15), source: 'ai_inferred', importance: 2, useCount: 5, lastReferencedAt: null },
        ],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true, promotionUseCount: 5, promotionMinDays: 14 } });

      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0]).toEqual({ id: 'm_2000000000001', text: '经常提到的话题', from: 'events', to: 'preferences' });
      expect(result.demoted).toHaveLength(0);
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.events).toHaveLength(0);
      expect(written.preferences).toHaveLength(1);
      expect(written.preferences[0].id).toBe('m_2000000000001');
    });

    it('does not promote events that do not meet thresholds', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_2000000000002', text: '引用不够', date: daysAgo(15), source: 'ai_inferred', importance: 2, useCount: 3, lastReferencedAt: null },
          { id: 'm_2000000000003', text: '天数不够', date: daysAgo(7), source: 'ai_inferred', importance: 2, useCount: 5, lastReferencedAt: null },
        ],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true, promotionUseCount: 5, promotionMinDays: 14 } });

      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('promotes preferences → identity when useCount≥20, age≥60d, importance=3', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [
          { id: 'm_2000000000004', text: '核心身份特征', date: daysAgo(61), source: 'user_stated', importance: 3, useCount: 20, lastReferencedAt: null },
        ],
        events: [],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true } });

      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0]).toEqual({ id: 'm_2000000000004', text: '核心身份特征', from: 'preferences', to: 'identity' });
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.preferences).toHaveLength(0);
      expect(written.identity).toHaveLength(1);
      expect(written.identity[0].id).toBe('m_2000000000004');
    });

    it('does not promote preferences → identity when importance≠3', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [
          { id: 'm_2000000000005', text: '高频但非核心', date: daysAgo(61), source: 'user_stated', importance: 2, useCount: 25, lastReferencedAt: null },
        ],
        events: [],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true } });

      expect(result.promoted).toHaveLength(0);
      // importance≠3 → stays in preferences, not demoted either (useCount=25 > 2)
      expect(result.demoted).toHaveLength(0);
    });

    it('demotes preferences → events when idle>90d and useCount≤2', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [
          { id: 'm_2000000000006', text: '冷门偏好', date: daysAgo(100), source: 'ai_inferred', importance: 2, useCount: 1, lastReferencedAt: null },
        ],
        events: [],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true } });

      expect(result.demoted).toHaveLength(1);
      expect(result.demoted[0]).toEqual({ id: 'm_2000000000006', text: '冷门偏好', from: 'preferences', to: 'events' });
      expect(result.promoted).toHaveLength(0);
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
      const written = writeMemoryStoreSpy.mock.calls[0][0];
      expect(written.preferences).toHaveLength(0);
      expect(written.events).toHaveLength(1);
      expect(written.events[0].id).toBe('m_2000000000006');
    });

    it('does not demote preferences with useCount>2 or recent reference', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [
          { id: 'm_2000000000007', text: 'useCount高', date: daysAgo(100), source: 'ai_inferred', importance: 2, useCount: 3, lastReferencedAt: null },
          { id: 'm_2000000000008', text: '近期引用', date: daysAgo(100), source: 'ai_inferred', importance: 2, useCount: 1, lastReferencedAt: new Date(Date.now() - 10 * 86400000).toISOString() },
        ],
        events: [],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true } });

      expect(result.demoted).toHaveLength(0);
      expect(result.promoted).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('does not write store when no changes', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [{ id: 'm_2000000000009', text: '身份条目', date: daysAgo(200), source: 'user_stated', importance: 3, useCount: 10, lastReferencedAt: null }],
        preferences: [{ id: 'm_2000000000010', text: '正常偏好', date: daysAgo(30), source: 'user_stated', importance: 2, useCount: 5, lastReferencedAt: new Date(Date.now() - 5 * 86400000).toISOString() }],
        events: [{ id: 'm_2000000000011', text: '普通事件', date: daysAgo(5), source: 'ai_inferred', importance: 2, useCount: 1, lastReferencedAt: null }],
      });

      const result = await mod.performPromotionCheck({ memory: { autoPromotion: true, promotionUseCount: 5, promotionMinDays: 14 } });

      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });
  });

  // ── deduplicateAdds (pure function) ─────────────────────

  describe('deduplicateAdds', () => {
    const { deduplicateAdds } = require('../lib/auto-learn');

    const makeStore = (items = {}) => ({
      identity: items.identity || [],
      preferences: items.preferences || [],
      events: items.events || [],
    });

    it('converts ADD to UPDATE when overlap >60% in same category', () => {
      const store = makeStore({
        preferences: [{ id: 'm_100', text: '喜欢吃辣', importance: 2 }],
      });
      // "最喜欢吃辣" vs "喜欢吃辣": bigram overlap = 3/4 = 0.75 > 0.6
      const ops = [{ op: 'add', category: 'preferences', text: '最喜欢吃辣', importance: 1 }];
      const result = deduplicateAdds(ops, store, new Set());

      expect(result).toHaveLength(1);
      expect(result[0].op).toBe('update');
      expect(result[0].targetId).toBe('m_100');
      expect(result[0]._dedupMerge).toBe(true);
      // importance takes max(1, 2) = 2
      expect(result[0].importance).toBe(2);
    });

    it('keeps ADD when overlap ≤60%', () => {
      const store = makeStore({
        preferences: [{ id: 'm_100', text: '喜欢吃辣', importance: 2 }],
      });
      const ops = [{ op: 'add', category: 'preferences', text: '喜欢用深色主题' }];
      const result = deduplicateAdds(ops, store, new Set());

      expect(result).toHaveLength(1);
      expect(result[0].op).toBe('add');
      expect(result[0]._dedupMerge).toBeUndefined();
    });

    it('does not match across categories', () => {
      const store = makeStore({
        identity: [{ id: 'm_100', text: '喜欢吃辣', importance: 2 }],
      });
      // Same text but different category → no match
      const ops = [{ op: 'add', category: 'preferences', text: '喜欢吃辣' }];
      const result = deduplicateAdds(ops, store, new Set());

      expect(result[0].op).toBe('add');
    });

    it('skips entries in explicitTargetIds', () => {
      const store = makeStore({
        preferences: [{ id: 'm_100', text: '喜欢吃辣', importance: 2 }],
      });
      // Would match (0.75) but m_100 is excluded
      const ops = [{ op: 'add', category: 'preferences', text: '最喜欢吃辣' }];
      // m_100 is targeted by a DELETE in same batch
      const result = deduplicateAdds(ops, store, new Set(['m_100']));

      expect(result[0].op).toBe('add');
    });

    it('importance takes max of new and old', () => {
      const store = makeStore({
        identity: [{ id: 'm_100', text: '住在北京', importance: 3 }],
      });
      const ops = [{ op: 'add', category: 'identity', text: '住在北京市', importance: 1 }];
      const result = deduplicateAdds(ops, store, new Set());

      expect(result[0].importance).toBe(3); // max(1, 3)
    });

    it('passes through non-ADD operations unchanged', () => {
      const store = makeStore();
      const ops = [
        { op: 'delete', targetId: 'm_100' },
        { op: 'update', targetId: 'm_200', category: 'identity', text: 'test' },
      ];
      const result = deduplicateAdds(ops, store, new Set());

      expect(result).toEqual(ops);
    });

    it('prevents two similar ADDs from matching the same existing entry', () => {
      const store = makeStore({
        preferences: [{ id: 'm_100', text: '喜欢吃辣', importance: 2 }],
      });
      // 两个 ADD 都与 "喜欢吃辣" 高度相似
      const ops = [
        { op: 'add', category: 'preferences', text: '最喜欢吃辣' },
        { op: 'add', category: 'preferences', text: '很喜欢吃辣' },
      ];
      const result = deduplicateAdds(ops, store, new Set());

      // 第一个应匹配为 merge，第二个应保持 ADD（m_100 已被占用）
      expect(result[0].op).toBe('update');
      expect(result[0]._dedupMerge).toBe(true);
      expect(result[0].targetId).toBe('m_100');
      expect(result[1].op).toBe('add');
      expect(result[1]._dedupMerge).toBeUndefined();
    });
  });

  // ── performReflection ──────────────────────────────────

  describe('performReflection', () => {
    const prompts = require('../lib/prompts');
    let readMemoryStoreSpy;
    let writeMemoryStoreSpy;

    function makeClient(content) {
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content } }],
            }),
          },
        },
      };
    }

    /** Spy on fresh clients module after loadAutoLearn reloads it */
    function spyOnGetClient(mockClient) {
      const freshClients = require('../lib/clients');
      return vi.spyOn(freshClients, 'getClientForModel').mockReturnValue(mockClient);
    }

    beforeEach(() => {
      readMemoryStoreSpy = vi.spyOn(prompts, 'readMemoryStore');
      writeMemoryStoreSpy = vi.spyOn(prompts, 'writeMemoryStore').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('skips when events < 3 and does not call LLM', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000001', text: '事件1', date: '2026-03-01', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000002', text: '事件2', date: '2026-03-01', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
        ],
      });

      const getClientSpy = spyOnGetClient(makeClient(''));

      const result = await mod.performReflection();

      expect(result).toEqual({ insights: [], skipped: 'not_enough_events' });
      expect(getClientSpy).not.toHaveBeenCalled();
    });

    it('returns no_patterns when LLM outputs NONE', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000001', text: '事件1', date: '2026-03-01', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000002', text: '事件2', date: '2026-02-28', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000003', text: '事件3', date: '2026-02-27', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
        ],
      });
      spyOnGetClient(makeClient('NONE'));

      const result = await mod.performReflection();

      expect(result).toEqual({ insights: [], skipped: 'no_patterns' });
      expect(writeMemoryStoreSpy).not.toHaveBeenCalled();
    });

    it('applies ADD insights with importance forced to 3', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000001', text: '在学Python', date: '2026-03-01', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000002', text: '在学Rust', date: '2026-02-28', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000003', text: '在学Go', date: '2026-02-27', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
        ],
      });
      spyOnGetClient(makeClient('- ADD [preferences] [importance:1] 持续关注编程语言学习'));

      const result = await mod.performReflection();

      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].op).toBe('add');
      expect(result.insights[0].text).toBe('持续关注编程语言学习');
      // importance forced to 3 regardless of LLM output
      expect(result.insights[0].importance).toBe(3);
      expect(writeMemoryStoreSpy).toHaveBeenCalledTimes(1);
    });

    it('filters out UPDATE, DELETE, and ADD [events] operations', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: [
          { id: 'm_1000000000001', text: '事件1', date: '2026-03-01', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000002', text: '事件2', date: '2026-02-28', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
          { id: 'm_1000000000003', text: '事件3', date: '2026-02-27', source: 'ai_inferred', importance: 2, useCount: 0, lastReferencedAt: null },
        ],
      });
      spyOnGetClient(makeClient(
        '- UPDATE [m_1000000000001] [events] 更新的事件\n- DELETE [m_1000000000002]\n- ADD [events] 阶段性总结\n- ADD [preferences] 有效洞察'
      ));

      const result = await mod.performReflection();

      // Only ADD [preferences] should survive (UPDATE/DELETE filtered, ADD [events] excluded)
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].text).toBe('有效洞察');
      expect(result.insights[0].importance).toBe(3);
    });

    it('truncates insights exceeding MAX_REFLECT_INSIGHTS (5)', async () => {
      const mod = loadAutoLearn({ OPENAI_API_KEY: 'sk-test' });
      readMemoryStoreSpy.mockResolvedValue({
        version: 1,
        identity: [],
        preferences: [],
        events: Array.from({ length: 10 }, (_, i) => ({
          id: `m_${1000000000000 + i}`,
          text: `事件${i}`,
          date: '2026-03-01',
          source: 'ai_inferred',
          importance: 2,
          useCount: 0,
          lastReferencedAt: null,
        })),
      });
      const lines = Array.from({ length: 8 }, (_, i) =>
        `- ADD [preferences] [importance:2] 洞察${i}`
      ).join('\n');
      spyOnGetClient(makeClient(lines));

      const result = await mod.performReflection();

      // Should be truncated to 5
      expect(result.insights.length).toBeLessThanOrEqual(5);
    });

    it('REFLECT_PROMPT is a non-empty string containing ADD', () => {
      const mod = require('../lib/auto-learn');
      expect(typeof mod.REFLECT_PROMPT).toBe('string');
      expect(mod.REFLECT_PROMPT.length).toBeGreaterThan(0);
      expect(mod.REFLECT_PROMPT).toContain('ADD');
    });
  });
});
