const crypto = require('crypto');
const {
  automaticExecutionKinds, automaticSchedulingKinds, getRecurrenceAdapter,
} = require('./registry');
const { dateInTimeZone } = require('./dates');
const { scheduleAutomaticOccurrences } = require('./automatic-scheduler');
const { parseIntegerId } = require('../finance-validation');

function sqliteTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function safeFailureCode(error) {
  const value = String(error?.code ?? '').toUpperCase();
  return /^[A-Z0-9_]{1,40}$/.test(value) ? value : 'EXECUTION_FAILED';
}

function retryDelayMs(attempt, config) {
  return Math.min(config.retryBaseMs * (2 ** Math.max(0, attempt - 1)), config.retryMaxMs);
}

class RecurrenceRunner {
  constructor(db, config, options = {}) {
    this.db = db;
    this.config = config;
    this.now = options.now ?? (() => new Date());
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.runnerId = options.runnerId ?? crypto.randomUUID();
    this.timer = null;
    this.started = false;
    this.running = false;
    this.inFlight = null;
    this.lastRequestTriggerAt = 0;
  }

  start() {
    if (this.started) return false;
    this.started = true;
    const now = this.now();
    if (!this.config.enabled) {
      this._writeState({ active: 0, stopped_at: sqliteTime(now), next_run_at: null });
      return true;
    }
    const nextRun = new Date(now.getTime() + this.config.intervalMs);
    this._writeState({
      active: 1, started_at: sqliteTime(now), stopped_at: null,
      next_run_at: sqliteTime(nextRun),
    });
    this.inFlight = this.runOnce({ source: 'startup' });
    void this.inFlight.catch(() => {});
    this.timer = this.setIntervalFn(() => {
      void this.runOnce({ source: 'timer' }).catch(() => {});
      this._writeState({ next_run_at: sqliteTime(new Date(this.now().getTime() + this.config.intervalMs)) });
    }, this.config.intervalMs);
    this.timer?.unref?.();
    return true;
  }

  async stop() {
    if (!this.started && !this.timer) return false;
    this.started = false;
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    const pending = this.inFlight;
    if (pending) await pending;
    this._writeState({
      active: 0, stopped_at: sqliteTime(this.now()), next_run_at: null,
    });
    return true;
  }

  runOnce({ source = 'manual' } = {}) {
    if (this.running) return Promise.resolve({ skipped: 'overlap', processed: 0, failed: 0 });
    this.running = true;
    const promise = Promise.resolve().then(() => this._runBatch(source)).finally(() => {
      this.running = false;
      if (this.inFlight === promise) this.inFlight = null;
    });
    this.inFlight = promise;
    return promise;
  }

  triggerCatchUp() {
    if (!this.started || !this.config.enabled) {
      return Promise.resolve({ skipped: 'inactive', processed: 0, failed: 0 });
    }
    const nowMs = this.now().getTime();
    if (nowMs - this.lastRequestTriggerAt < this.config.requestThrottleMs) {
      return Promise.resolve({ skipped: 'throttled', processed: 0, failed: 0 });
    }
    this.lastRequestTriggerAt = nowMs;
    return this.runOnce({ source: 'request' });
  }

  diagnostics() {
    const persisted = this.db.prepare('SELECT * FROM recurrence_runner_state WHERE id = 1').get() ?? {};
    return {
      ...persisted,
      enabled: this.config.enabled,
      active: this.started && this.config.enabled,
      running: this.running,
      timer_active: Boolean(this.timer),
    };
  }

