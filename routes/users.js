const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');
const { claimLegacyData } = require('../db-migrations');
const { deleteUserData } = require('../lib/data-deletion');
const {
  clearAccountRateLimit, loadLoginSecurityConfig,
} = require('../lib/login-security');
const {
  SESSION_COOKIE_NAME, authenticateSession, clearSessionCookie,
} = require('../lib/session');

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
const loginSecurityConfig = loadLoginSecurityConfig();

// GET /api/users/picker — public, no auth, for login screen
router.get('/picker', (req, res) => {
  res.json(db.prepare('SELECT id, display_name, colour, avatar FROM users ORDER BY id ASC').all());
});

// GET /api/users — admin only
router.get('/', requireAuth, requireAdmin('users.list'), (req, res) => {
  writeSecurityAudit(req, 'users.list', 'succeeded');
  res.json(db.prepare('SELECT id, display_name, colour, is_admin, created_at FROM users ORDER BY id ASC').all());
});

// POST /api/users — no auth if first user, admin auth otherwise
router.post('/', async (req, res, next) => {
  try {
  const { display_name, password, colour } = req.body;
  if (!display_name || !String(display_name).trim())
    return res.status(400).json({ error: 'display_name required' });
  if (!password)
    return res.status(400).json({ error: 'password required' });
  if (typeof display_name !== 'string' || display_name.trim().length > loginSecurityConfig.maxUsernameLength)
    return res.status(400).json({ error: `display_name must be no more than ${loginSecurityConfig.maxUsernameLength} characters` });
  if (typeof password !== 'string' || password.length > loginSecurityConfig.maxPasswordLength)
    return res.status(400).json({ error: `password must be no more than ${loginSecurityConfig.maxPasswordLength} characters` });

  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (totalUsers > 0) {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const caller = token ? authenticateSession(db, token) : null;
    req.user = caller;
    req.userId = caller?.id;
    if (!caller || !caller.is_admin) {
      if (token && !caller) clearSessionCookie(res);
      writeSecurityAudit(req, 'users.create', 'denied');
      return res.status(403).json({ error: 'administrator access required' });
    }
    writeSecurityAudit(req, 'users.create', 'attempted');
  }

  const isAdmin = totalUsers === 0 ? 1 : 0;
  const hash = await bcrypt.hash(password, 10);
  let userId;
  try {
    userId = db.transaction(() => {
      if (totalUsers === 0 && db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) {
        const error = new Error('first-run administrator already created');
        error.code = 'FIRST_RUN_ALREADY_COMPLETED';
        throw error;
      }
      const result = db.prepare(
        'INSERT INTO users (display_name, password_hash, colour, is_admin) VALUES (?, ?, ?, ?)'
      ).run(String(display_name).trim(), hash, colour ?? '#4a9eff', isAdmin);
      const createdUserId = Number(result.lastInsertRowid);

      if (isAdmin) claimLegacyData(db, createdUserId);

      if (db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?').get(createdUserId).count === 0) {
        const insertCat = db.prepare('INSERT INTO categories (user_id, name, colour) VALUES (?, ?, ?)');
        for (const cat of SEED_CATEGORIES) insertCat.run(createdUserId, cat.name, cat.colour);
      }

      if (db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(createdUserId).count === 0) {
        db.prepare(
          'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
        ).run(createdUserId, 'Current Account', 'current', '#4a9eff', 0);
      }

      return createdUserId;
    })();
  } catch (err) {
    if (err.code === 'FIRST_RUN_ALREADY_COMPLETED')
      return res.status(403).json({ error: 'administrator access required' });
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE')
      return res.status(409).json({ error: 'display_name already taken' });
    throw err;
  }

  res.status(201).json({
    id: userId,
    display_name: String(display_name).trim(),
    colour: colour ?? '#4a9eff',
    is_admin: isAdmin,
  });
  writeSecurityAudit(req, 'users.create', 'succeeded', { created_user_id: userId, first_user: totalUsers === 0 });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id — admin only, deletes user + all their data
router.delete('/:id', requireAuth, requireAdmin('users.delete'), (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'cannot delete your own account' });
  const target = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(targetId);
  if (!target)
    return res.status(404).json({ error: 'not found' });

  db.transaction(() => {
    clearAccountRateLimit(db, target.display_name);
    deleteUserData(db, targetId, { deleteUser: true });
  })();

  writeSecurityAudit(req, 'users.delete', 'succeeded', { target_user_id: targetId });
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
router.patch('/:id/password', requireAuth, async (req, res, next) => {
  try {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own password' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  if (typeof current_password !== 'string' || typeof new_password !== 'string'
      || current_password.length > loginSecurityConfig.maxPasswordLength
      || new_password.length > loginSecurityConfig.maxPasswordLength)
    return res.status(400).json({ error: `password must be no more than ${loginSecurityConfig.maxPasswordLength} characters` });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!await bcrypt.compare(current_password, user.password_hash))
    return res.status(401).json({ error: 'current password incorrect' });
  const passwordHash = await bcrypt.hash(new_password, 10);
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE users
      SET password_hash = ?, session_token = NULL, session_token_hash = NULL,
          session_created_at = NULL, session_expires_at = NULL
      WHERE id = ? AND password_hash = ?
    `).run(passwordHash, targetId, user.password_hash);
    if (result.changes !== 1) {
      const error = new Error('password changed concurrently');
      error.code = 'PASSWORD_CHANGED_CONCURRENTLY';
      throw error;
    }
    clearAccountRateLimit(db, user.display_name);
  })();
  clearSessionCookie(res);
  res.json({ ok: true, reauthenticate: true });
  } catch (error) {
    if (error.code === 'PASSWORD_CHANGED_CONCURRENTLY')
      return res.status(409).json({ error: 'password changed; please sign in again' });
    next(error);
  }
});

module.exports = router;
