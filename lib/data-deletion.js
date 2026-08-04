const GLOBAL_DELETE_STEPS = Object.freeze([
  ['login_attempt_claims', 'DELETE FROM login_attempt_claims'],
  ['login_rate_limits', 'DELETE FROM login_rate_limits'],
  ['bill_months', 'DELETE FROM bill_months'],
  ['income', 'DELETE FROM income'],
  ['transactions', 'DELETE FROM transactions'],
  ['transfers', 'DELETE FROM transfers'],
  ['bills', 'DELETE FROM bills'],
  ['income_schedules', 'DELETE FROM income_schedules'],
  ['recurring_transaction_templates', 'DELETE FROM recurring_transaction_templates'],
  ['recurring_transfer_templates', 'DELETE FROM recurring_transfer_templates'],
  ['recurring_execution_claims', 'DELETE FROM recurring_execution_claims'],
  ['recurring_occurrences', 'DELETE FROM recurring_occurrences'],
  ['recurring_series', 'DELETE FROM recurring_series'],
  ['settings', 'DELETE FROM settings'],
  ['accounts', 'DELETE FROM accounts'],
  ['categories', 'DELETE FROM categories'],
]);

const USER_DELETE_STEPS = Object.freeze([
  ['bill_months', `DELETE FROM bill_months
    WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)`],
  ['income', 'DELETE FROM income WHERE user_id = ?'],
  ['transactions', 'DELETE FROM transactions WHERE user_id = ?'],
  ['transfers', 'DELETE FROM transfers WHERE user_id = ?'],
  ['bills', 'DELETE FROM bills WHERE user_id = ?'],
  ['income_schedules', 'DELETE FROM income_schedules WHERE user_id = ?'],
  ['recurring_transaction_templates', `DELETE FROM recurring_transaction_templates
    WHERE recurring_series_id IN (SELECT id FROM recurring_series WHERE user_id = ?)`],
  ['recurring_transfer_templates', `DELETE FROM recurring_transfer_templates
    WHERE recurring_series_id IN (SELECT id FROM recurring_series WHERE user_id = ?)`],
  ['recurring_execution_claims', `DELETE FROM recurring_execution_claims
    WHERE occurrence_id IN (
      SELECT ro.id FROM recurring_occurrences ro
      JOIN recurring_series rs ON rs.id = ro.series_id
      WHERE rs.user_id = ?
    )`],
  ['recurring_occurrences', `DELETE FROM recurring_occurrences
    WHERE series_id IN (SELECT id FROM recurring_series WHERE user_id = ?)`],
  ['recurring_series', 'DELETE FROM recurring_series WHERE user_id = ?'],
  ['settings', 'DELETE FROM settings WHERE user_id = ?'],
  ['accounts', 'DELETE FROM accounts WHERE user_id = ?'],
  ['categories', 'DELETE FROM categories WHERE user_id = ?'],
]);

function runDeleteSteps(db, steps, params, onStep) {
  for (const [table, sql] of steps) {
    const result = db.prepare(sql).run(...params);
    onStep?.({ table, changes: result.changes });
  }
}

function deleteAllUserData(db, { onStep } = {}) {
  runDeleteSteps(db, GLOBAL_DELETE_STEPS, [], onStep);
}

function deleteUserData(db, userId, { deleteUser = false, onStep } = {}) {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError('userId must be a positive integer');
  }
  runDeleteSteps(db, USER_DELETE_STEPS, [userId], onStep);
  if (deleteUser) {
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    onStep?.({ table: 'users', changes: result.changes });
  }
}

module.exports = {
  GLOBAL_DELETE_STEPS,
  USER_DELETE_STEPS,
  deleteAllUserData,
  deleteUserData,
};
