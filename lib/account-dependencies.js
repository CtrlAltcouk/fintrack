const ACCOUNT_IN_USE_MESSAGE = 'This account is still used by active items.';
const ACCOUNT_IN_USE_CODE = 'ACCOUNT_HAS_DEPENDENCIES';

function accountSeriesIds(db, accountId, userId) {
  return db.prepare(`
    SELECT recurring_series_id AS id
      FROM bills WHERE account_id = ? AND user_id = ?
    UNION
    SELECT recurring_series_id AS id
      FROM income_schedules WHERE account_id = ? AND user_id = ?
    UNION
    SELECT t.recurring_series_id AS id
      FROM recurring_transaction_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      WHERE t.account_id = ? AND s.user_id = ?
    UNION
    SELECT t.recurring_series_id AS id
      FROM recurring_transfer_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      WHERE (t.from_account_id = ? OR t.to_account_id = ?) AND s.user_id = ?
  `).all(
    accountId, userId,
    accountId, userId,
    accountId, userId,
    accountId, accountId, userId,
  ).map(row => row.id).filter(id => id != null);
}

function countForeignKeyReferences(db, accountId) {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  let count = 0;
  const tables = db.prepare(`SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all();
  for (const { name } of tables) {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
    for (const foreignKey of foreignKeys) {
      if (foreignKey.table !== 'accounts') continue;
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}
        WHERE ${quote(foreignKey.from)} = ?`).get(accountId);
      count += Number(row.count);
    }
  }
  return count;
}

function getAccountDependencies(db, accountId, userId) {
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM bills WHERE account_id = ? AND user_id = ?) AS bills,
      (SELECT COUNT(*) FROM income WHERE account_id = ? AND user_id = ?) AS income,
      (SELECT COUNT(*) FROM transfers
        WHERE user_id = ? AND (from_account_id = ? OR to_account_id = ?)) AS transfers,
      (SELECT COUNT(*) FROM transactions WHERE account_id = ? AND user_id = ?) AS transactions
  `).get(
    accountId, userId,
    accountId, userId,
    userId, accountId, accountId,
    accountId, userId,
  );
  const seriesIds = accountSeriesIds(db, accountId, userId);
  let futureOccurrences = 0;
  let pendingClaims = 0;
  if (seriesIds.length) {
    const placeholders = seriesIds.map(() => '?').join(',');
    futureOccurrences = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM recurring_occurrences
      WHERE series_id IN (${placeholders})
        AND scheduled_date >= date('now')
        AND status IN ('scheduled', 'generated', 'failed')`).get(...seriesIds).count);
    pendingClaims = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM recurring_execution_claims c
      JOIN recurring_occurrences o ON o.id = c.occurrence_id
      WHERE o.series_id IN (${placeholders})`).get(...seriesIds).count);
  }
  const dependencies = {
    bills: Number(counts.bills),
    income: Number(counts.income),
    transfers: Number(counts.transfers),
    transactions: Number(counts.transactions),
    recurring_items: seriesIds.length,
  };
  const details = {
    future_occurrences: futureOccurrences,
    pending_recurrence_claims: pendingClaims,
    foreign_key_references: countForeignKeyReferences(db, accountId),
  };
  return {
    dependencies,
    details,
    blocked: Object.values(dependencies).some(Boolean)
      || Object.values(details).some(Boolean),
  };
}

function deactivateAccount(db, accountId, userId) {
  return db.transaction(() => {
    const account = db.prepare(
      'SELECT id, active FROM accounts WHERE id = ? AND user_id = ?'
    ).get(accountId, userId);
    if (!account) return { status: 'not_found' };
    if (!account.active) return { status: 'already_inactive' };
    const result = getAccountDependencies(db, accountId, userId);
    if (result.blocked) return { status: 'blocked', ...result };
    db.prepare('UPDATE accounts SET active = 0 WHERE id = ? AND user_id = ?')
      .run(accountId, userId);
    return { status: 'deactivated' };
  }).immediate();
}

module.exports = {
  ACCOUNT_IN_USE_CODE,
  ACCOUNT_IN_USE_MESSAGE,
  deactivateAccount,
  getAccountDependencies,
};
