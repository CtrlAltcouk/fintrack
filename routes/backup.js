const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateBackupOwnership } = require('../lib/ownership');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');

const TABLES_EXPORT = [
  'users', 'categories', 'accounts', 'income_schedules',
  'bills', 'income', 'transactions', 'transfers', 'bill_months', 'settings',
];
const TABLES_DELETE = [
  'bill_months', 'settings', 'transfers', 'transactions',
  'income', 'bills', 'accounts', 'income_schedules', 'categories', 'users',
];
const TABLE_COLUMNS = Object.fromEntries(TABLES_EXPORT.map(table => [
  table,
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)),
]));

function validateBackupShape(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)
      || backup.meta?.app !== 'outflow') {
    return 'not an Outflow backup';
  }
  for (const table of TABLES_EXPORT) {
    if (!Array.isArray(backup[table])) return `missing table: ${table}`;
    for (const row of backup[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return `${table} contains an invalid row`;
      }
      const keys = Object.keys(row);
      if (!keys.length || keys.some(key => !TABLE_COLUMNS[table].has(key))) {
        return `${table} contains invalid columns`;
      }
      if (Object.values(row).some(value => value !== null && typeof value === 'object')) {
        return `${table} contains an invalid value`;
      }
    }
  }
  return null;
}

router.get('/', requireAdmin('backup.export'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { version } = require('../package.json');
  const backup = { meta: { app: 'outflow', version, exported_at: new Date().toISOString() } };
  for (const table of TABLES_EXPORT) backup[table] = db.prepare(`SELECT * FROM ${table}`).all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="outflow-backup-${today}.json"`);
  writeSecurityAudit(req, 'backup.export', 'succeeded');
  res.send(JSON.stringify(backup, null, 2));
});

router.post('/restore', requireAdmin('backup.restore'), (req, res) => {
  const mode = req.query.mode === 'merge' ? 'merge' : 'replace';
  const suppliedBackup = req.body;
  const shapeError = validateBackupShape(suppliedBackup);
  if (shapeError) {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_shape' });
    return res.status(400).json({ error: `Invalid backup file: ${shapeError}` });
  }

  const ownership = validateBackupOwnership(suppliedBackup);
  if (ownership.error) {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_ownership' });
    return res.status(400).json({ error: `Invalid backup ownership: ${ownership.error}` });
  }
  const backup = ownership.backup;

  try {
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.transaction(() => {
      if (mode === 'replace') {
        for (const table of TABLES_DELETE) db.prepare(`DELETE FROM ${table}`).run();
      }
      const verb = mode === 'replace' ? 'INSERT' : 'INSERT OR IGNORE';
      for (const table of TABLES_EXPORT) {
        for (const row of backup[table]) {
          const columns = Object.keys(row);
          db.prepare(`${verb} INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
            .run(...Object.values(row));
        }
      }
    })();
    db.prepare('PRAGMA foreign_keys = ON').run();
    writeSecurityAudit(req, 'backup.restore', 'succeeded', { mode });
    res.json({ ok: true, mode });
  } catch (error) {
    db.prepare('PRAGMA foreign_keys = ON').run();
    writeSecurityAudit(req, 'backup.restore', 'failed', { mode });
    console.error('[backup] restore failed:', error.message);
    res.status(500).json({ error: 'Restore failed' });
  }
});

router.validateBackupShape = validateBackupShape;
module.exports = router;
