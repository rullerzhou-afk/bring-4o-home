vi.mock('../lib/clients', () => ({
  openaiClient: null,
  arkClient: null,
  openrouterClient: null,
  getClientForModel: vi.fn(),
  resolveDefaultModel: vi.fn(() => 'gpt-4o'),
  formatProviderError: vi.fn(),
  DEFAULT_CONFIG: { model: 'gpt-4o', temperature: 1, presence_penalty: 0, frequency_penalty: 0 },
}));

const { isPlainObject, clampNumber, normalizeConfig, getConversationPath } = require('../lib/config');

const DEFAULT_CONFIG = {
  model: 'gpt-4o',
  temperature: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
};

describe('isPlainObject', () => {
  it('{} -> true', () => {
    expect(isPlainObject({})).toBe(true);
  });

  it('[] -> false', () => {
    expect(isPlainObject([])).toBe(false);
  });

  it('null -> false', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('undefined -> false', () => {
    expect(isPlainObject(undefined)).toBe(false);
  });

  it('"string" -> false', () => {
    expect(isPlainObject('string')).toBe(false);
  });

  it('123 -> false', () => {
    expect(isPlainObject(123)).toBe(false);
  });

  it('new Date() -> true', () => {
    expect(isPlainObject(new Date())).toBe(true);
  });
});

describe('clampNumber', () => {
  it('returns value when in range', () => {
    expect(clampNumber(5, 0, 10, 0)).toBe(5);
  });

  it('returns max when exceeds upper bound', () => {
    expect(clampNumber(11, 0, 10, 0)).toBe(10);
  });

  it('returns min when below lower bound', () => {
    expect(clampNumber(-1, 0, 10, 0)).toBe(0);
  });

  it('returns fallback for undefined', () => {
    expect(clampNumber(undefined, 0, 10, 7)).toBe(7);
  });

  it('returns fallback for NaN', () => {
    expect(clampNumber(NaN, 0, 10, 7)).toBe(7);
  });

  it('returns fallback for non-number', () => {
    expect(clampNumber('5', 0, 10, 7)).toBe(7);
  });

  it('returns value at boundary (min and max)', () => {
    expect(clampNumber(0, 0, 10, 7)).toBe(0);
    expect(clampNumber(10, 0, 10, 7)).toBe(10);
  });
});

describe('normalizeConfig', () => {
  it('returns DEFAULT_CONFIG values for empty object', () => {
    expect(normalizeConfig({})).toEqual({
      ...DEFAULT_CONFIG,
      context_window: 50,
    });
  });

  it('preserves valid complete config', () => {
    const input = {
      model: 'gpt-4o-mini',
      temperature: 1.5,
      presence_penalty: 1,
      frequency_penalty: -1,
      context_window: 120,
      top_p: 0.8,
    };
    expect(normalizeConfig(input)).toEqual(input);
  });

  it('falls back to default model for empty string', () => {
    expect(normalizeConfig({ model: '' }).model).toBe(DEFAULT_CONFIG.model);
  });

  it('falls back to default model for whitespace-only string', () => {
    expect(normalizeConfig({ model: '   ' }).model).toBe(DEFAULT_CONFIG.model);
  });

  it('trims model string', () => {
    expect(normalizeConfig({ model: '  gpt-4o-mini  ' }).model).toBe('gpt-4o-mini');
  });

  it('clamps temperature to [0, 2]', () => {
    expect(normalizeConfig({ temperature: 3 }).temperature).toBe(2);
    expect(normalizeConfig({ temperature: -1 }).temperature).toBe(0);
  });

  it('excludes top_p when undefined', () => {
    const result = normalizeConfig({ top_p: undefined });
    expect('top_p' in result).toBe(false);
  });

  it('includes top_p when valid', () => {
    const result = normalizeConfig({ top_p: 0.6 });
    expect(result.top_p).toBe(0.6);
  });

  it('defaults context_window to 50', () => {
    expect(normalizeConfig({}).context_window).toBe(50);
  });
});

describe('getConversationPath', () => {
  it('returns path for 10-digit id', () => {
    const result = getConversationPath('1234567890');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/1234567890\.json$/);
  });

  it('returns path for 16-digit id', () => {
    const result = getConversationPath('1234567890123456');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/1234567890123456\.json$/);
  });

  it('returns null for 9-digit id', () => {
    expect(getConversationPath('123456789')).toBeNull();
  });

  it('returns null for 17-digit id', () => {
    expect(getConversationPath('12345678901234567')).toBeNull();
  });

  it('returns null for id with letters', () => {
    expect(getConversationPath('12345abcde')).toBeNull();
  });

  it('returns null for null or undefined', () => {
    expect(getConversationPath(null)).toBeNull();
    expect(getConversationPath(undefined)).toBeNull();
  });
});
