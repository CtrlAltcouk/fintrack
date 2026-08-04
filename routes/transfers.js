const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { insertTransfer, validateTransfer } = require('../lib/transfers/service');
const { getOwnedSeries } = require('../lib/recurrence/service');
const { createRecurringTransfer, updateTransferFuture } = require('../lib/recurrence/transfer-service');
const { parseIntegerId, validationMessage } = require('../lib/finance-validation');

// GET /api/transfers
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.date, t.note, t.created_at,
           t.recurring_occurrence_id, ro.series_id AS recurring_series_id,
           fa.name as from_account_name, fa.colour as from_account_colour,
           ta.name as to_account_name,   ta.colour as to_account_colour
    FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    JOIN accounts ta ON ta.id = t.to_account_id   AND ta.user_id = ?
    LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
    WHERE t.user_id = ?
    ORDER BY t.date DESC, t.id DESC
  `).all(req.userId, req.userId, req.userId));
});

// POST /api/transfers
router.post('/', (req, res) => {
  try {
    const result = db.transaction(() => {
      if (req.body.recurrence !== undefined && req.body.recurrence !== null) {
        return { recurring: createRecurringTransfer(db, req.userId, req.body, req.body.recurrence) };
      }
      return { transfer: insertTransfer(db, req.userId, req.body) };
    }).immediate();
    if (result.recurring) {
      const recurring = result.recurring;
      if (recurring.error) return res.status(recurring.status ?? 400).json({ error: recurring.error });
      return res.status(201).json(recurring);
    }
    if (result.transfer.error) {
      return res.status(result.transfer.status).json({ error: result.transfer.error });
    }
    res.status(201).json(db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.transfer.id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid account' });
    throw err;
  }
});

// PUT /api/transfers/:id
router.put('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'transfer id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const existing = db.prepare('SELECT * FROM transfers WHERE id = ? AND user_id = ?')
    .get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const scope = req.body.scope ?? req.body.recurrence_scope ?? 'single';
  if (!['single', 'future'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be single or future' });
  }
  const next = {
    from_account_id: req.body.from_account_id ?? existing.from_account_id,
    to_account_id: req.body.to_account_id ?? existing.to_account_id,
    amount: req.body.amount ?? existing.amount,
    date: req.body.date ?? existing.date,
    note: req.body.note === undefined ? existing.note : req.body.note,
  };
  const occurrence = existing.recurring_occurrence_id == null ? null : db.prepare(`SELECT ro.*,
      s.id AS recurring_series_id FROM recurring_occurrences ro
    JOIN recurring_series s ON s.id = ro.series_id
    WHERE ro.id = ? AND s.user_id = ? AND s.kind = 'transfer'`
  ).get(existing.recurring_occurrence_id, req.userId);
  if (scope === 'future' && !occurrence) {
    return res.status(409).json({ error: 'transfer is not recurring' });
  }
  let future = null;
  const updateResult = db.transaction(() => {
    const validation = validateTransfer(db, req.userId, next);
    if (validation.error) return { validation };
    if (scope === 'future') {
      future = updateTransferFuture(db, getOwnedSeries(
        db, occurrence.recurring_series_id, req.userId, { kind: 'transfer' }
      ), validation.value);
      if (future.error) return { futureError: true };
    }
    db.prepare(`UPDATE transfers SET from_account_id = ?, to_account_id = ?, amount = ?,
      date = ?, note = ? WHERE id = ? AND user_id = ?`
    ).run(
      validation.value.from_account_id, validation.value.to_account_id,
      validation.value.amount, validation.value.date, validation.value.note,
      id, req.userId
    );
    return { value: validation.value };
  }).immediate();
  if (updateResult.validation) {
    return res.status(updateResult.validation.status).json({ error: updateResult.validation.error });
  }
  if (future?.error) return res.status(future.status).json({ error: future.error });
  res.json({ id, ...updateResult.value,
    ...(occurrence ? { recurring_series_id: occurrence.recurring_series_id, scope } : {}) });
});

// DELETE /api/transfers/:id
router.delete('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'transfer id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  // Verify the transfer belongs to this user via accounts join
  const t = db.prepare(`
    SELECT t.id, t.recurring_occurrence_id FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    JOIN accounts ta ON ta.id = t.to_account_id AND ta.user_id = ?
    WHERE t.id = ? AND t.user_id = ?
  `).get(req.userId, req.userId, id, req.userId);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM transfers WHERE id = ?').run(id);
    if (t.recurring_occurrence_id != null) {
      db.prepare(`UPDATE recurring_occurrences SET status = 'deleted',
        updated_at = datetime('now') WHERE id = ?`).run(t.recurring_occurrence_id);
    }
  })();
  res.json({ ok: true });
});

module.exports = router;
