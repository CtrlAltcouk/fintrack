const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

// GET /api/update/version — current git commit info + package version
router.get('/version', (req, res) => {
  exec('git log -1 --format="%h|%s|%ci"', { cwd: APP_DIR }, (err, stdout) => {
    if (err) return res.json({ hash: 'unknown', message: '', date: '', version: '?' });
    const [hash, message, date] = stdout.trim().split('|');
    const { version } = require('../package.json');
    res.json({ hash, message, date, version });
  });
});

// GET /api/update/check — fetch remote and count commits ahead
router.get('/check', (req, res) => {
  exec(
    'git fetch origin main 2>/dev/null && git rev-list HEAD..origin/main --count',
    { cwd: APP_DIR },
    (err, stdout) => {
      if (err) return res.json({ upToDate: null, behind: null, error: 'Could not reach GitHub' });
      const behind = parseInt(stdout.trim(), 10) || 0;
      res.json({ upToDate: behind === 0, behind });
    }
  );
});

// POST /api/update — pull latest, npm install, then exit (pm2 restarts)
router.post('/', (req, res) => {
  res.json({ status: 'updating' });
  exec(
    'git pull origin main && npm install --omit=dev --silent',
    { cwd: APP_DIR },
    (err) => {
      if (err) { console.error('[update] failed:', err.message); return process.exit(1); }
      console.log('[update] complete, restarting...');
      setTimeout(() => process.exit(0), 300);
    }
  );
});

// POST /api/update/restart — restart app via pm2 (no code change)
router.post('/restart', (req, res) => {
  res.json({ status: 'restarting' });
  setTimeout(() => process.exit(0), 300);
});

// POST /api/update/clear-data — wipe all user data (keeps categories)
router.post('/clear-data', (req, res) => {
  const db = require('../db');
  db.prepare('DELETE FROM bill_months').run();
  db.prepare('DELETE FROM bills').run();
  db.prepare('DELETE FROM income').run();
  db.prepare('DELETE FROM income_schedules').run();
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM transfers').run();
  db.prepare('DELETE FROM accounts').run();
  res.json({ ok: true });
});

module.exports = router;
