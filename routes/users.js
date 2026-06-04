const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const requireAuth = require('../middleware/auth');

const SEED_CATEGORIES = [
  { name: 'Housing',       colour: '#f7a4a2' },
  { name: 'Groceries',     colour: '#a8d8a8' },
  { name: 'Transport',     colour: '#ffd700' },
  { name: 'Utilities',     colour: '#87ceeb' },
  { name: 'Eating Out',    colour: '#ffb347' },
  { name: 'Entertainment', colour: '#c39bd3' },
  { name: 'Health',        colour: '#76d7c4' },
  { name: 'Other',         colour: '#888888' },
];

// GET /api/users/picker — public, no auth, for login screen
router.get('/picker', (req, res) => {
  res.json(db.prepare('SELECT id, display_name, colour, avatar FROM users ORDER BY id ASC').all());
});

// GET /api/users — admin only
router.get('/', requireAuth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  res.json(db.prepare('SELECT id, display_name, colour, is_admin, created_at FROM users ORDER BY id ASC').all());
});

// POST /api/users — no auth if first user, admin auth otherwise
router.post('/', (req, res) => {
  const { display_name, password, colour } = req.body;
  if (!display_name || !String(display_name).trim())
    return res.status(400).json({ error: 'display_name required' });
  if (!password)
    return res.status(400).json({ error: 'password required' });

  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (totalUsers > 0) {
    const token = req.cookies?.fintrack_session;
    const caller = token ? db.prepare('SELECT * FROM users WHERE session_token = ?').get(token) : null;
    if (!caller || !caller.is_admin) return res.status(403).json({ error: 'admin only' });
  }

  const isAdmin = totalUsers === 0 ? 1 : 0;
  const hash = bcrypt.hashSync(password, 10);
  let userId;
  try {
    const result = db.prepare(
      'INSERT INTO users (display_name, password_hash, colour, is_admin) VALUES (?, ?, ?, ?)'
    ).run(String(display_name).trim(), hash, colour ?? '#4a9eff', isAdmin);
    userId = result.lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE')
      return res.status(409).json({ error: 'display_name already taken' });
    throw err;
  }

  // Seed categories for this user
  const insertCat = db.prepare('INSERT INTO categories (user_id, name, colour) VALUES (?, ?, ?)');
  for (const cat of SEED_CATEGORIES) insertCat.run(userId, cat.name, cat.colour);

  // Seed default account for this user
  db.prepare(
    'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'Current Account', 'current', '#4a9eff', 0);

  res.status(201).json({
    id: userId,
    display_name: String(display_name).trim(),
    colour: colour ?? '#4a9eff',
    is_admin: isAdmin,
  });
});

// DELETE /api/users/:id — admin only, deletes user + all their data
router.delete('/:id', requireAuth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const targetId = Number(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'cannot delete your own account' });
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(targetId))
    return res.status(404).json({ error: 'not found' });

  db.prepare('DELETE FROM bill_months WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM bills            WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM income           WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM income_schedules WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM transactions     WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM transfers WHERE from_account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM transfers WHERE to_account_id   IN (SELECT id FROM accounts WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM accounts         WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM categories       WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM settings         WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM users            WHERE id = ?').run(targetId);

  res.json({ ok: true });
});

// PATCH /api/users/:id/colour — own account only
router.patch('/:id/colour', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own colour' });
  const { colour } = req.body;
  if (!colour || typeof colour !== 'string' || !colour.trim())
    return res.status(400).json({ error: 'colour required' });
  db.prepare('UPDATE users SET colour = ? WHERE id = ?').run(colour.trim(), targetId);
  res.json({ ok: true, colour: colour.trim() });
});

// PATCH /api/users/:id/avatar — own account only
router.patch('/:id/avatar', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own avatar' });
  const { avatar } = req.body;
  if (avatar !== null && avatar !== undefined) {
    if (typeof avatar !== 'string' || !avatar.startsWith('data:image/'))
      return res.status(400).json({ error: 'avatar must be a base64 image data URL' });
    if (avatar.length > 400000)
      return res.status(400).json({ error: 'avatar too large (max ~300 KB)' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar ?? null, targetId);
  res.json({ ok: true });
});

// PATCH /api/users/:id/password — own account only
router.patch('/:id/password', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own password' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'current password incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), targetId);
  res.json({ ok: true });
});

module.exports = router;
