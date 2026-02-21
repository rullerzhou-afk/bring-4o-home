const ORIGINAL_SERPER_KEY = process.env.SERPER_API_KEY;

function loadSearch(apiKey) {
  if (apiKey === undefined) {
    delete process.env.SERPER_API_KEY;
  } else {
    process.env.SERPER_API_KEY = apiKey;
  }
  const resolved = require.resolve('../lib/search');
  delete require.cache[resolved];
  return require('../lib/search');
}

afterAll(() => {
  if (ORIGINAL_SERPER_KEY === undefined) {
    delete process.env.SERPER_API_KEY;
  } else {
    process.env.SERPER_API_KEY = ORIGINAL_SERPER_KEY;
  }
});

describe('lib/search', () => {
  describe('constants', () => {
    it('exports SEARCH_TOOL with correct structure', () => {
      const { SEARCH_TOOL } = loadSearch(undefined);
      expect(SEARCH_TOOL.type).toBe('function');
      expect(SEARCH_TOOL.function.name).toBe('web_search');
      expect(SEARCH_TOOL.function.parameters.required).toContain('query');
    });

    it('exports MAX_TOOL_ROUNDS as 3', () => {
      const { MAX_TOOL_ROUNDS } = loadSearch(undefined);
      expect(MAX_TOOL_ROUNDS).toBe(3);
    });
  });

  describe('executeWebSearch', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns not-configured message when SERPER_API_KEY is missing', async () => {
      const { executeWebSearch } = loadSearch(undefined);
      const result = await executeWebSearch('test');
      expect(result).toBe(
        'Search is not configured on the server (missing SERPER_API_KEY).'
      );
    });

    it('returns formatted results on successful search', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            organic: [
              {
                title: 'Title 1',
                link: 'https://example.com/1',
                snippet: 'Snippet 1',
              },
              {
                title: 'Title 2',
                link: 'https://example.com/2',
                snippet: 'Snippet 2',
              },
            ],
          }),
      });

      const result = await executeWebSearch('test query');

      expect(result).toContain('Search results for "test query"');
      expect(result).toContain('1. Title 1');
      expect(result).toContain('https://example.com/1');
      expect(result).toContain('Snippet 1');
      expect(result).toContain('2. Title 2');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-API-KEY': 'test-key' }),
        })
      );
    });

    it('returns no-results message when organic array is empty', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ organic: [] }),
      });

      const result = await executeWebSearch('obscure query');
      expect(result).toBe('No results found for: obscure query');
    });

    it('returns no-results message when organic is missing', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await executeWebSearch('obscure query');
      expect(result).toBe('No results found for: obscure query');
    });

    it('returns error message when API returns non-200 status', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      const result = await executeWebSearch('query');
      expect(result).toBe('Serper API error (429): Rate limit exceeded');
    });

    it('truncates long error text from API', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      const longError = 'x'.repeat(300);
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(longError),
      });

      const result = await executeWebSearch('query');
      expect(result).toContain('Serper API error (500):');
      // errText.slice(0, 200) → 200 chars
      expect(result).toBe('Serper API error (500): ' + 'x'.repeat(200));
    });

    it('handles error text read failure gracefully', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('read error')),
      });

      const result = await executeWebSearch('query');
      expect(result).toBe('Serper API error (503): ');
    });

    it('returns failure message when fetch throws', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await executeWebSearch('query');
      expect(result).toBe('Search failed: Network timeout');
    });

    it('handles results without snippet', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            organic: [{ title: 'No Snippet', link: 'https://example.com' }],
          }),
      });

      const result = await executeWebSearch('query');
      expect(result).toContain('1. No Snippet');
      expect(result).toContain('https://example.com');
    });

    it('sends correct request body', async () => {
      const { executeWebSearch } = loadSearch('test-key');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ organic: [] }),
      });

      await executeWebSearch('hello world');

      const [, opts] = global.fetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.q).toBe('hello world');
      expect(body.num).toBe(5);
      expect(body.hl).toBe('zh-cn');
    });
  });
});
