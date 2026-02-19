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

function authMiddleware(req, res, next) {
  if (ADMIN_TOKEN) {
    const token = readBearerToken(req);
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ error: "Unauthorized. Provide a valid ADMIN_TOKEN." });
    }
    return next();
  }

  if (!isLoopbackIp(req.ip)) {
    return res
      .status(403)
      .json({ error: `Forbidden for non-local access from ${req.ip}. Set ADMIN_TOKEN to enable remote access.` });
  }
  return next();
}

module.exports = {
  ADMIN_TOKEN,
  isLoopbackIp,
  readBearerToken,
  authMiddleware,
};
