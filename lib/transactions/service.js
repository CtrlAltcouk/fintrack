const {
  parseIntegerId, parseIsoDate, parseOptionalIntegerId, parsePositiveMoney,
} = require('../finance-validation');

function insertTransaction(db, transaction) {
  const userId = parseIntegerId(transaction.user_id, 'user_id');
  const amount = parsePositiveMoney(transaction.amount);
  const categoryId = parseIntegerId(transaction.category_id, 'category_id');
  const accountId = parseOptionalIntegerId(transaction.account_id, 'account_id');
  const occurrenceId = parseOptionalIntegerId(
    transaction.recurring_occurrence_id, 'recurring_occurrence_id'
  );
  const date = parseIsoDate(transaction.date);
  const result = db.prepare(`INSERT INTO transactions
    (user_id, amount, description, category_id, date, account_id, recurring_occurrence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, amount, transaction.description,
    categoryId, date, accountId, occurrenceId
  );
  return Number(result.lastInsertRowid);
}

module.exports = { insertTransaction };
