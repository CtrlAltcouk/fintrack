const {
  parseIntegerId, parseIsoDate, parsePositiveMoney, validationMessage,
} = require('../finance-validation');

function validateTransfer(db, userId, input) {
  let amount, date, fromAccountId, toAccountId;
  try {
    amount = parsePositiveMoney(input.amount);
    date = parseIsoDate(input.date);
    fromAccountId = parseIntegerId(input.from_account_id, 'from_account_id');
    toAccountId = parseIntegerId(input.to_account_id, 'to_account_id');
  } catch (error) {
    return { error: validationMessage(error), status: 400 };
  }
  if (fromAccountId === toAccountId) {
    return { error: 'from and to accounts must be different', status: 400 };
  }
  const ownedActive = db.prepare(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ? AND active = 1'
  );
  if (!ownedActive.get(fromAccountId, userId) || !ownedActive.get(toAccountId, userId)) {
    return { error: 'account not found', status: 404 };
  }
  return {
    value: {
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      amount,
      date,
      note: input.note ?? null,
    },
  };
}

function insertTransfer(db, userId, input) {
  const validation = validateTransfer(db, userId, input);
  if (validation.error) return validation;
  const value = validation.value;
  const result = db.prepare(`INSERT INTO transfers
    (user_id, from_account_id, to_account_id, amount, date, note, recurring_occurrence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, value.from_account_id, value.to_account_id, value.amount,
    value.date, value.note, input.recurring_occurrence_id ?? null
  );
  return { id: Number(result.lastInsertRowid), ...value };
}

module.exports = { insertTransfer, validateTransfer };
