const crypto = require("crypto");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function isLoopbackIp(ip = "") {
  const normalized = ip.replace("::ffff:", "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function readBearerToken(req) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function readCookieToken(req) {
  const cookies = req.get("cookie") || "";
  const match = cookies.match(/(?:^|;\s*)api_token=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return "";
  }
}

function safeTokenCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authMiddleware(req, res, next) {
  if (ADMIN_TOKEN) {
    const token = readBearerToken(req) || readCookieToken(req);
    if (!safeTokenCompare(token, ADMIN_TOKEN)) {
      return res.status(401).json({ error: "Unauthorized. Provide a valid ADMIN_TOKEN." });
    }
    return next();
  }

  if (!isLoopbackIp(req.ip)) {
    console.warn(`[auth] non-local access blocked: ${req.ip}`);
    return res.status(403).json({ error: "Forbidden. Non-local access requires ADMIN_TOKEN." });
  }
  return next();
}

module.exports = {
  ADMIN_TOKEN,
  isLoopbackIp,
  readBearerToken,
  readCookieToken,
  authMiddleware,
};
