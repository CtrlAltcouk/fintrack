const REFERENCES = Object.freeze({
  account: { table: 'accounts', label: 'account' },
  category: { table: 'categories', label: 'category' },
  schedule: { table: 'income_schedules', label: 'income schedule' },
  bill: { table: 'bills', label: 'bill' },
});
const { parseIntegerId } = require('./finance-validation');

function findOwned(db, type, id, userId, { active = false } = {}) {
  const config = REFERENCES[type];
  if (!config) throw new Error(`Unsupported ownership reference: ${type}`);
  let numericId;
  try { numericId = parseIntegerId(id); } catch { return null; }
  const activeClause = active ? ' AND active = 1' : '';
  return db.prepare(
    `SELECT * FROM ${config.table} WHERE id = ? AND user_id = ?${activeClause}`
  ).get(numericId, userId) ?? null;
}

function requireOwned(db, res, type, id, userId, options) {
  const record = findOwned(db, type, id, userId, options);
  if (record) return record;
  const label = REFERENCES[type]?.label ?? 'record';
  res.status(404).json({ error: `${label} not found` });
  return null;
}

function requireOptionalOwned(db, res, type, id, userId, options) {
  if (id === null || id === undefined || id === '') return true;
  return Boolean(requireOwned(db, res, type, id, userId, options));
}

