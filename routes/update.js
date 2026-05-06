const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

// GET /api/update/version — current git commit info
router.get('/version', (req, res) => {
  exec('git log -1 --format="%h|%s|%ci"', { cwd: APP_DIR }, (err, stdout) => {
    if (err) return res.json({ hash: 'unknown', message: '', date: '' });
    const [hash, message, date] = stdout.trim().split('|');
    res.json({ hash, message, date });
  });
});

// POST /api/update — pull latest, npm install, then exit (pm2 restarts)
router.post('/', (req, res) => {
  res.json({ status: 'updating' });

  exec(
    'git pull origin main && npm install --omit=dev --silent',
    { cwd: APP_DIR },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[update] failed:', err.message);
        // Can't send another response — pm2 logs will show the error
        process.exit(1);
      }
      console.log('[update] complete, restarting via pm2...');
      setTimeout(() => process.exit(0), 300);
    }
  );
});

module.exports = router;
