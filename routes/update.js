const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');
const { deleteAllUserData, deleteUserData } = require('../lib/data-deletion');
const { requestShutdown } = require('../lib/shutdown');

const APP_DIR = path.join(__dirname, '..');

function createUpdateRouter({
  runCommand = exec,
  schedule = setTimeout,
  exitProcess = code => requestShutdown('application-restart', code),
} = {}) {
  const router = express.Router();

  router.get('/version', (_req, res) => {
    runCommand('git log -1 --format="%h|%s|%ci"', { cwd: APP_DIR }, (error, stdout) => {
      if (error) return res.json({ hash: 'unknown', message: '', date: '', version: '?' });
      const [hash, message, date] = stdout.trim().split('|');
      const { version } = require('../package.json');
      res.json({ hash, message, date, version });
    });
  });

  router.get('/check', requireAdmin('update.check'), (req, res) => {
    runCommand(
      'git fetch origin main 2>/dev/null && git rev-list HEAD..origin/main --count',
      { cwd: APP_DIR },
      (error, stdout) => {
        if (error) {
          writeSecurityAudit(req, 'update.check', 'failed');
          return res.json({ upToDate: null, behind: null, error: 'Could not reach GitHub' });
        }
        const behind = parseInt(stdout.trim(), 10) || 0;
        writeSecurityAudit(req, 'update.check', 'succeeded', { behind });
        res.json({ upToDate: behind === 0, behind });
      }
    );
  });

  router.post('/', requireAdmin('update.install'), (req, res) => {
    writeSecurityAudit(req, 'update.install', 'rejected', { reason: 'pinned_release_required' });
    res.status(409).json({
      error: 'In-app updates are disabled for deployment safety. Use update.sh with a pinned release tag or commit.',
    });
  });

  router.post('/restart', requireAdmin('application.restart'), (req, res) => {
    writeSecurityAudit(req, 'application.restart', 'succeeded');
    res.json({ status: 'restarting' });
    schedule(() => exitProcess(0), 300);
  });

  router.post('/clear-data', requireAdmin('data.clear_all'), (req, res) => {
    const db = require('../db');
    db.transaction(() => {
      deleteAllUserData(db);
    })();
    writeSecurityAudit(req, 'data.clear_all', 'succeeded');
    res.json({ ok: true });
  });

  router.post('/clear-my-data', (req, res) => {
    const db = require('../db');
    const userId = req.user.id;
    db.transaction(() => {
      deleteUserData(db, userId);
    })();
    res.json({ ok: true });
  });

  return router;
}

const router = createUpdateRouter();
router.createUpdateRouter = createUpdateRouter;
module.exports = router;
