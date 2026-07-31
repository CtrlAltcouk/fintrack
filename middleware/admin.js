const { writeSecurityAudit } = require('../lib/security-audit');

function requireAdmin(action) {
  return function adminAuthorization(req, res, next) {
    if (!req.user?.is_admin) {
      writeSecurityAudit(req, action, 'denied');
      return res.status(403).json({ error: 'administrator access required' });
    }
    writeSecurityAudit(req, action, 'attempted');
    next();
  };
}

module.exports = requireAdmin;
