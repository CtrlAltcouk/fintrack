const db = require('../db');
const {
  SESSION_COOKIE_NAME, authenticateSession, clearSessionCookie,
} = require('../lib/session');

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const user = authenticateSession(db, token);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'unauthenticated' });
  }
  req.userId = user.id;
  req.user   = user;
  next();
};
