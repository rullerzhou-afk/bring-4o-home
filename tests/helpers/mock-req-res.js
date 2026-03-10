/**
 * Express req/res mock factory for route handler unit tests.
 */

function createReq({ body, params, query, file } = {}) {
  return {
    body: body || {},
    params: params || {},
    query: query || {},
    file: file || undefined,
    on() {},  // stub for event listeners (e.g. req.on('close', ...))
  };
}

function createRes() {
  const res = {
    _status: 200,
    _json: null,
    status(code) {
      res._status = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
  };
  return res;
}

module.exports = { createReq, createRes };
