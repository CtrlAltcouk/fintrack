function writeSecurityAudit(req, action, outcome, details = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      outcome,
      user_id: req.userId ?? null,
      method: req.method,
      path: req.originalUrl?.split('?')[0] ?? req.path,
      ip: req.securityClientIp ?? req.ip,
      ...details,
    };
    console.info(`[security-audit] ${JSON.stringify(entry)}`);
  } catch (_) {
    // Audit output must never change the authorization or operational outcome.
  }
}

module.exports = { writeSecurityAudit };