function validateBackupOwnership(backup) {
  const users = new Set(backup.users.map(row => String(row.id)));
  const accounts = new Map(backup.accounts.map(row => [String(row.id), String(row.user_id)]));
  const categories = new Map(backup.categories.map(row => [String(row.id), String(row.user_id)]));
  const schedules = new Map(backup.income_schedules.map(row => [String(row.id), String(row.user_id)]));
  const bills = new Map(backup.bills.map(row => [String(row.id), String(row.user_id)]));
  const series = new Map((backup.recurring_series ?? []).map(row => [String(row.id), {
    userId: String(row.user_id), kind: row.kind,
  }]));
  const occurrences = new Map((backup.recurring_occurrences ?? []).map(row => [String(row.id), String(row.series_id)]));
  const errors = [];
  const validUser = (row, table) => {
    if (row.user_id === null || row.user_id === undefined || !users.has(String(row.user_id))) {
      errors.push(`${table} ${row.id ?? row.key ?? '?'} has no valid owner`);
      return false;
    }
    return true;
  };
  const sameOwner = (map, id, owner) => id === null || id === undefined
    || map.get(String(id)) === String(owner);

  for (const row of backup.categories) validUser(row, 'category');
  for (const row of backup.accounts) validUser(row, 'account');
  for (const row of backup.settings) validUser(row, 'setting');
  for (const row of backup.recurring_series ?? []) validUser(row, 'recurring series');

  for (const row of backup.recurring_occurrences ?? []) {
    if (!series.has(String(row.series_id))) {
      errors.push(`recurring occurrence ${row.id} references a missing series`);
    }
  }

  for (const row of backup.recurring_transaction_templates ?? []) {
    const recurring = series.get(String(row.recurring_series_id));
    if (!recurring || recurring.kind !== 'transaction') {
      errors.push(`recurring transaction template ${row.recurring_series_id} references an invalid series`);
      continue;
    }
    if (!sameOwner(categories, row.category_id, recurring.userId)) {
      errors.push(`recurring transaction template ${row.recurring_series_id} references another user's category`);
    }
    if (!sameOwner(accounts, row.account_id, recurring.userId)) {
      errors.push(`recurring transaction template ${row.recurring_series_id} references another user's account`);
    }
  }

  for (const row of backup.recurring_transfer_templates ?? []) {
    const recurring = series.get(String(row.recurring_series_id));
    if (!recurring || recurring.kind !== 'transfer') {
      errors.push(`recurring transfer template ${row.recurring_series_id} references an invalid series`);
      continue;
    }
    if (String(row.from_account_id) === String(row.to_account_id)) {
      errors.push(`recurring transfer template ${row.recurring_series_id} uses the same account twice`);
    }
    if (!sameOwner(accounts, row.from_account_id, recurring.userId)
        || !sameOwner(accounts, row.to_account_id, recurring.userId)) {
      errors.push(`recurring transfer template ${row.recurring_series_id} references another user's account`);
    }
  }

  for (const row of backup.income_schedules) {
    if (!validUser(row, 'income schedule')) continue;
    const recurring = series.get(String(row.recurring_series_id));
    if (!recurring || recurring.kind !== 'income' || recurring.userId !== String(row.user_id)) {
      errors.push(`income schedule ${row.id} references an invalid recurring series`);
    }
    if (!sameOwner(accounts, row.account_id, row.user_id)) {
      errors.push(`income schedule ${row.id} references another user's account`);
    }
  }

  for (const row of backup.bills) {
    if (!validUser(row, 'bill')) continue;
    const recurring = series.get(String(row.recurring_series_id));
    if (!recurring || recurring.kind !== 'bill' || recurring.userId !== String(row.user_id)) {
      errors.push(`bill ${row.id} references an invalid recurring series`);
    }
    if (!sameOwner(categories, row.category_id, row.user_id)) {
      errors.push(`bill ${row.id} references another user's category`);
    }
    if (!sameOwner(accounts, row.account_id, row.user_id)) {
      errors.push(`bill ${row.id} references another user's account`);
    }
  }

  for (const row of backup.transactions) {
    if (!validUser(row, 'transaction')) continue;
    if (!sameOwner(categories, row.category_id, row.user_id)) {
      errors.push(`transaction ${row.id} references another user's category`);
    }
    if (!sameOwner(accounts, row.account_id, row.user_id)) {
      errors.push(`transaction ${row.id} references another user's account`);
    }
    if (row.recurring_occurrence_id != null) {
      const occurrenceSeries = occurrences.get(String(row.recurring_occurrence_id));
      const recurring = series.get(String(occurrenceSeries));
      if (!recurring || recurring.kind !== 'transaction' || recurring.userId !== String(row.user_id)) {
        errors.push(`transaction ${row.id} references an invalid recurring occurrence`);
      }
    }
  }

  for (const row of backup.income) {
    if (!validUser(row, 'income')) continue;
    if (!sameOwner(accounts, row.account_id, row.user_id)) {
      errors.push(`income ${row.id} references another user's account`);
    }
    if (!sameOwner(schedules, row.source_schedule_id, row.user_id)) {
      errors.push(`income ${row.id} references another user's schedule`);
    }
    if (row.recurring_occurrence_id != null) {
      const occurrenceSeries = occurrences.get(String(row.recurring_occurrence_id));
      const recurring = series.get(String(occurrenceSeries));
      if (!recurring || recurring.kind !== 'income' || recurring.userId !== String(row.user_id)) {
        errors.push(`income ${row.id} references an invalid recurring occurrence`);
      }
    }
  }

  const normalizedTransfers = backup.transfers.map(row => {
    const fromOwner = accounts.get(String(row.from_account_id));
    const toOwner = accounts.get(String(row.to_account_id));
    const owner = row.user_id === null || row.user_id === undefined
      ? fromOwner
      : String(row.user_id);
    if (!owner || fromOwner !== owner || toOwner !== owner || !users.has(owner)) {
      errors.push(`transfer ${row.id} crosses user ownership`);
    }
    if (String(row.from_account_id) === String(row.to_account_id)) {
      errors.push(`transfer ${row.id} uses the same account twice`);
    }
    if (row.recurring_occurrence_id != null) {
      const occurrenceSeries = occurrences.get(String(row.recurring_occurrence_id));
      const recurring = series.get(String(occurrenceSeries));
      if (!recurring || recurring.kind !== 'transfer' || recurring.userId !== owner) {
        errors.push(`transfer ${row.id} references an invalid recurring occurrence`);
      }
    }
    return { ...row, user_id: owner === undefined ? row.user_id : Number(owner) };
  });

  for (const row of backup.bill_months) {
    if (!bills.has(String(row.bill_id))) {
      errors.push(`bill month ${row.id} references a missing bill`);
    }
    const occurrenceSeries = occurrences.get(String(row.recurring_occurrence_id));
    const bill = backup.bills.find(item => String(item.id) === String(row.bill_id));
    if (!occurrenceSeries || occurrenceSeries !== String(bill?.recurring_series_id)) {
      errors.push(`bill month ${row.id} references an invalid recurring occurrence`);
    }
  }

  return {
    error: errors.length ? errors.slice(0, 10).join('; ') : null,
    backup: errors.length ? null : { ...backup, transfers: normalizedTransfers },
  };
}

module.exports = {
  findOwned,
  requireOwned,
  requireOptionalOwned,
  validateBackupOwnership,
};
