const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const requireAuth = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { display_name, password } = req.body;
  if (!display_name || !password)
    return res.status(400).json({ error: 'display_name and password required' });
  const user = db.prepare('SELECT * FROM users WHERE display_name = ?').get(display_name);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET session_token = ? WHERE id = ?').run(token, user.id);
  res.cookie('fintrack_session', token, { httpOnly: true, sameSite: 'Lax' });
  res.json({ id: user.id, display_name: user.display_name, colour: user.colour, is_admin: user.is_admin });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(req.userId);
  res.clearCookie('fintrack_session');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.fintrack_session;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const user = db.prepare(
    'SELECT id, display_name, colour, is_admin FROM users WHERE session_token = ?'
  ).get(token);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  res.json(user);
});

module.exports = router;