  manualRetry(occurrenceId, userId = null) {
    let numericId;
    try { numericId = parseIntegerId(occurrenceId, 'occurrence id'); }
    catch { return { error: 'invalid occurrence id', status: 400 }; }
    const occurrence = this.db.prepare(`SELECT ro.id, ro.status, s.user_id
      FROM recurring_occurrences ro JOIN recurring_series s ON s.id = ro.series_id
      WHERE ro.id = ?`).get(numericId);
    if (!occurrence || (userId != null && occurrence.user_id !== userId)) {
      return { error: 'occurrence not found', status: 404 };
    }
    if (occurrence.status !== 'failed') return { error: 'occurrence is not failed', status: 409 };
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM recurring_execution_claims WHERE occurrence_id = ?').run(numericId);
      this.db.prepare(`UPDATE recurring_occurrences
        SET attempt_count = 0, next_retry_at = ?, failure_code = NULL,
            updated_at = datetime('now') WHERE id = ?`
      ).run(sqliteTime(this.now()), numericId);
    })();
    return { ok: true, occurrence_id: numericId };
  }

  _runBatch(source) {
    const startedAt = this.now();
    const kinds = automaticExecutionKinds();
    let processed = 0;
    let failed = 0;
    if (kinds.length) {
      const placeholders = kinds.map(() => '?').join(',');
      const nowText = sqliteTime(startedAt);
      scheduleAutomaticOccurrences(
        this.db, automaticSchedulingKinds(), startedAt, this.config.batchSize
      );
      const upperDate = new Date(startedAt.getTime() + 86400000).toISOString().slice(0, 10);
      const candidates = this.db.prepare(`SELECT ro.*, s.kind, s.user_id, s.time_zone,
          s.status AS series_status
        FROM recurring_occurrences ro
        JOIN recurring_series s ON s.id = ro.series_id
        LEFT JOIN recurring_execution_claims c ON c.occurrence_id = ro.id AND c.expires_at > ?
        WHERE s.kind IN (${placeholders}) AND s.status = 'active'
          AND ro.scheduled_date <= ?
          AND (ro.status = 'scheduled'
            OR (ro.status = 'failed' AND ro.attempt_count < ?
              AND ro.next_retry_at IS NOT NULL AND ro.next_retry_at <= ?))
          AND c.occurrence_id IS NULL
        ORDER BY ro.scheduled_date ASC, ro.id ASC`).all(
        nowText, ...kinds, upperDate, this.config.maxAttempts, nowText
      );
      const rows = candidates.filter(row => (
        row.scheduled_date <= dateInTimeZone(startedAt, row.time_zone)
      )).slice(0, this.config.batchSize);

      for (const occurrence of rows) {
        if (!this._claim(occurrence.id, startedAt)) continue;
        try {
          const executed = this.db.transaction(() => {
            const current = this.db.prepare(`SELECT ro.*, s.kind, s.user_id,
                s.status AS series_status
              FROM recurring_occurrences ro JOIN recurring_series s ON s.id = ro.series_id
              WHERE ro.id = ?`).get(occurrence.id);
            if (!current || current.series_status !== 'active'
                || !['scheduled', 'failed'].includes(current.status)) {
              this.db.prepare('DELETE FROM recurring_execution_claims WHERE occurrence_id = ?')
                .run(occurrence.id);
              return false;
            }
            getRecurrenceAdapter(current.kind).executeOccurrence(this.db, current);
            this.db.prepare(`UPDATE recurring_occurrences
              SET status = 'generated', next_retry_at = NULL, failure_code = NULL,
                  updated_at = datetime('now') WHERE id = ?`).run(current.id);
            this.db.prepare(`UPDATE recurring_series SET status = 'completed',
              updated_at = datetime('now') WHERE id = ? AND status = 'active'
                AND next_due_date IS NULL`).run(current.series_id);
            this.db.prepare('DELETE FROM recurring_execution_claims WHERE occurrence_id = ?').run(current.id);
            return true;
          })();
          if (executed) processed += 1;
        } catch (error) {
          this._recordFailure(occurrence.id, error);
          failed += 1;
        }
      }
    }
    const finishedAt = this.now();
    this._writeState({
      last_run_at: sqliteTime(finishedAt), last_source: source,
      last_processed: processed, last_failed: failed,
    });
    return { processed, failed, source };
  }

  _claim(occurrenceId, now) {
    const expiryMs = Math.max(this.config.intervalMs * 2, 30000);
    const expiresAt = sqliteTime(new Date(now.getTime() + expiryMs));
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM recurring_execution_claims WHERE occurrence_id = ? AND expires_at <= ?')
        .run(occurrenceId, sqliteTime(now));
      return this.db.prepare(`INSERT OR IGNORE INTO recurring_execution_claims
        (occurrence_id, runner_id, claimed_at, expires_at) VALUES (?, ?, ?, ?)`
      ).run(occurrenceId, this.runnerId, sqliteTime(now), expiresAt).changes === 1;
    })();
  }

  _recordFailure(occurrenceId, error) {
    const now = this.now();
    this.db.transaction(() => {
      const current = this.db.prepare(
        'SELECT attempt_count FROM recurring_occurrences WHERE id = ?'
      ).get(occurrenceId);
      if (!current) return;
      const attempt = current.attempt_count + 1;
      const exhausted = attempt >= this.config.maxAttempts;
      const retryAt = exhausted ? null
        : sqliteTime(new Date(now.getTime() + retryDelayMs(attempt, this.config)));
      this.db.prepare(`UPDATE recurring_occurrences
        SET status = 'failed', attempt_count = ?, last_attempt_at = ?,
            next_retry_at = ?, failure_code = ?, updated_at = datetime('now')
        WHERE id = ?`
      ).run(attempt, sqliteTime(now), retryAt, safeFailureCode(error), occurrenceId);
      this.db.prepare('DELETE FROM recurring_execution_claims WHERE occurrence_id = ?').run(occurrenceId);
    })();
  }

  _writeState(values) {
    const entries = Object.entries(values);
    if (!entries.length) return;
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    this.db.prepare(`UPDATE recurrence_runner_state
      SET ${assignments}, updated_at = datetime('now') WHERE id = 1`
    ).run(...entries.map(([, value]) => value));
  }
}

function createRecurrenceRunner(db, config, options) {
  return new RecurrenceRunner(db, config, options);
}

module.exports = {
  RecurrenceRunner,
  createRecurrenceRunner,
  retryDelayMs,
  safeFailureCode,
  sqliteTime,
};
