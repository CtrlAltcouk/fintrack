const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAdmin = require('../middleware/admin');
const { getRecurrenceRunner } = require('../lib/recurrence/runner-runtime');
const {
  getOwnedSeries, pauseSeries, resumeSeries, serializeSeries, skipOccurrence,
} = require('../lib/recurrence/service');
const {
  resumeAutomaticSeries, skipNextAutomaticOccurrence, stopAutomaticSeries,
} = require('../lib/recurrence/automatic-series-service');

router.get('/runner', requireAdmin('recurrence.runner.inspect'), (_req, res) => {
  const runner = getRecurrenceRunner();
  if (!runner) return res.status(503).json({ error: 'recurrence runner unavailable' });
  res.json(runner.diagnostics());
});

router.post('/runner/run', requireAdmin('recurrence.runner.run'), async (_req, res) => {
  const runner = getRecurrenceRunner();
  if (!runner) return res.status(503).json({ error: 'recurrence runner unavailable' });
  res.json(await runner.runOnce({ source: 'admin' }));
});

router.post('/occurrences/:id/retry', requireAdmin('recurrence.runner.retry'), (req, res) => {
  const runner = getRecurrenceRunner();
  if (!runner) return res.status(503).json({ error: 'recurrence runner unavailable' });
  const result = runner.manualRetry(req.params.id, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.get('/', (req, res) => {
  const kind = req.query.kind ?? 'bill';
  if (!['bill', 'income', 'transaction', 'transfer'].includes(kind)) {
    return res.status(400).json({ error: 'unsupported recurring kind' });
  }
  if (kind === 'transaction') {
    return res.json(db.prepare(`SELECT s.*, t.account_id, t.category_id, t.amount,
        t.description, t.notes, t.transaction_type, t.metadata
      FROM recurring_series s
      JOIN recurring_transaction_templates t ON t.recurring_series_id = s.id
      WHERE s.user_id = ? AND s.kind = 'transaction'
      ORDER BY s.created_at DESC, s.id DESC`
    ).all(req.userId).map(serializeSeries));
  }
  if (kind === 'transfer') {
    return res.json(db.prepare(`SELECT s.*, t.from_account_id, t.to_account_id,
        t.amount, t.note, fa.name AS from_account_name, ta.name AS to_account_name
      FROM recurring_series s
      JOIN recurring_transfer_templates t ON t.recurring_series_id = s.id
      JOIN accounts fa ON fa.id = t.from_account_id
      JOIN accounts ta ON ta.id = t.to_account_id
      WHERE s.user_id = ? AND s.kind = 'transfer'
      ORDER BY s.created_at DESC, s.id DESC`
    ).all(req.userId).map(serializeSeries));
  }
  const entity = kind === 'bill'
    ? { table: 'bills', fields: 'e.due_day, e.category_id,' }
    : { table: 'income_schedules', fields: 'NULL AS due_day, NULL AS category_id,' };
  res.json(db.prepare(`
    SELECT s.*, e.id AS ${kind === 'bill' ? 'bill_id' : 'schedule_id'}, e.name, e.amount,
           ${entity.fields} e.account_id, e.active
    FROM recurring_series s
    JOIN ${entity.table} e ON e.recurring_series_id = s.id
    WHERE s.user_id = ? AND s.kind = ?
    ORDER BY s.created_at DESC, s.id DESC
  `).all(req.userId, kind).map(serializeSeries));
});

router.get('/:id', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  res.json(serializeSeries(series));
});

router.post('/:id/pause', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  const result = pauseSeries(db, series);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/resume', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  const result = ['transaction', 'transfer'].includes(series.kind)
    ? resumeAutomaticSeries(db, series, req.body?.resume_date)
    : resumeSeries(db, series, req.body?.resume_date);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/skip-next', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (series && !['transaction', 'transfer'].includes(series.kind)) {
    return res.status(404).json({ error: 'recurring series not found' });
  }
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  const result = skipNextAutomaticOccurrence(db, series);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/stop', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (series && !['transaction', 'transfer'].includes(series.kind)) {
    return res.status(404).json({ error: 'recurring series not found' });
  }
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  const result = stopAutomaticSeries(db, series);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.post('/:id/skip', (req, res) => {
  const series = getOwnedSeries(db, req.params.id, req.userId);
  if (!series) return res.status(404).json({ error: 'recurring series not found' });
  const result = skipOccurrence(db, series, req.body?.date);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

module.exports = router;
