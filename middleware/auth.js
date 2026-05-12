const db = require('../db');

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies?.fintrack_session;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const user = db.prepare('SELECT * FROM users WHERE session_token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  req.userId = user.id;
  req.user   = user;
  next();
};
