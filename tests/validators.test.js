vi.mock('../lib/clients', () => ({
  openaiClient: null,
  arkClient: null,
  openrouterClient: null,
  getClientForModel: vi.fn(),
  resolveDefaultModel: vi.fn(() => 'gpt-4o'),
  formatProviderError: vi.fn(),
  DEFAULT_CONFIG: { model: 'gpt-4o', temperature: 1, presence_penalty: 0, frequency_penalty: 0 },
}));

const {
  validatePromptPatch,
  validateConfigPatch,
  validateConversation,
  validateMessages,
} = require('../lib/validators');

function makeConversation(overrides = {}) {
  return {
    id: '1234567890',
    title: 'Test Title',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

describe('validatePromptPatch', () => {
  it.each([null, [], 'abc'])('returns ok:false for non-object input: %p', (input) => {
    const result = validatePromptPatch(input);
    expect(result).toEqual({ ok: false, error: 'Request body must be an object.' });
  });

  it('returns error when system is not string', () => {
    expect(validatePromptPatch({ system: 1 })).toEqual({
      ok: false,
      error: '`system` must be a string.',
    });
  });

  it('returns error when system exceeds 200000 chars', () => {
    expect(validatePromptPatch({ system: 'a'.repeat(200001) })).toEqual({
      ok: false,
      error: '`system` is too large.',
    });
  });

  it('returns error when memory is not string', () => {
    expect(validatePromptPatch({ memory: 1 })).toEqual({
      ok: false,
      error: '`memory` must be a string.',
    });
  });

  it('returns error when memory exceeds 200000 chars', () => {
    expect(validatePromptPatch({ memory: 'a'.repeat(200001) })).toEqual({
      ok: false,
      error: '`memory` is too large.',
    });
  });

  it('returns ok:true with both system and memory', () => {
    expect(validatePromptPatch({ system: 'sys', memory: 'mem' })).toEqual({
      ok: true,
      value: { system: 'sys', memory: 'mem' },
    });
  });

  it('returns value with only system when only system provided', () => {
    expect(validatePromptPatch({ system: 'sys' })).toEqual({
      ok: true,
      value: { system: 'sys' },
    });
  });

  it('returns empty value object for empty input object', () => {
    expect(validatePromptPatch({})).toEqual({
      ok: true,
      value: {},
    });
  });
});

describe('validateConfigPatch', () => {
  it.each([null, [], 'abc'])('returns error for non-object input: %p', (input) => {
    expect(validateConfigPatch(input)).toEqual({
      ok: false,
      error: 'Request body must be an object.',
    });
  });

  it('returns error for unknown field', () => {
    expect(validateConfigPatch({ foo: 1 })).toEqual({
      ok: false,
      error: 'Unknown config field: foo',
    });
  });

  it('returns error when model is empty string', () => {
    expect(validateConfigPatch({ model: '   ' })).toEqual({
      ok: false,
      error: '`model` must be a non-empty string (max 120 chars).',
    });
  });

  it('returns error when model exceeds 120 chars', () => {
    expect(validateConfigPatch({ model: 'a'.repeat(121) })).toEqual({
      ok: false,
      error: '`model` must be a non-empty string (max 120 chars).',
    });
  });

  it('returns ok:true and trims model', () => {
    expect(validateConfigPatch({ model: '  gpt-4o-mini  ' })).toEqual({
      ok: true,
      value: { model: 'gpt-4o-mini' },
    });
  });

  it.each([-0.01, 2.01])('returns error when temperature out of range: %p', (temperature) => {
    expect(validateConfigPatch({ temperature })).toEqual({
      ok: false,
      error: '`temperature` must be in range [0, 2].',
    });
  });

  it('returns error when temperature is NaN', () => {
    expect(validateConfigPatch({ temperature: Number.NaN })).toEqual({
      ok: false,
      error: '`temperature` must be a number.',
    });
  });

  it.each([0, 2])('accepts temperature boundary value: %p', (temperature) => {
    expect(validateConfigPatch({ temperature })).toEqual({
      ok: true,
      value: { temperature },
    });
  });

  it.each([3, 501])('returns error when context_window out of range: %p', (context_window) => {
    expect(validateConfigPatch({ context_window })).toEqual({
      ok: false,
      error: '`context_window` must be in range [4, 500].',
    });
  });

  it.each([4, 500])('accepts context_window boundary value: %p', (context_window) => {
    expect(validateConfigPatch({ context_window })).toEqual({
      ok: true,
      value: { context_window },
    });
  });

  it('returns ok:true for empty object', () => {
    expect(validateConfigPatch({})).toEqual({
      ok: true,
      value: {},
    });
  });
});

describe('validateConversation', () => {
  it.each([null, [], 'abc'])('returns error for non-object input: %p', (input) => {
    expect(validateConversation(input)).toEqual({
      ok: false,
      error: 'Request body must be an object.',
    });
  });

  it.each(['123456789', '12345678901234567', '12345abcde'])(
    'returns error for invalid id format: %p',
    (id) => {
      expect(validateConversation(makeConversation({ id }))).toEqual({
        ok: false,
        error: '`id` must be a numeric string (10-16 digits).',
      });
    }
  );

  it.each(['1234567890', '1234567890123456'])('accepts valid id length: %p', (id) => {
    const result = validateConversation(makeConversation({ id }));
    expect(result.ok).toBe(true);
    expect(result.value).toBeDefined();
    expect(result.value.id).toBe(id);
  });

  it('returns error when title exceeds 200 chars', () => {
    expect(validateConversation(makeConversation({ title: 'a'.repeat(201) }))).toEqual({
      ok: false,
      error: '`title` must be a string (max 200 chars).',
    });
  });

  it('returns error when messages exceed 500 items', () => {
    expect(
      validateConversation(
        makeConversation({
          messages: Array.from({ length: 501 }, () => ({ role: 'user', content: 'x' })),
        })
      )
    ).toEqual({
      ok: false,
      error: '`messages` must be an array (max 500 items).',
    });
  });

  it('returns error when message role is invalid', () => {
    expect(
      validateConversation(makeConversation({ messages: [{ role: 'tool', content: 'x' }] }))
    ).toEqual({
      ok: false,
      error: 'Invalid role: tool',
    });
  });

  it('returns error when string content exceeds 30000 chars', () => {
    const result = validateConversation(
      makeConversation({ messages: [{ role: 'user', content: 'a'.repeat(30001) }] })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content.*too large/i);
  });

  it('returns error when text part exceeds 10000 chars', () => {
    const result = validateConversation(
      makeConversation({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'a'.repeat(10001) }],
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/text content part/i);
  });

  it('returns error when image_url part has invalid URL format', () => {
    const hugeUrl = 'x'.repeat(8000001);
    const result = validateConversation(
      makeConversation({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'image_url', image_url: { url: hugeUrl } }],
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
  });

  it('returns ok:true with normalized value for valid conversation', () => {
    const result = validateConversation(
      makeConversation({
        id: '1234567890123456',
        title: 'Valid Conversation',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'response' },
              { type: 'image_url', image_url: { url: '/images/a.png' } },
            ],
          },
        ],
      })
    );
    expect(result.ok).toBe(true);
    expect(result.value.id).toBe('1234567890123456');
    expect(result.value.title).toBe('Valid Conversation');
    expect(result.value.messages).toHaveLength(3);
    // 验证消息被规范化（只保留 role + content）
    expect(result.value.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });
});

