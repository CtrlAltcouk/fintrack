const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const { writeSecurityAudit } = require('../lib/security-audit');
const {
  LoginRateLimiter, loadLoginSecurityConfig, normalizeLoginName, resolveClientIp,
} = require('../lib/login-security');
const {
  clearSessionCookie, issueSession, loadSessionConfig, revokeUserSessions,
  setSessionCookie,
} = require('../lib/session');

const DUMMY_PASSWORD_HASH = '$2b$10$kHV7ohpGnh9cYf/i2hKcqehS.x6Ci5bjnE9RqcLfeaey2ObDY1fuW';
const INVALID_CREDENTIALS = Object.freeze({
  error: 'Invalid display name or password',
  code: 'AUTH_INVALID_CREDENTIALS',
});
const RATE_LIMITED = Object.freeze({
  error: 'Too many sign-in attempts. Please try again later.',
  code: 'AUTH_RATE_LIMITED',
});

function createAuthRouter({
  database = db,
  loginConfig = loadLoginSecurityConfig(),
  limiter = new LoginRateLimiter(database, loginConfig),
  sessionConfig = null,
  comparePassword = bcrypt.compare,
} = {}) {
  const router = express.Router();

  function throttled(req, res, result) {
    res.setHeader('Retry-After', String(result.retryAfter));
    writeSecurityAudit(req, 'auth.login', 'throttled', {
      reason: result.reason === 'ip' ? 'ip_rate_limit' : 'account_rate_limit',
      retry_after_seconds: result.retryAfter,
    });
    return res.status(429).json({ ...RATE_LIMITED, retry_after: result.retryAfter });
  }

  // POST /api/auth/login
  router.post('/login', async (req, res, next) => {
    try {
      const { display_name: displayName, password } = req.body ?? {};
      if (typeof displayName !== 'string' || typeof password !== 'string'
          || !displayName.trim() || !password) {
        return res.status(400).json({ error: 'display_name and password required', code: 'AUTH_INVALID_REQUEST' });
      }

      const normalizedName = normalizeLoginName(displayName);
      const activeSessionConfig = sessionConfig ?? loadSessionConfig();
      const clientIp = resolveClientIp(req, activeSessionConfig.trustProxyHops);
      req.securityClientIp = clientIp;
      const claim = limiter.beginAttempt(normalizedName, clientIp);
      if (!claim.allowed) return throttled(req, res, claim);

      const bounded = displayName.length <= loginConfig.maxUsernameLength
        && password.length <= loginConfig.maxPasswordLength;
      const user = bounded ? database.prepare(`
        SELECT * FROM users
        WHERE display_name = ? OR lower(trim(display_name)) = ?
        ORDER BY CASE WHEN display_name = ? THEN 0 ELSE 1 END, id
        LIMIT 1
      `).get(displayName.trim(), normalizedName, displayName.trim()) : null;
      let valid = false;
      if (bounded) {
        try {
          valid = await comparePassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
        } catch (_) {
          // A malformed legacy digest must not create a user-enumeration response difference.
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          valid = false;
        }
      }
      const completion = limiter.completeAttempt(claim, Boolean(user && valid));
      if (!user || !valid) {
        if (completion.throttled) return throttled(req, res, completion);
        writeSecurityAudit(req, 'auth.login', 'failed', { reason: 'invalid_credentials' });
        return res.status(401).json(INVALID_CREDENTIALS);
      }

      const session = issueSession(database, user.id, { config: activeSessionConfig });
      setSessionCookie(res, session, activeSessionConfig);
      req.userId = user.id;
      writeSecurityAudit(req, 'auth.login', 'succeeded');
      return res.json({
        id: user.id,
        display_name: user.display_name,
        colour: user.colour,
        is_admin: user.is_admin,
        avatar: user.avatar ?? null,
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/auth/logout
  router.post('/logout', requireAuth, (req, res) => {
    revokeUserSessions(database, req.userId);
    clearSessionCookie(res, sessionConfig ?? loadSessionConfig());
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, (req, res) => {
    const { id, display_name, colour, is_admin, avatar } = req.user;
    res.json({ id, display_name, colour, is_admin, avatar: avatar ?? null });
  });

  router.loginRateLimiter = limiter;
  return router;
}

const router = createAuthRouter();
router.createAuthRouter = createAuthRouter;
router.DUMMY_PASSWORD_HASH = DUMMY_PASSWORD_HASH;
router.INVALID_CREDENTIALS = INVALID_CREDENTIALS;
router.RATE_LIMITED = RATE_LIMITED;

module.exports = router;
