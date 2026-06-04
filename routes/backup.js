const express = require('express');
const router  = express.Router();
const db      = require('../db');

const TABLES_EXPORT = [
  'users', 'categories', 'accounts', 'income_schedules',
  'bills', 'income', 'transactions', 'transfers', 'bill_months', 'settings',
];
const TABLES_DELETE = [
  'bill_months', 'settings', 'transfers', 'transactions',
  'income', 'bills', 'accounts', 'income_schedules', 'categories', 'users',
];

// GET /api/backup — download full JSON backup (admin only)
router.get('/', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const today = new Date().toISOString().slice(0, 10);
  const { version } = require('../package.json');
  const backup = { meta: { app: 'outflow', version, exported_at: new Date().toISOString() } };
  for (const t of TABLES_EXPORT) backup[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="outflow-backup-${today}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

// POST /api/backup/restore?mode=replace|merge — restore from JSON backup (admin only)
router.post('/restore', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const mode   = req.query.mode === 'merge' ? 'merge' : 'replace';
  const backup = req.body;

  if (!backup?.meta?.app || backup.meta.app !== 'outflow')
    return res.status(400).json({ error: 'Invalid backup file — not an Outflow backup.' });
  for (const t of TABLES_EXPORT) {
    if (!Array.isArray(backup[t]))
      return res.status(400).json({ error: `Invalid backup file — missing table: ${t}` });
  }

  try {
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.transaction(() => {
      if (mode === 'replace') {
        for (const t of TABLES_DELETE) db.prepare(`DELETE FROM ${t}`).run();
      }
      const verb = mode === 'replace' ? 'INSERT' : 'INSERT OR IGNORE';
      for (const t of TABLES_EXPORT) {
        for (const row of backup[t]) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          db.prepare(`${verb} INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...Object.values(row));
        }
      }
    })();
    db.prepare('PRAGMA foreign_keys = ON').run();
    res.json({ ok: true, mode });
  } catch (err) {
    db.prepare('PRAGMA foreign_keys = ON').run();
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

module.exports = router;
