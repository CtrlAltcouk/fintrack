const express = require('express');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');
const { deleteAllUserData, deleteUserData } = require('../lib/data-deletion');
const { requestShutdown } = require('../lib/shutdown');
const { createUpdateCoordinator } = require('../lib/update-coordinator');

function requireStatusAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    writeSecurityAudit(req, 'update.status', 'denied');
    return res.status(403).json({ error: 'administrator access required' });
  }
  next();
}

function createUpdateRouter({
  updates = createUpdateCoordinator(),
  schedule = setTimeout,
  exitProcess = code => requestShutdown('application-restart', code),
} = {}) {
  const router = express.Router();

  router.get('/version', async (_req, res, next) => {
    try {
      res.json({ ...(await updates.installed()), deployment: updates.detectLayout() });
    } catch (error) { next(error); }
  });

  router.get('/check', requireAdmin('update.check'), async (req, res) => {
    try {
      const result = await updates.check(req.userId);
      writeSecurityAudit(req, 'update.check', 'succeeded', {
        current_commit: result.current.sha,
        requested_commit: result.target.sha,
      });
      res.json(result);
    } catch (error) {
      writeSecurityAudit(req, 'update.check', 'failed', { reason: error.code || 'remote_unavailable' });
      res.status(error.status || 503).json({ error: error.message, code: error.code || 'remote_unavailable' });
    }
  });

  router.get('/status', requireStatusAdmin, (req, res) => {
    res.json(updates.status());
  });

  router.post('/', requireAdmin('update.install'), async (req, res) => {
    try {
      const result = await updates.request(req.body?.target, req.userId);
      writeSecurityAudit(req, 'update.requested', 'succeeded', {
        current_commit: result.current,
        requested_commit: result.target,
      });
      res.status(202).json({ status: result.status, target: result.target });
    } catch (error) {
      writeSecurityAudit(req, 'update.requested', 'rejected', { reason: error.code || 'request_failed' });
      res.status(error.status || 500).json({ error: error.message, code: error.code || 'request_failed' });
    }
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
