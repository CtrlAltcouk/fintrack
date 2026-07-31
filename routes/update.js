const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');

const APP_DIR = path.join(__dirname, '..');

function createUpdateRouter({
  runCommand = exec,
  schedule = setTimeout,
  exitProcess = code => process.exit(code),
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
    res.json({ status: 'updating' });
    runCommand(
      'git pull origin main && npm install --omit=dev --silent',
      { cwd: APP_DIR },
      error => {
        if (error) {
          writeSecurityAudit(req, 'update.install', 'failed');
          console.error('[update] failed:', error.message);
          return exitProcess(1);
        }
        writeSecurityAudit(req, 'update.install', 'succeeded');
        console.log('[update] complete, restarting...');
        schedule(() => exitProcess(0), 300);
      }
    );
  });

  router.post('/restart', requireAdmin('application.restart'), (req, res) => {
    writeSecurityAudit(req, 'application.restart', 'succeeded');
    res.json({ status: 'restarting' });
    schedule(() => exitProcess(0), 300);
  });

  router.post('/clear-data', requireAdmin('data.clear_all'), (req, res) => {
    const db = require('../db');
    db.transaction(() => {
      db.prepare('DELETE FROM bill_months').run();
      db.prepare('DELETE FROM bills').run();
      db.prepare('DELETE FROM income').run();
      db.prepare('DELETE FROM income_schedules').run();
      db.prepare('DELETE FROM transactions').run();
      db.prepare('DELETE FROM transfers').run();
      db.prepare('DELETE FROM accounts').run();
    })();
    writeSecurityAudit(req, 'data.clear_all', 'succeeded');
    res.json({ ok: true });
  });

  router.post('/clear-my-data', (req, res) => {
    const db = require('../db');
    const userId = req.user.id;
    db.transaction(() => {
      db.prepare(`
        DELETE FROM bill_months
        WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)
      `).run(userId);
      db.prepare('DELETE FROM bills WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM income WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM income_schedules WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
      db.prepare(`
        DELETE FROM transfers
        WHERE from_account_id IN (SELECT id FROM accounts WHERE user_id = ?)
           OR to_account_id IN (SELECT id FROM accounts WHERE user_id = ?)
      `).run(userId, userId);
      db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
    })();
    res.json({ ok: true });
  });

  return router;
}

const router = createUpdateRouter();
router.createUpdateRouter = createUpdateRouter;
module.exports = router;
