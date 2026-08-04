const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'fintrack_session';
const DEFAULT_SESSION_TTL_HOURS = 12;
const MAX_SESSION_TTL_HOURS = 24 * 30;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const HASH_DOMAIN = 'outflow-session-token-v1\0';

function parsePositiveNumber(value, name, { defaultValue, maximum }) {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive number no greater than ${maximum}`);
  }
  return parsed;
}

function parseTrustProxyHops(value) {
  if (value === undefined || value === '') return 0;
  if (!/^\d+$/.test(String(value))) {
    throw new Error('OUTFLOW_TRUST_PROXY_HOPS must be a non-negative integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 16) {
    throw new Error('OUTFLOW_TRUST_PROXY_HOPS must be no greater than 16');
  }
  return parsed;
}

function loadSessionConfig(env = process.env) {
  const ttlHours = parsePositiveNumber(env.OUTFLOW_SESSION_TTL_HOURS, 'OUTFLOW_SESSION_TTL_HOURS', {
    defaultValue: DEFAULT_SESSION_TTL_HOURS,
    maximum: MAX_SESSION_TTL_HOURS,
  });
  return {
    ttlHours,
    ttlMs: ttlHours * 60 * 60 * 1000,
    secureCookies: env.NODE_ENV === 'production',
    trustProxyHops: parseTrustProxyHops(env.OUTFLOW_TRUST_PROXY_HOPS),
  };
}

function generateSessionToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function digestSessionToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return crypto.createHash('sha256').update(HASH_DOMAIN).update(token).digest('hex');
}

function safeDigestEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === 32 && rightBuffer.length === 32
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionCookieOptions(config, expiresAt, now = new Date()) {
  const expires = new Date(expiresAt);
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, expires.getTime() - now.getTime()),
    expires,
  };
}

function clearSessionCookie(res, config = loadSessionConfig()) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}

function issueSession(database, userId, { now = new Date(), config = loadSessionConfig() } = {}) {
  const token = generateSessionToken();
  const tokenHash = digestSessionToken(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.ttlMs).toISOString();
  database.transaction(() => {
    const result = database.prepare(`
      UPDATE users
      SET session_token = NULL, session_token_hash = ?, session_created_at = ?, session_expires_at = ?
      WHERE id = ?
    `).run(tokenHash, createdAt, expiresAt, userId);
    if (result.changes !== 1) throw new Error('Unable to create session');
  })();
  return { token, createdAt, expiresAt };
}

function revokeUserSessions(database, userId) {
  database.transaction(() => {
    database.prepare(`
      UPDATE users
      SET session_token = NULL, session_token_hash = NULL,
          session_created_at = NULL, session_expires_at = NULL
      WHERE id = ?
    `).run(userId);
  })();
}

function authenticateSession(database, token, { now = new Date() } = {}) {
  const candidateHash = digestSessionToken(token);
  if (!candidateHash) return null;
  const user = database.prepare(`
    SELECT * FROM users WHERE session_token_hash = ?
  `).get(candidateHash);
  if (!user || !safeDigestEqual(candidateHash, user.session_token_hash)) return null;
  const expiresAt = Date.parse(user.session_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    database.transaction(() => {
      database.prepare(`
        UPDATE users
        SET session_token_hash = NULL, session_created_at = NULL, session_expires_at = NULL
        WHERE id = ? AND session_token_hash = ?
      `).run(user.id, candidateHash);
    })();
    return null;
  }
  return user;
}

function setSessionCookie(res, session, config = loadSessionConfig()) {
  res.cookie(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieOptions(config, session.expiresAt)
  );
}

module.exports = {
  DEFAULT_SESSION_TTL_HOURS,
  MAX_SESSION_TTL_HOURS,
  SESSION_COOKIE_NAME,
  authenticateSession,
  clearSessionCookie,
  digestSessionToken,
  generateSessionToken,
  issueSession,
  loadSessionConfig,
  revokeUserSessions,
  safeDigestEqual,
  sessionCookieOptions,
  setSessionCookie,
};
