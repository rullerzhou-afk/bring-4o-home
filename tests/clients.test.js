const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ARK_API_KEY',
  'ARK_BASE_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_SITE_URL',
  'OPENROUTER_APP_NAME',
  'MODEL',
];

const ORIGINAL_ENV = {};
for (const k of ENV_KEYS) {
  ORIGINAL_ENV[k] = process.env[k];
}

function loadClients(envOverrides = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  const resolved = require.resolve('../lib/clients');
  delete require.cache[resolved];
  return require('../lib/clients');
}

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('lib/clients', () => {
  describe('client creation', () => {
    it('creates only openaiClient when OPENAI_API_KEY is set', () => {
      const { openaiClient, arkClient, openrouterClient } = loadClients({
        OPENAI_API_KEY: 'sk-test',
      });
      expect(openaiClient).not.toBeNull();
      expect(arkClient).toBeNull();
      expect(openrouterClient).toBeNull();
    });

    it('creates only arkClient when ARK_API_KEY is set', () => {
      const { openaiClient, arkClient, openrouterClient } = loadClients({
        ARK_API_KEY: 'ark-test',
      });
      expect(openaiClient).toBeNull();
      expect(arkClient).not.toBeNull();
      expect(openrouterClient).toBeNull();
    });

    it('creates only openrouterClient when OPENROUTER_API_KEY is set', () => {
      const { openaiClient, arkClient, openrouterClient } = loadClients({
        OPENROUTER_API_KEY: 'or-test',
      });
      expect(openaiClient).toBeNull();
      expect(arkClient).toBeNull();
      expect(openrouterClient).not.toBeNull();
    });

    it('creates all three clients when all keys are set', () => {
      const { openaiClient, arkClient, openrouterClient } = loadClients({
        OPENAI_API_KEY: 'sk-test',
        ARK_API_KEY: 'ark-test',
        OPENROUTER_API_KEY: 'or-test',
      });
      expect(openaiClient).not.toBeNull();
      expect(arkClient).not.toBeNull();
      expect(openrouterClient).not.toBeNull();
    });

    it('calls process.exit(1) when no API keys are configured', () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => {});
      loadClients({});
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  describe('getClientForModel', () => {
    it('returns openrouterClient for models containing "/"', () => {
      const mod = loadClients({
        OPENAI_API_KEY: 'sk-test',
        OPENROUTER_API_KEY: 'or-test',
      });
      const client = mod.getClientForModel('anthropic/claude-3.5-sonnet');
      expect(client).toBe(mod.openrouterClient);
    });

    it('throws when openrouterClient is not configured for "/" model', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(() => mod.getClientForModel('openai/gpt-4o')).toThrow(
        '未配置 OPENROUTER_API_KEY'
      );
    });

    it('returns openaiClient for gpt models', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.getClientForModel('gpt-4o')).toBe(mod.openaiClient);
      expect(mod.getClientForModel('gpt-4o-mini')).toBe(mod.openaiClient);
    });

    it('returns openaiClient for GPT models (case-insensitive)', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.getClientForModel('GPT-4o')).toBe(mod.openaiClient);
    });

    it('returns openaiClient for o-series models', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.getClientForModel('o3-mini')).toBe(mod.openaiClient);
    });

    it('returns openaiClient for chatgpt models', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.getClientForModel('chatgpt-4o-latest')).toBe(
        mod.openaiClient
      );
    });

    it('throws when openaiClient is not configured for OpenAI model', () => {
      const mod = loadClients({ ARK_API_KEY: 'ark-test' });
      expect(() => mod.getClientForModel('gpt-4o')).toThrow(
        '未配置 OPENAI_API_KEY'
      );
    });

    it('returns arkClient for non-OpenAI non-slash models', () => {
      const mod = loadClients({ ARK_API_KEY: 'ark-test' });
      expect(mod.getClientForModel('glm-4-plus')).toBe(mod.arkClient);
      expect(mod.getClientForModel('doubao-1-5-lite-32k')).toBe(
        mod.arkClient
      );
    });

    it('throws when arkClient is not configured for ark model', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(() => mod.getClientForModel('glm-4-plus')).toThrow(
        '未配置 ARK_API_KEY'
      );
    });
  });

  describe('resolveDefaultModel', () => {
    it('returns MODEL env var when set', () => {
      const mod = loadClients({
        OPENAI_API_KEY: 'sk-test',
        MODEL: 'custom-model',
      });
      expect(mod.resolveDefaultModel()).toBe('custom-model');
    });

    it('returns gpt-4o when openaiClient is available', () => {
      const mod = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(mod.resolveDefaultModel()).toBe('gpt-4o');
    });

    it('returns openai/gpt-4o-mini when only openrouterClient is available', () => {
      const mod = loadClients({ OPENROUTER_API_KEY: 'or-test' });
      expect(mod.resolveDefaultModel()).toBe('openai/gpt-4o-mini');
    });

    it('returns doubao model when only arkClient is available', () => {
      const mod = loadClients({ ARK_API_KEY: 'ark-test' });
      expect(mod.resolveDefaultModel()).toBe('doubao-1-5-lite-32k-250115');
    });
  });

  describe('formatProviderError', () => {
    // Pure function — load once with setup.js env
    const { formatProviderError } = require('../lib/clients');

    it('formats error with status, code, and message', () => {
      const result = formatProviderError({
        status: 429,
        code: 'rate_limit_exceeded',
        message: 'Too many requests',
      });
      expect(result).toBe(
        'HTTP 429 | code=rate_limit_exceeded | Too many requests'
      );
    });

    it('formats error with nested error object', () => {
      const result = formatProviderError({
        status: 400,
        error: { code: 'invalid_request', message: 'Bad input' },
      });
      expect(result).toBe('HTTP 400 | code=invalid_request | Bad input');
    });

    it('formats error with only message', () => {
      const result = formatProviderError({
        message: 'Something went wrong',
      });
      expect(result).toBe('Something went wrong');
    });

    it('formats error with response.status', () => {
      const result = formatProviderError({
        response: { status: 502 },
        message: 'Bad gateway',
      });
      expect(result).toBe('HTTP 502 | Bad gateway');
    });

    it('handles empty error object', () => {
      expect(formatProviderError({})).toBe('Unknown server error');
    });

    it('handles null error', () => {
      expect(formatProviderError(null)).toBe('Unknown server error');
    });

    it('handles undefined error', () => {
      expect(formatProviderError(undefined)).toBe('Unknown server error');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('includes expected default fields with openai', () => {
      const { DEFAULT_CONFIG } = loadClients({ OPENAI_API_KEY: 'sk-test' });
      expect(DEFAULT_CONFIG).toEqual({
        model: 'gpt-4o',
        temperature: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
      });
    });

    it('uses MODEL env var for default config model', () => {
      const { DEFAULT_CONFIG } = loadClients({
        OPENAI_API_KEY: 'sk-test',
        MODEL: 'gpt-4.1-mini',
      });
      expect(DEFAULT_CONFIG.model).toBe('gpt-4.1-mini');
    });
  });
});
