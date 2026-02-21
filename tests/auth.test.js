const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function loadAuthWithAdminToken(mode, token) {
  if (mode === 'delete') {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = token;
  }
  // vi.resetModules() doesn't reliably clear CJS cache in Vitest v4
  const resolved = require.resolve('../lib/auth');
  delete require.cache[resolved];
  return require('../lib/auth');
}

function createReq({ authorization, ip = '127.0.0.1' } = {}) {
  return {
    ip,
    get: (header) => {
      if (!header) return undefined;
      if (header.toLowerCase() === 'authorization') return authorization;
      return undefined;
    },
  };
}

function createRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  if (typeof ORIGINAL_ADMIN_TOKEN === 'undefined') {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  }
  vi.resetModules();
});

describe('isLoopbackIp', () => {
  it('returns true for 127.0.0.1', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
  });

  it('returns true for ::1', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('::1')).toBe(true);
  });

  it('returns true for ::ffff:127.0.0.1', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('returns false for 192.168.1.1', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('192.168.1.1')).toBe(false);
  });

  it('returns false for empty string', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('')).toBe(false);
  });

  it('returns false for 10.0.0.1', () => {
    const { isLoopbackIp } = loadAuthWithAdminToken('delete');
    expect(isLoopbackIp('10.0.0.1')).toBe(false);
  });
});

describe('readBearerToken', () => {
  it('parses standard Bearer token', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: 'Bearer test-token' });
    expect(readBearerToken(req)).toBe('test-token');
  });

  it('parses bearer token case-insensitively', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: 'bearer test-token' });
    expect(readBearerToken(req)).toBe('test-token');
  });

  it('returns empty string when Authorization header is missing', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: undefined });
    expect(readBearerToken(req)).toBe('');
  });

  it('returns empty string for non-Bearer scheme', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: 'Basic abc' });
    expect(readBearerToken(req)).toBe('');
  });

  it('returns empty string for Bearer prefix without value', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: 'Bearer ' });
    expect(readBearerToken(req)).toBe('');
  });

  it('parses token when multiple spaces exist after Bearer', () => {
    const { readBearerToken } = loadAuthWithAdminToken('delete');
    const req = createReq({ authorization: 'Bearer  test-token' });
    expect(readBearerToken(req)).toBe('test-token');
  });
});

describe('authMiddleware', () => {
  describe('when ADMIN_TOKEN is set', () => {
    it('calls next() when token matches', () => {
      const { authMiddleware } = loadAuthWithAdminToken('set', 'secret123');
      const req = createReq({ authorization: 'Bearer secret123', ip: '192.168.1.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when token does not match', () => {
      const { authMiddleware } = loadAuthWithAdminToken('set', 'secret123');
      const req = createReq({ authorization: 'Bearer wrong-token', ip: '192.168.1.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalled();
    });

    it('returns 401 when token is missing', () => {
      const { authMiddleware } = loadAuthWithAdminToken('set', 'secret123');
      const req = createReq({ authorization: undefined, ip: '192.168.1.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('when ADMIN_TOKEN is unset', () => {
    it('calls next() for loopback IP', () => {
      const { authMiddleware } = loadAuthWithAdminToken('delete');
      const req = createReq({ ip: '127.0.0.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 for non-loopback IP', () => {
      const { authMiddleware } = loadAuthWithAdminToken('delete');
      const req = createReq({ ip: '192.168.1.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
    });

    it('treats empty ADMIN_TOKEN as unset', () => {
      const { authMiddleware } = loadAuthWithAdminToken('set', '');
      const req = createReq({ ip: '192.168.1.1' });
      const res = createRes();
      const next = vi.fn();

      authMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
