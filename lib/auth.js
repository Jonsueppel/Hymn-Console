const crypto = require("node:crypto");

const SESSION_COOKIE = "hymn_console_session";
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const attempts = new Map();

function normalizeUsername(value) {
  return String(value || "").trim();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) {
    throw httpError(400, "Username must be 3-32 characters using letters, numbers, periods, dashes, or underscores.");
  }
  return username;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 10 || password.length > 128) {
    throw httpError(400, "Password must be between 10 and 128 characters.");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw httpError(400, "Password must contain at least one letter and one number.");
  }
  return password;
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(secret), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString("hex");
  return { hash, salt };
}

function verifySecret(secret, expectedHash, salt) {
  if (!expectedHash || !salt) return false;
  const actual = hashSecret(secret, salt).hash;
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expectedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createRecoveryCode() {
  return crypto.randomBytes(12).toString("hex").toUpperCase().match(/.{1,4}/g).join("-");
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function requestAddress(req) {
  return String(req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

function secureRequest(req) {
  return Boolean(req.socket?.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
}

function sessionCookie(token, req, maxAge = SESSION_HOURS * 60 * 60) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (secureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(req) {
  return sessionCookie("", req, 0);
}

function loginKey(req, username) {
  return `${requestAddress(req)}:${normalizeUsername(username).toLowerCase()}`;
}

function assertLoginAllowed(req, username) {
  const key = loginKey(req, username);
  const now = Date.now();
  const state = attempts.get(key);
  if (!state) return;
  if (state.blockedUntil > now) {
    const seconds = Math.ceil((state.blockedUntil - now) / 1000);
    throw httpError(429, `Too many login attempts. Try again in ${seconds} seconds.`);
  }
  if (now - state.windowStarted > LOGIN_WINDOW_MS) attempts.delete(key);
}

function recordLoginFailure(req, username) {
  const key = loginKey(req, username);
  const now = Date.now();
  const current = attempts.get(key);
  const state = !current || now - current.windowStarted > LOGIN_WINDOW_MS
    ? { count: 0, windowStarted: now, blockedUntil: 0 }
    : current;
  state.count += 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) state.blockedUntil = now + LOGIN_BLOCK_MS;
  attempts.set(key, state);
}

function clearLoginFailures(req, username) {
  attempts.delete(loginKey(req, username));
}

function createSession(storage, req, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  storage.createSession({
    tokenHash: tokenHash(token),
    userId: user.id,
    expiresAt,
    address: requestAddress(req),
    userAgent: req.headers["user-agent"] || ""
  });
  return { token, expiresAt };
}

function sessionFromRequest(storage, req, { touch = true } = {}) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = storage.getSession(tokenHash(token));
  if (!session) return null;
  if (session.disabled || new Date(session.expires_at).getTime() <= Date.now()) {
    storage.deleteSession(tokenHash(token));
    return null;
  }
  if (touch) storage.touchSession(tokenHash(token));
  const permissions = storage.parseJsonArrayField(session.permissions_json, `Stored session permissions for user ${session.user_id}`);
  return {
    tokenHash: tokenHash(token),
    userId: session.user_id,
    username: session.username,
    role: session.role,
    builtIn: Boolean(session.built_in),
    permissions,
    expiresAt: session.expires_at
  };
}

function requireSession(storage, req) {
  const session = sessionFromRequest(storage, req);
  if (!session) throw httpError(401, "Sign in to continue.");
  return session;
}

function requireRole(storage, req, role) {
  const session = requireSession(storage, req);
  if (role === "admin" && session.role !== "admin") {
    throw httpError(403, "Administrator access required.");
  }
  return session;
}

function hasPermission(session, permission) {
  return Boolean(session && (session.role === "admin" || session.permissions?.includes(permission)));
}

function requirePermission(storage, req, permission) {
  const session = req.auth || requireSession(storage, req);
  if (!hasPermission(session, permission)) throw httpError(403, "Your account does not have permission for this feature.");
  return session;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  SESSION_COOKIE,
  normalizeUsername,
  validateUsername,
  validatePassword,
  hashSecret,
  verifySecret,
  createRecoveryCode,
  requestAddress,
  sessionCookie,
  clearSessionCookie,
  assertLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  createSession,
  sessionFromRequest,
  requireSession,
  requireRole,
  hasPermission,
  requirePermission,
  httpError
};