describe('validateMessages', () => {
  it.each([null, {}, 'abc'])('returns error for non-array input: %p', (input) => {
    expect(validateMessages(input)).toEqual({
      ok: false,
      error: '`messages` must be an array.',
    });
  });

  it('returns error for empty array', () => {
    expect(validateMessages([])).toEqual({
      ok: false,
      error: '`messages` length must be between 1 and 500.',
    });
  });

  it('returns error when messages exceed 500 items', () => {
    const messages = Array.from({ length: 501 }, () => ({ role: 'user', content: 'x' }));
    expect(validateMessages(messages)).toEqual({
      ok: false,
      error: '`messages` length must be between 1 and 500.',
    });
  });

  it('returns error for invalid role', () => {
    expect(validateMessages([{ role: 'tool', content: 'x' }])).toEqual({
      ok: false,
      error: 'Invalid role: tool',
    });
  });

  it('returns error when string content exceeds 30000 chars', () => {
    expect(validateMessages([{ role: 'user', content: 'a'.repeat(30001) }])).toEqual({
      ok: false,
      error: 'Message content is too large.',
    });
  });

  it('returns error when system role uses array content', () => {
    expect(
      validateMessages([{ role: 'system', content: [{ type: 'text', text: 'x' }] }])
    ).toEqual({
      ok: false,
      error: 'Only user/assistant messages can have multi-part content.',
    });
  });

  it('returns error when array content is empty', () => {
    expect(validateMessages([{ role: 'user', content: [] }])).toEqual({
      ok: false,
      error: 'Multi-part content length must be between 1 and 10.',
    });
  });

  it('returns error when array content exceeds 10 parts', () => {
    const content = Array.from({ length: 11 }, () => ({ type: 'text', text: 'x' }));
    expect(validateMessages([{ role: 'user', content }])).toEqual({
      ok: false,
      error: 'Multi-part content length must be between 1 and 10.',
    });
  });

  it('returns error when text part exceeds 10000 chars', () => {
    expect(
      validateMessages([
        { role: 'user', content: [{ type: 'text', text: 'a'.repeat(10001) }] },
      ])
    ).toEqual({
      ok: false,
      error: 'Text content part is invalid.',
    });
  });

  it('accepts image_url data URL', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
      },
    ];
    expect(validateMessages(messages)).toEqual({
      ok: true,
      value: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
        },
      ],
    });
  });

  it('accepts image_url server path', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'image_url', image_url: { url: '/images/avatar.png' } }],
      },
    ];
    expect(validateMessages(messages)).toEqual({
      ok: true,
      value: [
        {
          role: 'assistant',
          content: [{ type: 'image_url', image_url: { url: '/images/avatar.png' } }],
        },
      ],
    });
  });

  it('returns error for external image link', () => {
    expect(
      validateMessages([
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
        },
      ])
    ).toEqual({
      ok: false,
      error: 'Image must be a data URL or server path.',
    });
  });

  it('returns error for image_url path traversal', () => {
    expect(
      validateMessages([
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: '/images/../secret.png' } }],
        },
      ])
    ).toEqual({
      ok: false,
      error: 'Image must be a data URL or server path.',
    });
  });

  it('returns error when data URL exceeds 8MB', () => {
    const hugeDataUrl = `data:image/png;base64,${'a'.repeat(8000001)}`;
    expect(
      validateMessages([
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: hugeDataUrl } }],
        },
      ])
    ).toEqual({
      ok: false,
      error: 'Image content part is too large.',
    });
  });

  it('returns error for unsupported content part type', () => {
    expect(
      validateMessages([
        {
          role: 'user',
          content: [{ type: 'audio', audio_url: { url: '/images/a.wav' } }],
        },
      ])
    ).toEqual({
      ok: false,
      error: 'Unsupported content part type: audio',
    });
  });

  it('returns error when content is neither string nor array', () => {
    expect(validateMessages([{ role: 'user', content: 123 }])).toEqual({
      ok: false,
      error: 'Message content must be string or array.',
    });
  });

  it('returns normalized value for valid messages', () => {
    const input = [
      { role: 'system', content: 'system prompt', ignored: true },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello', extra: 'x' },
          { type: 'image_url', image_url: { url: '/images/pic.png', foo: 'bar' }, extra: 'y' },
        ],
        another: 'field',
      },
      { role: 'assistant', content: 'done' },
    ];

    expect(validateMessages(input)).toEqual({
      ok: true,
      value: [
        { role: 'system', content: 'system prompt' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image_url', image_url: { url: '/images/pic.png' } },
          ],
        },
        { role: 'assistant', content: 'done' },
      ],
    });
  });
});
