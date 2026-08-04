const fs = require('fs');
const { occurrenceAt } = require('./lib/recurrence/dates');
const {
  MONEY_MAX_ABS, RECURRENCE_INTEGER_MAX, parseIntegerId, parseIsoDate,
  parseMoney, parsePositiveInteger, parsePositiveMoney,
} = require('./lib/finance-validation');

const MULTI_USER_SCHEMA_VERSION = 1;
const RECURRING_BILLS_SCHEMA_VERSION = 2;
const RECURRING_INCOME_SCHEMA_VERSION = 3;
const RECURRENCE_RUNNER_SCHEMA_VERSION = 4;
const RECURRING_TRANSACTIONS_SCHEMA_VERSION = 5;
const RECURRING_TRANSFERS_SCHEMA_VERSION = 6;
const SESSION_SECURITY_SCHEMA_VERSION = 7;
const FINANCIAL_CONSTRAINTS_SCHEMA_VERSION = 8;
const LOGIN_SECURITY_SCHEMA_VERSION = 9;

function assertSupportedSchemaVersion(db) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion > LOGIN_SECURITY_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this Outflow version supports (${LOGIN_SECURITY_SCHEMA_VERSION})`
    );
  }
  return currentVersion;
}

const OWNED_TABLES = [
  'categories',
  'accounts',
  'income_schedules',
  'bills',
  'income',
  'transactions',
  'transfers',
  'settings',
];

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table));
}

function columnExists(db, table, column) {
  return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all()
    .some(entry => entry.name === column);
}

function countRows(db, table) {
  return tableExists(db, table)
    ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
    : 0;
}

function nextBackupPath(dbPath) {
  const base = `${dbPath}.pre-multi-user-v1.backup`;
  if (!fs.existsSync(base)) return base;
  let suffix = 1;
  while (fs.existsSync(`${base}.${suffix}`)) suffix += 1;
  return `${base}.${suffix}`;
}

function nextNamedBackupPath(dbPath, label) {
  const base = `${dbPath}.${label}.backup`;
  if (!fs.existsSync(base)) return base;
  let suffix = 1;
  while (fs.existsSync(`${base}.${suffix}`)) suffix += 1;
  return `${base}.${suffix}`;
}

function createNamedMigrationBackup(db, dbPath, label) {
  if (!dbPath || dbPath === ':memory:') {
    throw new Error('A file-backed database is required to back up legacy data');
  }
  const backupPath = nextNamedBackupPath(dbPath, label);
  db.prepare('VACUUM INTO ?').run(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('Migration backup could not be verified');
  }
  return backupPath;
}

function createMigrationBackup(db, dbPath) {
  if (!dbPath || dbPath === ':memory:') {
    throw new Error('A file-backed database is required to back up legacy data');
  }
  const backupPath = nextBackupPath(dbPath);
  db.prepare('VACUUM INTO ?').run(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('Legacy database backup could not be verified');
  }
  return backupPath;
}

function rebuildCategories(db) {
  db.exec(`
    CREATE TABLE categories_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id),
      name       TEXT    NOT NULL,
      colour     TEXT    NOT NULL DEFAULT '#888888',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
    INSERT INTO categories_new (id, user_id, name, colour, created_at)
      SELECT id, NULL, name, colour, created_at FROM categories;
    DROP TABLE categories;
    ALTER TABLE categories_new RENAME TO categories;
  `);
}

function rebuildSettings(db) {
  db.exec(`
    CREATE TABLE settings_new (
      user_id INTEGER REFERENCES users(id),
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    INSERT INTO settings_new (user_id, key, value)
      SELECT NULL, key, value FROM settings;
    DROP TABLE settings;
    ALTER TABLE settings_new RENAME TO settings;
  `);
}

function ensureOwnershipTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS transactions_owner_insert
    BEFORE INSERT ON transactions
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'transaction ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS transactions_owner_update
    BEFORE UPDATE OF user_id, category_id, account_id ON transactions
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'transaction ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS income_owner_insert
    BEFORE INSERT ON income
    WHEN NEW.user_id IS NULL
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
      OR (NEW.source_schedule_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM income_schedules WHERE id = NEW.source_schedule_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'income ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS income_owner_update
    BEFORE UPDATE OF user_id, account_id, source_schedule_id ON income
    WHEN NEW.user_id IS NULL
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
      OR (NEW.source_schedule_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM income_schedules WHERE id = NEW.source_schedule_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'income ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS schedules_owner_insert
    BEFORE INSERT ON income_schedules
    WHEN NEW.user_id IS NULL
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'income schedule ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS schedules_owner_update
    BEFORE UPDATE OF user_id, account_id ON income_schedules
    WHEN NEW.user_id IS NULL
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'income schedule ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS bills_owner_insert
    BEFORE INSERT ON bills
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'bill ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS bills_owner_update
    BEFORE UPDATE OF user_id, category_id, account_id ON bills
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
      OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
      ))
    BEGIN
      SELECT RAISE(ABORT, 'bill ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS transfers_owner_insert
    BEFORE INSERT ON transfers
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND user_id = NEW.user_id)
      OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.to_account_id AND user_id = NEW.user_id)
    BEGIN
      SELECT RAISE(ABORT, 'transfer ownership violation');
    END;

    CREATE TRIGGER IF NOT EXISTS transfers_owner_update
    BEFORE UPDATE OF user_id, from_account_id, to_account_id ON transfers
    WHEN NEW.user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND user_id = NEW.user_id)
      OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.to_account_id AND user_id = NEW.user_id)
    BEGIN
      SELECT RAISE(ABORT, 'transfer ownership violation');
    END;
  `);
}

function ownershipViolations(db) {
  const checks = [
    ['transactions', `SELECT COUNT(*) AS count FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
      WHERE t.user_id IS NOT NULL AND (c.id IS NULL OR (t.account_id IS NOT NULL AND a.id IS NULL))`],
    ['income', `SELECT COUNT(*) AS count FROM income i
      LEFT JOIN accounts a ON a.id = i.account_id AND a.user_id = i.user_id
      LEFT JOIN income_schedules s ON s.id = i.source_schedule_id AND s.user_id = i.user_id
      WHERE i.user_id IS NOT NULL
        AND ((i.account_id IS NOT NULL AND a.id IS NULL)
          OR (i.source_schedule_id IS NOT NULL AND s.id IS NULL))`],
    ['income_schedules', `SELECT COUNT(*) AS count FROM income_schedules s
      LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
      WHERE s.user_id IS NOT NULL AND s.account_id IS NOT NULL AND a.id IS NULL`],
    ['bills', `SELECT COUNT(*) AS count FROM bills b
      LEFT JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
      LEFT JOIN accounts a ON a.id = b.account_id AND a.user_id = b.user_id
      WHERE b.user_id IS NOT NULL AND (c.id IS NULL OR (b.account_id IS NOT NULL AND a.id IS NULL))`],
    ['transfers', `SELECT COUNT(*) AS count FROM transfers t
      LEFT JOIN accounts fa ON fa.id = t.from_account_id
      LEFT JOIN accounts ta ON ta.id = t.to_account_id
      WHERE (t.user_id IS NOT NULL AND (
          fa.user_id IS NULL OR ta.user_id IS NULL
          OR fa.user_id != t.user_id OR ta.user_id != t.user_id
        ))
        OR (t.user_id IS NULL AND (fa.user_id IS NOT NULL OR ta.user_id IS NOT NULL))`],
  ];
  if (columnExists(db, 'transactions', 'recurring_occurrence_id')) {
    checks.push(['transaction recurrence', `SELECT COUNT(*) AS count FROM transactions t
      LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
      LEFT JOIN recurring_series rs ON rs.id = ro.series_id AND rs.kind = 'transaction'
        AND rs.user_id = t.user_id
      WHERE t.recurring_occurrence_id IS NOT NULL AND rs.id IS NULL`]);
  }
  if (tableExists(db, 'recurring_transaction_templates')) {
    checks.push(['recurring transaction templates', `SELECT COUNT(*) AS count
      FROM recurring_transaction_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = s.user_id
      LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = s.user_id
      WHERE s.kind != 'transaction' OR c.id IS NULL
        OR (t.account_id IS NOT NULL AND a.id IS NULL)`]);
  }
  if (columnExists(db, 'transfers', 'recurring_occurrence_id')) {
    checks.push(['transfer recurrence', `SELECT COUNT(*) AS count FROM transfers t
      LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
      LEFT JOIN recurring_series rs ON rs.id = ro.series_id AND rs.kind = 'transfer'
        AND rs.user_id = t.user_id
      WHERE t.recurring_occurrence_id IS NOT NULL AND rs.id IS NULL`]);
  }
  if (tableExists(db, 'recurring_transfer_templates')) {
    checks.push(['recurring transfer templates', `SELECT COUNT(*) AS count
      FROM recurring_transfer_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      LEFT JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = s.user_id
      LEFT JOIN accounts ta ON ta.id = t.to_account_id AND ta.user_id = s.user_id
      WHERE s.kind != 'transfer' OR fa.id IS NULL OR ta.id IS NULL
        OR t.from_account_id = t.to_account_id`]);
  }
  const violations = checks
    .map(([table, sql]) => ({ table, count: db.prepare(sql).get().count }))
    .filter(result => result.count > 0);
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) {
    for (const table of OWNED_TABLES) {
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id IS NULL`).get().count;
      if (count > 0 && !violations.some(result => result.table === table)) {
        violations.push({ table, count });
      }
    }
  }
  return violations;
}

function migrateToMultiUserV1(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= MULTI_USER_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null, legacyRows: 0 };
  }

  const requiresCategoryRebuild = !columnExists(db, 'categories', 'user_id');
  const requiresSettingsRebuild = !columnExists(db, 'settings', 'user_id');
  const requiresOwnershipColumns = OWNED_TABLES
    .filter(table => tableExists(db, table) && !columnExists(db, table, 'user_id'));
  const legacyRows = OWNED_TABLES.reduce((total, table) => total + countRows(db, table), 0)
    + countRows(db, 'bill_months');
  const destructiveRebuild = requiresCategoryRebuild || requiresSettingsRebuild;
  const backupPath = destructiveRebuild && legacyRows > 0
    ? createMigrationBackup(db, dbPath)
    : null;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    INTEGER PRIMARY KEY,
          name       TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      if (requiresCategoryRebuild) rebuildCategories(db);
      if (requiresSettingsRebuild) rebuildSettings(db);

      for (const table of requiresOwnershipColumns) {
        if (table === 'categories' || table === 'settings') continue;
        db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id)`);
      }

      if (!columnExists(db, 'users', 'avatar')) {
        db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
      }

      // Historical transfer rows predate their user_id population. Infer ownership
      // only when both endpoints belong to the same user.
      db.exec(`
        UPDATE transfers
        SET user_id = (
          SELECT f.user_id FROM accounts f
          JOIN accounts t ON t.id = transfers.to_account_id
          WHERE f.id = transfers.from_account_id
            AND f.user_id = t.user_id
        )
        WHERE user_id IS NULL
      `);

      const violations = ownershipViolations(db);
      if (violations.length) {
        throw new Error(`Existing cross-user references detected: ${JSON.stringify(violations)}`);
      }

      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (foreignKeyErrors.length) {
        throw new Error(`Foreign-key check failed during migration: ${JSON.stringify(foreignKeyErrors)}`);
      }

      ensureOwnershipTriggers(db);
      beforeCommit?.(db);
      db.prepare(`INSERT OR REPLACE INTO schema_migrations (version, name)
        VALUES (?, ?)`).run(MULTI_USER_SCHEMA_VERSION, 'preserve-legacy-multi-user');
      db.pragma(`user_version = ${MULTI_USER_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) {
    throw new Error(`Foreign-key check failed after migration: ${JSON.stringify(foreignKeyErrors)}`);
  }

  return { migrated: true, backupPath, legacyRows };
}

function hasPendingLegacyData(db) {
  return OWNED_TABLES.some(table => columnExists(db, table, 'user_id')
    && db.prepare(`SELECT 1 FROM ${table} WHERE user_id IS NULL LIMIT 1`).get());
}

function claimLegacyData(db, userId) {
  if (!hasPendingLegacyData(db)) return false;

  db.prepare('UPDATE categories SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE accounts SET user_id = ? WHERE user_id IS NULL').run(userId);
  if (tableExists(db, 'recurring_series')) {
    db.prepare('UPDATE recurring_series SET user_id = ? WHERE user_id IS NULL').run(userId);
  }
  db.prepare('UPDATE income_schedules SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE bills SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE income SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE transactions SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE transfers SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE settings SET user_id = ? WHERE user_id IS NULL').run(userId);

  const pending = OWNED_TABLES.filter(table => db.prepare(
    `SELECT 1 FROM ${table} WHERE user_id IS NULL LIMIT 1`
  ).get());
  if (pending.length) throw new Error(`Legacy ownership assignment incomplete: ${pending.join(', ')}`);

  const violations = ownershipViolations(db);
  if (violations.length) {
    throw new Error(`Legacy ownership validation failed: ${JSON.stringify(violations)}`);
  }
  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) {
    throw new Error(`Legacy foreign-key validation failed: ${JSON.stringify(foreignKeyErrors)}`);
  }
  return true;
}

function resolveLegacyBillDate(dueDay, year, month) {
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dueDay, dim)).padStart(2, '0')}`;
}

function migrateRecurringBillsV2(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= RECURRING_BILLS_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null, bills: 0, occurrences: 0 };
  }
  if (currentVersion < MULTI_USER_SCHEMA_VERSION) {
    throw new Error('Multi-user migration must run before recurring bills migration');
  }

  const billCount = countRows(db, 'bills');
  const occurrenceCount = countRows(db, 'bill_months');
  const backupPath = billCount + occurrenceCount > 0
    ? createNamedMigrationBackup(db, dbPath, 'pre-recurring-bills-v2')
    : null;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE recurring_series (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id            INTEGER REFERENCES users(id),
          kind               TEXT    NOT NULL,
          frequency_unit     TEXT    NOT NULL CHECK(frequency_unit IN ('day','week','month','year')),
          frequency_interval INTEGER NOT NULL CHECK(frequency_interval >= 1),
          start_date         TEXT    NOT NULL,
          anchor_day         INTEGER CHECK(anchor_day BETWEEN 1 AND 31),
          anchor_month       INTEGER CHECK(anchor_month BETWEEN 1 AND 12),
          time_zone          TEXT    NOT NULL DEFAULT 'UTC',
          end_mode           TEXT    NOT NULL DEFAULT 'never' CHECK(end_mode IN ('never','date','count')),
          end_date           TEXT,
          max_occurrences    INTEGER,
          status             TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','error','deleted')),
          next_due_date      TEXT,
          next_sequence      INTEGER NOT NULL DEFAULT 1,
          revision           INTEGER NOT NULL DEFAULT 1,
          paused_at          TEXT,
          deleted_at         TEXT,
          created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
          CHECK((end_mode = 'never' AND end_date IS NULL AND max_occurrences IS NULL)
             OR (end_mode = 'date' AND end_date IS NOT NULL AND max_occurrences IS NULL)
             OR (end_mode = 'count' AND end_date IS NULL AND max_occurrences >= 1))
        );

        CREATE TABLE recurring_occurrences (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          series_id         INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
          scheduled_date    TEXT    NOT NULL,
          sequence          INTEGER NOT NULL,
          series_revision   INTEGER NOT NULL,
          status            TEXT    NOT NULL CHECK(status IN ('scheduled','generated','skipped','failed','deleted')),
          skip_reason       TEXT,
          attempt_count     INTEGER NOT NULL DEFAULT 0,
          last_attempt_at   TEXT,
          next_retry_at     TEXT,
          failure_code      TEXT,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(series_id, scheduled_date),
          UNIQUE(series_id, sequence)
        );

        CREATE INDEX recurring_series_due_idx ON recurring_series(status, next_due_date);
        CREATE INDEX recurring_series_user_kind_idx ON recurring_series(user_id, kind, status);
        CREATE INDEX recurring_occurrences_status_idx ON recurring_occurrences(status, next_retry_at);
      `);

      if (!columnExists(db, 'bills', 'recurring_series_id')) {
        db.exec('ALTER TABLE bills ADD COLUMN recurring_series_id INTEGER REFERENCES recurring_series(id)');
      }

      const bills = db.prepare('SELECT * FROM bills ORDER BY id').all();
      const oldMonths = db.prepare('SELECT * FROM bill_months ORDER BY bill_id, year, month, id').all();
      const monthsByBill = new Map();
      for (const row of oldMonths) {
        if (!monthsByBill.has(row.bill_id)) monthsByBill.set(row.bill_id, []);
        monthsByBill.get(row.bill_id).push(row);
      }

      const insertSeries = db.prepare(`
        INSERT INTO recurring_series
          (user_id, kind, frequency_unit, frequency_interval, start_date,
           anchor_day, time_zone, end_mode, status, next_due_date,
           next_sequence, deleted_at, created_at, updated_at)
        VALUES (?, 'bill', 'month', 1, ?, ?, 'UTC', 'never', ?, ?, ?, ?, ?, ?)
      `);
      const updateBill = db.prepare('UPDATE bills SET recurring_series_id = ? WHERE id = ?');
      const insertOccurrence = db.prepare(`
        INSERT INTO recurring_occurrences
          (series_id, scheduled_date, sequence, series_revision, status)
        VALUES (?, ?, ?, 1, 'generated')
      `);

      const occurrenceByOldId = new Map();
      for (const bill of bills) {
        const months = monthsByBill.get(bill.id) ?? [];
        const created = String(bill.created_at ?? '').slice(0, 10);
        const createdYear = Number(created.slice(0, 4)) || new Date().getUTCFullYear();
        const createdMonth = Number(created.slice(5, 7)) || new Date().getUTCMonth() + 1;
        const first = months[0];
        const startDate = first
          ? resolveLegacyBillDate(bill.due_day, first.year, first.month)
          : resolveLegacyBillDate(bill.due_day, createdYear, createdMonth);
        const nextSequence = months.length
          ? ((months.at(-1).year - Number(startDate.slice(0, 4))) * 12
              + months.at(-1).month - Number(startDate.slice(5, 7)) + 2)
          : 1;
        const seriesShape = {
          start_date: startDate,
          frequency_unit: 'month',
          frequency_interval: 1,
          anchor_day: bill.due_day,
        };
        const nextDate = bill.active ? occurrenceAt(seriesShape, nextSequence) : null;
        const series = insertSeries.run(
          bill.user_id, startDate, bill.due_day,
          bill.active ? 'active' : 'deleted', nextDate, nextSequence,
          bill.active ? null : bill.cancelled_at,
          bill.created_at, bill.cancelled_at ?? bill.created_at
        );
        const seriesId = Number(series.lastInsertRowid);
        updateBill.run(seriesId, bill.id);

        for (const row of months) {
          const dueDate = resolveLegacyBillDate(bill.due_day, row.year, row.month);
          const sequence = (row.year - Number(startDate.slice(0, 4))) * 12
            + row.month - Number(startDate.slice(5, 7)) + 1;
          const occurrence = insertOccurrence.run(seriesId, dueDate, sequence);
          occurrenceByOldId.set(row.id, { occurrenceId: Number(occurrence.lastInsertRowid), dueDate });
        }
      }

      db.exec(`
        CREATE TABLE bill_months_new (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id                 INTEGER NOT NULL REFERENCES bills(id),
          year                    INTEGER NOT NULL,
          month                   INTEGER NOT NULL,
          due_date                TEXT    NOT NULL,
          recurring_occurrence_id INTEGER UNIQUE REFERENCES recurring_occurrences(id),
          paid                    INTEGER NOT NULL DEFAULT 0,
          amount_paid             REAL,
          paid_date               TEXT,
          UNIQUE(bill_id, due_date)
        )
      `);
      const insertBillMonth = db.prepare(`
        INSERT INTO bill_months_new
          (id, bill_id, year, month, due_date, recurring_occurrence_id, paid, amount_paid, paid_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of oldMonths) {
        const link = occurrenceByOldId.get(row.id);
        insertBillMonth.run(
          row.id, row.bill_id, row.year, row.month, link.dueDate, link.occurrenceId,
          row.paid, row.amount_paid, row.paid_date
        );
      }
      db.exec('DROP TABLE bill_months; ALTER TABLE bill_months_new RENAME TO bill_months;');
      db.exec('CREATE INDEX bill_months_period_idx ON bill_months(year, month, due_date)');

      db.exec(`
        CREATE TRIGGER bills_recurrence_owner_insert
        BEFORE INSERT ON bills
        WHEN NEW.recurring_series_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_series s
          WHERE s.id = NEW.recurring_series_id AND s.kind = 'bill' AND s.user_id IS NEW.user_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'bill recurrence ownership violation');
        END;

        CREATE TRIGGER bills_recurrence_owner_update
        BEFORE UPDATE OF user_id, recurring_series_id ON bills
        WHEN NEW.recurring_series_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_series s
          WHERE s.id = NEW.recurring_series_id AND s.kind = 'bill' AND s.user_id IS NEW.user_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'bill recurrence ownership violation');
        END;

        CREATE TRIGGER recurring_series_bill_owner_update
        BEFORE UPDATE OF user_id ON recurring_series
        WHEN NEW.kind = 'bill' AND EXISTS (
          SELECT 1 FROM bills b
          WHERE b.recurring_series_id = NEW.id
            AND b.user_id IS NOT NULL
            AND (NEW.user_id IS NULL OR b.user_id != NEW.user_id)
        )
        BEGIN
          SELECT RAISE(ABORT, 'recurring series ownership violation');
        END;
      `);

      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (foreignKeyErrors.length) {
        throw new Error(`Foreign-key check failed during recurring bills migration: ${JSON.stringify(foreignKeyErrors)}`);
      }
      beforeCommit?.(db);
      db.prepare(`INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)`)
        .run(RECURRING_BILLS_SCHEMA_VERSION, 'recurring-bills-foundation');
      db.pragma(`user_version = ${RECURRING_BILLS_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) {
    throw new Error(`Foreign-key check failed after recurring bills migration: ${JSON.stringify(foreignKeyErrors)}`);
  }
  return { migrated: true, backupPath, bills: billCount, occurrences: occurrenceCount };
}

function legacyIncomeStart(schedule, rows) {
  const firstDate = rows[0]?.date;
  if (schedule.frequency === 'monthly') {
    const created = String(schedule.created_at ?? '').slice(0, 10);
    const year = Number((firstDate ?? created).slice(0, 4)) || new Date().getUTCFullYear();
    const month = Number((firstDate ?? created).slice(5, 7)) || new Date().getUTCMonth() + 1;
    return resolveLegacyBillDate(schedule.day_of_month, year, month);
  }
  if (firstDate && (!schedule.anchor_date || firstDate < schedule.anchor_date)) return firstDate;
  return schedule.anchor_date || firstDate;
}

function legacyIncomeSequence(series, date) {
  const start = new Date(`${series.start_date}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  if (series.frequency_unit === 'week') {
    return Math.round((target - start) / 86400000 / (7 * series.frequency_interval)) + 1;
  }
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  return Math.round(((targetYear - startYear) * 12 + targetMonth - startMonth)
    / series.frequency_interval) + 1;
}

function migrateRecurringIncomeV3(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= RECURRING_INCOME_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null, schedules: 0, occurrences: 0 };
  }
  if (currentVersion < RECURRING_BILLS_SCHEMA_VERSION) {
    throw new Error('Recurring Bills migration must run before Recurring Income migration');
  }

  const scheduleCount = countRows(db, 'income_schedules');
  const incomeCount = countRows(db, 'income');
  const backupPath = scheduleCount + incomeCount > 0
    ? createNamedMigrationBackup(db, dbPath, 'pre-recurring-income-v3')
    : null;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const schedules = db.prepare('SELECT * FROM income_schedules ORDER BY id').all();
      const incomeRows = db.prepare('SELECT * FROM income ORDER BY id').all();
      const rowsBySchedule = new Map();
      for (const row of incomeRows) {
        if (row.source_schedule_id == null) continue;
        if (!rowsBySchedule.has(row.source_schedule_id)) rowsBySchedule.set(row.source_schedule_id, []);
        rowsBySchedule.get(row.source_schedule_id).push(row);
      }

      const insertSeries = db.prepare(`INSERT INTO recurring_series
        (user_id, kind, frequency_unit, frequency_interval, start_date,
         anchor_day, anchor_month, time_zone, end_mode, status,
         next_due_date, next_sequence, deleted_at, created_at, updated_at)
        VALUES (?, 'income', ?, ?, ?, ?, NULL, 'UTC', 'never', ?, ?, ?, ?, ?, ?)`);
      const seriesBySchedule = new Map();
      for (const schedule of schedules) {
        const rows = (rowsBySchedule.get(schedule.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
        const startDate = legacyIncomeStart(schedule, rows);
        if (!startDate) throw new Error(`Income schedule ${schedule.id} has no valid start date`);
        const config = schedule.frequency === 'monthly'
          ? { unit: 'month', interval: 1, anchorDay: schedule.day_of_month }
          : { unit: 'week', interval: schedule.frequency === 'four_weekly' ? 4 : 1,
              anchorDay: Number(startDate.slice(8, 10)) };
        const shape = {
          start_date: startDate,
          frequency_unit: config.unit,
          frequency_interval: config.interval,
          anchor_day: config.anchorDay,
        };
        let nextSequence = 1;
        for (const row of rows) nextSequence = Math.max(nextSequence, legacyIncomeSequence(shape, row.date) + 1);
        const status = schedule.active ? 'active' : 'deleted';
        const seriesResult = insertSeries.run(
          schedule.user_id, config.unit, config.interval, startDate, config.anchorDay,
          status, schedule.active ? occurrenceAt(shape, nextSequence) : null, nextSequence,
          schedule.active ? null : schedule.created_at, schedule.created_at, schedule.created_at
        );
        seriesBySchedule.set(schedule.id, {
          id: Number(seriesResult.lastInsertRowid), shape,
        });
      }

      db.exec(`
        CREATE TABLE income_schedules_new (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          name                TEXT    NOT NULL,
          amount              REAL    NOT NULL,
          frequency           TEXT    NOT NULL CHECK(frequency IN ('daily','weekly','fortnightly','four_weekly','monthly','quarterly','yearly')),
          day_of_month        INTEGER,
          anchor_date         TEXT,
          active              INTEGER NOT NULL DEFAULT 1,
          created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
          account_id          INTEGER REFERENCES accounts(id),
          user_id             INTEGER REFERENCES users(id),
          recurring_series_id INTEGER NOT NULL UNIQUE REFERENCES recurring_series(id)
        )
      `);
      const insertSchedule = db.prepare(`INSERT INTO income_schedules_new
        (id, name, amount, frequency, day_of_month, anchor_date, active,
         created_at, account_id, user_id, recurring_series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const schedule of schedules) {
        insertSchedule.run(
          schedule.id, schedule.name, schedule.amount, schedule.frequency,
          schedule.day_of_month, schedule.anchor_date, schedule.active,
          schedule.created_at, schedule.account_id, schedule.user_id,
          seriesBySchedule.get(schedule.id).id
        );
      }

      db.exec(`
        CREATE TABLE income_new (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          amount                  REAL NOT NULL,
          description             TEXT NOT NULL,
          date                    TEXT NOT NULL,
          created_at              TEXT NOT NULL DEFAULT (datetime('now')),
          account_id              INTEGER REFERENCES accounts(id),
          source_schedule_id      INTEGER REFERENCES income_schedules_new(id),
          user_id                 INTEGER REFERENCES users(id),
          recurring_occurrence_id INTEGER UNIQUE REFERENCES recurring_occurrences(id)
        )
      `);
      const insertOccurrence = db.prepare(`INSERT INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'generated', ?, ?)`);
      const insertIncome = db.prepare(`INSERT INTO income_new
        (id, amount, description, date, created_at, account_id,
         source_schedule_id, user_id, recurring_occurrence_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of incomeRows) {
        let occurrenceId = null;
        if (row.source_schedule_id != null) {
          const series = seriesBySchedule.get(row.source_schedule_id);
          if (!series) throw new Error(`Income ${row.id} references a missing schedule`);
          const occurrence = insertOccurrence.run(
            series.id, row.date, legacyIncomeSequence(series.shape, row.date),
            row.created_at, row.created_at
          );
          occurrenceId = Number(occurrence.lastInsertRowid);
        }
        insertIncome.run(
          row.id, row.amount, row.description, row.date, row.created_at,
          row.account_id, row.source_schedule_id, row.user_id, occurrenceId
        );
      }

      db.exec(`
        DROP TABLE income;
        DROP TABLE income_schedules;
        ALTER TABLE income_schedules_new RENAME TO income_schedules;
        ALTER TABLE income_new RENAME TO income;
        CREATE INDEX income_period_idx ON income(user_id, date);
        CREATE INDEX income_schedule_idx ON income(source_schedule_id, date);

        CREATE TRIGGER schedules_owner_insert
        BEFORE INSERT ON income_schedules
        WHEN NEW.user_id IS NULL
          OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
          ))
          OR NOT EXISTS (
            SELECT 1 FROM recurring_series s
            WHERE s.id = NEW.recurring_series_id AND s.kind = 'income' AND s.user_id IS NEW.user_id
          )
        BEGIN SELECT RAISE(ABORT, 'income schedule ownership violation'); END;

        CREATE TRIGGER schedules_owner_update
        BEFORE UPDATE OF user_id, account_id, recurring_series_id ON income_schedules
        WHEN NEW.user_id IS NULL
          OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
          ))
          OR NOT EXISTS (
            SELECT 1 FROM recurring_series s
            WHERE s.id = NEW.recurring_series_id AND s.kind = 'income' AND s.user_id IS NEW.user_id
          )
        BEGIN SELECT RAISE(ABORT, 'income schedule ownership violation'); END;

        CREATE TRIGGER income_owner_insert
        BEFORE INSERT ON income
        WHEN NEW.user_id IS NULL
          OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
          ))
          OR (NEW.source_schedule_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM income_schedules WHERE id = NEW.source_schedule_id AND user_id = NEW.user_id
          ))
          OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM recurring_occurrences ro JOIN recurring_series s ON s.id = ro.series_id
            WHERE ro.id = NEW.recurring_occurrence_id AND s.kind = 'income' AND s.user_id = NEW.user_id
          ))
        BEGIN SELECT RAISE(ABORT, 'income ownership violation'); END;

        CREATE TRIGGER income_owner_update
        BEFORE UPDATE OF user_id, account_id, source_schedule_id, recurring_occurrence_id ON income
        WHEN NEW.user_id IS NULL
          OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
          ))
          OR (NEW.source_schedule_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM income_schedules WHERE id = NEW.source_schedule_id AND user_id = NEW.user_id
          ))
          OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM recurring_occurrences ro JOIN recurring_series s ON s.id = ro.series_id
            WHERE ro.id = NEW.recurring_occurrence_id AND s.kind = 'income' AND s.user_id = NEW.user_id
          ))
        BEGIN SELECT RAISE(ABORT, 'income ownership violation'); END;

        CREATE TRIGGER recurring_series_income_owner_update
        BEFORE UPDATE OF user_id ON recurring_series
        WHEN NEW.kind = 'income' AND EXISTS (
          SELECT 1 FROM income_schedules s
          WHERE s.recurring_series_id = NEW.id AND s.user_id IS NOT NULL
            AND (NEW.user_id IS NULL OR s.user_id != NEW.user_id)
        )
        BEGIN SELECT RAISE(ABORT, 'recurring series ownership violation'); END;
      `);

      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (foreignKeyErrors.length) {
        throw new Error(`Foreign-key check failed during recurring income migration: ${JSON.stringify(foreignKeyErrors)}`);
      }
      beforeCommit?.(db);
      db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(RECURRING_INCOME_SCHEMA_VERSION, 'recurring-income-foundation');
      db.pragma(`user_version = ${RECURRING_INCOME_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) {
    throw new Error(`Foreign-key check failed after recurring income migration: ${JSON.stringify(foreignKeyErrors)}`);
  }
  return { migrated: true, backupPath, schedules: scheduleCount, occurrences: incomeCount };
}

function migrateRecurrenceRunnerV4(db, { beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= RECURRENCE_RUNNER_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null };
  }
  if (currentVersion < RECURRING_INCOME_SCHEMA_VERSION) {
    throw new Error('Recurring Income migration must run before runner migration');
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE recurring_execution_claims (
        occurrence_id INTEGER PRIMARY KEY REFERENCES recurring_occurrences(id) ON DELETE CASCADE,
        runner_id     TEXT NOT NULL,
        claimed_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL
      );
      CREATE INDEX recurring_execution_claims_expiry_idx
        ON recurring_execution_claims(expires_at);

      CREATE TABLE recurrence_runner_state (
        id             INTEGER PRIMARY KEY CHECK(id = 1),
        active         INTEGER NOT NULL DEFAULT 0,
        started_at     TEXT,
        stopped_at     TEXT,
        last_run_at    TEXT,
        last_source    TEXT,
        last_processed INTEGER NOT NULL DEFAULT 0,
        last_failed    INTEGER NOT NULL DEFAULT 0,
        next_run_at    TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO recurrence_runner_state(id) VALUES (1);
    `);
    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(RECURRENCE_RUNNER_SCHEMA_VERSION, 'recurrence-runner-infrastructure');
    db.pragma(`user_version = ${RECURRENCE_RUNNER_SCHEMA_VERSION}`);
  })();
  return { migrated: true, backupPath: null };
}

function migrateRecurringTransactionsV5(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= RECURRING_TRANSACTIONS_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null, transactions: 0 };
  }
  if (currentVersion < RECURRENCE_RUNNER_SCHEMA_VERSION) {
    throw new Error('Recurrence runner migration must run before recurring transactions migration');
  }

  const transactionCount = countRows(db, 'transactions');
  const backupPath = transactionCount > 0
    ? createNamedMigrationBackup(db, dbPath, 'pre-recurring-transactions-v5')
    : null;

  db.transaction(() => {
    if (!columnExists(db, 'transactions', 'recurring_occurrence_id')) {
      db.exec(`ALTER TABLE transactions ADD COLUMN recurring_occurrence_id INTEGER
        REFERENCES recurring_occurrences(id)`);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_occurrence_idx
        ON transactions(recurring_occurrence_id)
        WHERE recurring_occurrence_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS recurring_transaction_templates (
        recurring_series_id INTEGER PRIMARY KEY
          REFERENCES recurring_series(id) ON DELETE CASCADE,
        account_id          INTEGER REFERENCES accounts(id),
        category_id         INTEGER NOT NULL REFERENCES categories(id),
        amount              REAL NOT NULL,
        description         TEXT NOT NULL,
        notes               TEXT,
        transaction_type    TEXT NOT NULL DEFAULT 'expense',
        metadata            TEXT NOT NULL DEFAULT '{}',
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS recurring_transaction_templates_account_idx
        ON recurring_transaction_templates(account_id);
      CREATE INDEX IF NOT EXISTS recurring_transaction_templates_category_idx
        ON recurring_transaction_templates(category_id);

      DROP TRIGGER IF EXISTS transactions_owner_insert;
      DROP TRIGGER IF EXISTS transactions_owner_update;
      CREATE TRIGGER transactions_owner_insert
      BEFORE INSERT ON transactions
      WHEN NEW.user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
        OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
        ))
        OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_occurrences ro
          JOIN recurring_series s ON s.id = ro.series_id
          WHERE ro.id = NEW.recurring_occurrence_id
            AND s.kind = 'transaction' AND s.user_id = NEW.user_id
        ))
      BEGIN SELECT RAISE(ABORT, 'transaction ownership violation'); END;

      CREATE TRIGGER transactions_owner_update
      BEFORE UPDATE OF user_id, category_id, account_id, recurring_occurrence_id ON transactions
      WHEN NEW.user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND user_id = NEW.user_id)
        OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
        ))
        OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_occurrences ro
          JOIN recurring_series s ON s.id = ro.series_id
          WHERE ro.id = NEW.recurring_occurrence_id
            AND s.kind = 'transaction' AND s.user_id = NEW.user_id
        ))
      BEGIN SELECT RAISE(ABORT, 'transaction ownership violation'); END;

      CREATE TRIGGER recurring_transaction_templates_owner_insert
      BEFORE INSERT ON recurring_transaction_templates
      WHEN NOT EXISTS (
        SELECT 1 FROM recurring_series s
        WHERE s.id = NEW.recurring_series_id AND s.kind = 'transaction'
          AND EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.user_id = s.user_id)
          AND (NEW.account_id IS NULL OR EXISTS (
            SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.user_id = s.user_id
          ))
      )
      BEGIN SELECT RAISE(ABORT, 'recurring transaction ownership violation'); END;

      CREATE TRIGGER recurring_transaction_templates_owner_update
      BEFORE UPDATE OF recurring_series_id, category_id, account_id ON recurring_transaction_templates
      WHEN NOT EXISTS (
        SELECT 1 FROM recurring_series s
        WHERE s.id = NEW.recurring_series_id AND s.kind = 'transaction'
          AND EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.user_id = s.user_id)
          AND (NEW.account_id IS NULL OR EXISTS (
            SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.user_id = s.user_id
          ))
      )
      BEGIN SELECT RAISE(ABORT, 'recurring transaction ownership violation'); END;

      CREATE TRIGGER recurring_series_transaction_owner_update
      BEFORE UPDATE OF user_id, kind ON recurring_series
      WHEN EXISTS (
        SELECT 1 FROM recurring_transaction_templates t
        LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = NEW.user_id
        LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = NEW.user_id
        WHERE t.recurring_series_id = NEW.id
          AND (NEW.kind != 'transaction' OR c.id IS NULL
            OR (t.account_id IS NOT NULL AND a.id IS NULL))
      )
      BEGIN SELECT RAISE(ABORT, 'recurring series ownership violation'); END;
    `);

    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length) {
      throw new Error(`Foreign-key check failed during recurring transactions migration: ${JSON.stringify(foreignKeyErrors)}`);
    }
    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(RECURRING_TRANSACTIONS_SCHEMA_VERSION, 'recurring-transactions');
    db.pragma(`user_version = ${RECURRING_TRANSACTIONS_SCHEMA_VERSION}`);
  })();
  return { migrated: true, backupPath, transactions: transactionCount };
}

function migrateRecurringTransfersV6(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion >= RECURRING_TRANSFERS_SCHEMA_VERSION) {
    return { migrated: false, backupPath: null, transfers: 0 };
  }
  if (currentVersion < RECURRING_TRANSACTIONS_SCHEMA_VERSION) {
    throw new Error('Recurring Transactions migration must run before recurring transfers migration');
  }

  const transferCount = countRows(db, 'transfers');
  const backupPath = transferCount > 0
    ? createNamedMigrationBackup(db, dbPath, 'pre-recurring-transfers-v6')
    : null;

  db.transaction(() => {
    if (!columnExists(db, 'transfers', 'recurring_occurrence_id')) {
      db.exec(`ALTER TABLE transfers ADD COLUMN recurring_occurrence_id INTEGER
        REFERENCES recurring_occurrences(id)`);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS transfers_recurring_occurrence_idx
        ON transfers(recurring_occurrence_id)
        WHERE recurring_occurrence_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS recurring_transfer_templates (
        recurring_series_id INTEGER PRIMARY KEY
          REFERENCES recurring_series(id) ON DELETE CASCADE,
        from_account_id     INTEGER NOT NULL REFERENCES accounts(id),
        to_account_id       INTEGER NOT NULL REFERENCES accounts(id),
        amount              REAL NOT NULL CHECK(amount > 0),
        note                TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK(from_account_id != to_account_id)
      );
      CREATE INDEX IF NOT EXISTS recurring_transfer_templates_from_account_idx
        ON recurring_transfer_templates(from_account_id);
      CREATE INDEX IF NOT EXISTS recurring_transfer_templates_to_account_idx
        ON recurring_transfer_templates(to_account_id);

      DROP TRIGGER IF EXISTS transfers_owner_insert;
      DROP TRIGGER IF EXISTS transfers_owner_update;
      CREATE TRIGGER transfers_owner_insert
      BEFORE INSERT ON transfers
      WHEN NEW.user_id IS NULL OR NEW.from_account_id = NEW.to_account_id
        OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND user_id = NEW.user_id)
        OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.to_account_id AND user_id = NEW.user_id)
        OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_occurrences ro
          JOIN recurring_series s ON s.id = ro.series_id
          WHERE ro.id = NEW.recurring_occurrence_id
            AND s.kind = 'transfer' AND s.user_id = NEW.user_id
        ))
      BEGIN SELECT RAISE(ABORT, 'transfer ownership violation'); END;

      CREATE TRIGGER transfers_owner_update
      BEFORE UPDATE OF user_id, from_account_id, to_account_id, recurring_occurrence_id ON transfers
      WHEN NEW.user_id IS NULL OR NEW.from_account_id = NEW.to_account_id
        OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.from_account_id AND user_id = NEW.user_id)
        OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.to_account_id AND user_id = NEW.user_id)
        OR (NEW.recurring_occurrence_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_occurrences ro
          JOIN recurring_series s ON s.id = ro.series_id
          WHERE ro.id = NEW.recurring_occurrence_id
            AND s.kind = 'transfer' AND s.user_id = NEW.user_id
        ))
      BEGIN SELECT RAISE(ABORT, 'transfer ownership violation'); END;

      CREATE TRIGGER recurring_transfer_templates_owner_insert
      BEFORE INSERT ON recurring_transfer_templates
      WHEN NOT EXISTS (
        SELECT 1 FROM recurring_series s
        WHERE s.id = NEW.recurring_series_id AND s.kind = 'transfer'
          AND NEW.from_account_id != NEW.to_account_id
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.from_account_id
            AND a.user_id = s.user_id AND a.active = 1)
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.to_account_id
            AND a.user_id = s.user_id AND a.active = 1)
      )
      BEGIN SELECT RAISE(ABORT, 'recurring transfer ownership violation'); END;

      CREATE TRIGGER recurring_transfer_templates_owner_update
      BEFORE UPDATE OF recurring_series_id, from_account_id, to_account_id ON recurring_transfer_templates
      WHEN NOT EXISTS (
        SELECT 1 FROM recurring_series s
        WHERE s.id = NEW.recurring_series_id AND s.kind = 'transfer'
          AND NEW.from_account_id != NEW.to_account_id
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.from_account_id
            AND a.user_id = s.user_id AND a.active = 1)
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.to_account_id
            AND a.user_id = s.user_id AND a.active = 1)
      )
      BEGIN SELECT RAISE(ABORT, 'recurring transfer ownership violation'); END;

      CREATE TRIGGER recurring_series_transfer_owner_update
      BEFORE UPDATE OF user_id, kind ON recurring_series
      WHEN EXISTS (
        SELECT 1 FROM recurring_transfer_templates t
        LEFT JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = NEW.user_id
        LEFT JOIN accounts ta ON ta.id = t.to_account_id AND ta.user_id = NEW.user_id
        WHERE t.recurring_series_id = NEW.id
          AND (NEW.kind != 'transfer' OR fa.id IS NULL OR ta.id IS NULL
            OR t.from_account_id = t.to_account_id)
      )
      BEGIN SELECT RAISE(ABORT, 'recurring series ownership violation'); END;
    `);

    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length) {
      throw new Error(`Foreign-key check failed during recurring transfers migration: ${JSON.stringify(foreignKeyErrors)}`);
    }
    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(RECURRING_TRANSFERS_SCHEMA_VERSION, 'recurring-transfers');
    db.pragma(`user_version = ${RECURRING_TRANSFERS_SCHEMA_VERSION}`);
  })();
  return { migrated: true, backupPath, transfers: transferCount };
}

function migrateSessionSecurityV7(db, { beforeCommit } = {}) {
  const currentVersion = assertSupportedSchemaVersion(db);
  if (currentVersion >= SESSION_SECURITY_SCHEMA_VERSION) return { migrated: false };
  if (currentVersion !== RECURRING_TRANSFERS_SCHEMA_VERSION) {
    throw new Error(`Session security migration requires schema version ${RECURRING_TRANSFERS_SCHEMA_VERSION}`);
  }
  if (!tableExists(db, 'users')) throw new Error('Session security migration requires the users table');

  db.transaction(() => {
    if (!columnExists(db, 'users', 'session_token_hash')) {
      db.exec('ALTER TABLE users ADD COLUMN session_token_hash TEXT');
    }
    if (!columnExists(db, 'users', 'session_created_at')) {
      db.exec('ALTER TABLE users ADD COLUMN session_created_at TEXT');
    }
    if (!columnExists(db, 'users', 'session_expires_at')) {
      db.exec('ALTER TABLE users ADD COLUMN session_expires_at TEXT');
    }

    // Legacy bearer tokens are deliberately invalidated rather than migrated.
    db.exec(`
      UPDATE users
      SET session_token = NULL, session_token_hash = NULL,
          session_created_at = NULL, session_expires_at = NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_session_token_hash
        ON users(session_token_hash) WHERE session_token_hash IS NOT NULL;

      DROP TRIGGER IF EXISTS users_session_state_insert;
      DROP TRIGGER IF EXISTS users_session_state_update;

      CREATE TRIGGER users_session_state_insert
      BEFORE INSERT ON users
      WHEN NOT (
        (NEW.session_token_hash IS NULL AND NEW.session_created_at IS NULL AND NEW.session_expires_at IS NULL)
        OR
        (NEW.session_token_hash IS NOT NULL AND length(NEW.session_token_hash) = 64
          AND NEW.session_created_at IS NOT NULL AND NEW.session_expires_at IS NOT NULL)
      )
      BEGIN SELECT RAISE(ABORT, 'invalid session state'); END;

      CREATE TRIGGER users_session_state_update
      BEFORE UPDATE OF session_token_hash, session_created_at, session_expires_at ON users
      WHEN NOT (
        (NEW.session_token_hash IS NULL AND NEW.session_created_at IS NULL AND NEW.session_expires_at IS NULL)
        OR
        (NEW.session_token_hash IS NOT NULL AND length(NEW.session_token_hash) = 64
          AND NEW.session_created_at IS NOT NULL AND NEW.session_expires_at IS NOT NULL)
      )
      BEGIN SELECT RAISE(ABORT, 'invalid session state'); END;
    `);

    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(SESSION_SECURITY_SCHEMA_VERSION, 'session-security');
    db.pragma(`user_version = ${SESSION_SECURITY_SCHEMA_VERSION}`);
  })();
  return { migrated: true };
}

function auditFinancialRows(db) {
  const issues = [];
  const inspect = (table, fields) => {
    if (!tableExists(db, table)) return;
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      for (const [field, validator, nullable = false] of fields) {
        if (!columnExists(db, table, field)) continue;
        if (nullable && row[field] == null) continue;
        try { validator(row[field], field); }
        catch { issues.push(`${table}:${row.id ?? row.recurring_series_id ?? '?'}(${field})`); }
      }
    }
  };
  inspect('accounts', [['opening_balance', parseMoney]]);
  for (const table of ['accounts', 'transactions', 'income', 'bills', 'income_schedules',
    'transfers', 'bill_months', 'recurring_series', 'recurring_occurrences']) {
    inspect(table, [['id', parseIntegerId]]);
  }
  for (const table of ['transactions', 'income', 'bills', 'income_schedules', 'transfers']) {
    inspect(table, [['amount', parsePositiveMoney]]);
  }
  inspect('bill_months', [['amount_paid', parsePositiveMoney, true]]);
  if (tableExists(db, 'bill_months')) {
    for (const row of db.prepare('SELECT id FROM bill_months WHERE paid = 1 AND amount_paid IS NULL').all()) {
      issues.push(`bill_months:${row.id}(amount_paid)`);
    }
  }
  inspect('recurring_transaction_templates', [['amount', parsePositiveMoney]]);
  inspect('recurring_transfer_templates', [['amount', parsePositiveMoney]]);

  inspect('transactions', [['date', parseIsoDate], ['category_id', parseIntegerId], ['account_id', parseIntegerId, true]]);
  inspect('transactions', [['recurring_occurrence_id', parseIntegerId, true]]);
  inspect('income', [['date', parseIsoDate], ['account_id', parseIntegerId, true],
    ['source_schedule_id', parseIntegerId, true], ['recurring_occurrence_id', parseIntegerId, true]]);
  inspect('bills', [['due_day', (value, field) => parsePositiveInteger(value, field, 31)],
    ['category_id', parseIntegerId], ['account_id', parseIntegerId, true]]);
  inspect('income_schedules', [['anchor_date', parseIsoDate, true], ['account_id', parseIntegerId, true]]);
  inspect('transfers', [['date', parseIsoDate], ['from_account_id', parseIntegerId],
    ['to_account_id', parseIntegerId], ['recurring_occurrence_id', parseIntegerId, true]]);
  inspect('recurring_series', [
    ['frequency_interval', parsePositiveInteger], ['max_occurrences', parsePositiveInteger, true],
    ['start_date', parseIsoDate], ['end_date', parseIsoDate, true], ['next_due_date', parseIsoDate, true],
  ]);
  if (tableExists(db, 'recurring_series')) {
    for (const row of db.prepare(`SELECT id FROM recurring_series
      WHERE end_date IS NOT NULL AND end_date < start_date`).all()) {
      issues.push(`recurring_series:${row.id}(end_date)`);
    }
  }
  inspect('recurring_occurrences', [['series_id', parseIntegerId], ['scheduled_date', parseIsoDate]]);
  inspect('bill_months', [['bill_id', parseIntegerId], ['recurring_occurrence_id', parseIntegerId],
    ['due_date', parseIsoDate], ['paid_date', parseIsoDate, true]]);
  inspect('recurring_transaction_templates', [['recurring_series_id', parseIntegerId],
    ['category_id', parseIntegerId], ['account_id', parseIntegerId, true]]);
  inspect('recurring_transfer_templates', [['recurring_series_id', parseIntegerId],
    ['from_account_id', parseIntegerId], ['to_account_id', parseIntegerId]]);

  if (tableExists(db, 'transfers')) {
    for (const row of db.prepare('SELECT id FROM transfers WHERE from_account_id = to_account_id').all()) {
      issues.push(`transfers:${row.id}(accounts)`);
    }
  }
  if (tableExists(db, 'recurring_transfer_templates')) {
    for (const row of db.prepare(`SELECT recurring_series_id FROM recurring_transfer_templates
      WHERE from_account_id = to_account_id`).all()) {
      issues.push(`recurring_transfer_templates:${row.recurring_series_id}(accounts)`);
    }
  }
  return [...new Set(issues)];
}

function createFinancialValidationTriggers(db) {
  const max = MONEY_MAX_ABS;
  const recurrenceMax = RECURRENCE_INTEGER_MAX;
  db.exec(`
    DROP TRIGGER IF EXISTS accounts_finance_insert;
    DROP TRIGGER IF EXISTS accounts_finance_update;
    CREATE TRIGGER accounts_finance_insert BEFORE INSERT ON accounts
    WHEN typeof(NEW.opening_balance) NOT IN ('integer','real')
      OR abs(NEW.opening_balance) > ${max}
    BEGIN SELECT RAISE(ABORT, 'invalid account opening balance'); END;
    CREATE TRIGGER accounts_finance_update BEFORE UPDATE OF opening_balance ON accounts
    WHEN typeof(NEW.opening_balance) NOT IN ('integer','real')
      OR abs(NEW.opening_balance) > ${max}
    BEGIN SELECT RAISE(ABORT, 'invalid account opening balance'); END;

    DROP TRIGGER IF EXISTS transactions_finance_insert;
    DROP TRIGGER IF EXISTS transactions_finance_update;
    CREATE TRIGGER transactions_finance_insert BEFORE INSERT ON transactions
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid transaction finance data'); END;
    CREATE TRIGGER transactions_finance_update BEFORE UPDATE OF amount, date, category_id, account_id ON transactions
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid transaction finance data'); END;

    DROP TRIGGER IF EXISTS income_finance_insert;
    DROP TRIGGER IF EXISTS income_finance_update;
    CREATE TRIGGER income_finance_insert BEFORE INSERT ON income
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR (NEW.source_schedule_id IS NOT NULL AND (typeof(NEW.source_schedule_id) != 'integer' OR NEW.source_schedule_id < 1))
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid income finance data'); END;
    CREATE TRIGGER income_finance_update BEFORE UPDATE OF amount, date, account_id, source_schedule_id ON income
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR (NEW.source_schedule_id IS NOT NULL AND (typeof(NEW.source_schedule_id) != 'integer' OR NEW.source_schedule_id < 1))
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid income finance data'); END;

    DROP TRIGGER IF EXISTS bills_finance_insert;
    DROP TRIGGER IF EXISTS bills_finance_update;
    CREATE TRIGGER bills_finance_insert BEFORE INSERT ON bills
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR typeof(NEW.due_day) != 'integer' OR NEW.due_day < 1 OR NEW.due_day > 31
    BEGIN SELECT RAISE(ABORT, 'invalid bill finance data'); END;
    CREATE TRIGGER bills_finance_update BEFORE UPDATE OF amount, due_day, category_id, account_id ON bills
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR typeof(NEW.due_day) != 'integer' OR NEW.due_day < 1 OR NEW.due_day > 31
    BEGIN SELECT RAISE(ABORT, 'invalid bill finance data'); END;

    DROP TRIGGER IF EXISTS bill_months_finance_insert;
    DROP TRIGGER IF EXISTS bill_months_finance_update;
    CREATE TRIGGER bill_months_finance_insert BEFORE INSERT ON bill_months
    WHEN typeof(NEW.bill_id) != 'integer' OR NEW.bill_id < 1
      OR typeof(NEW.recurring_occurrence_id) != 'integer' OR NEW.recurring_occurrence_id < 1
      OR date(NEW.due_date) IS NULL OR date(NEW.due_date) != NEW.due_date
      OR (NEW.paid_date IS NOT NULL AND (date(NEW.paid_date) IS NULL OR date(NEW.paid_date) != NEW.paid_date))
      OR (NEW.amount_paid IS NOT NULL AND (typeof(NEW.amount_paid) NOT IN ('integer','real')
        OR NEW.amount_paid <= 0 OR NEW.amount_paid > ${max}))
      OR (NEW.paid = 1 AND NEW.amount_paid IS NULL)
    BEGIN SELECT RAISE(ABORT, 'invalid bill payment finance data'); END;
    CREATE TRIGGER bill_months_finance_update BEFORE UPDATE OF bill_id, recurring_occurrence_id, paid, amount_paid, paid_date, due_date ON bill_months
    WHEN typeof(NEW.bill_id) != 'integer' OR NEW.bill_id < 1
      OR typeof(NEW.recurring_occurrence_id) != 'integer' OR NEW.recurring_occurrence_id < 1
      OR date(NEW.due_date) IS NULL OR date(NEW.due_date) != NEW.due_date
      OR (NEW.paid_date IS NOT NULL AND (date(NEW.paid_date) IS NULL OR date(NEW.paid_date) != NEW.paid_date))
      OR (NEW.amount_paid IS NOT NULL AND (typeof(NEW.amount_paid) NOT IN ('integer','real')
        OR NEW.amount_paid <= 0 OR NEW.amount_paid > ${max}))
      OR (NEW.paid = 1 AND NEW.amount_paid IS NULL)
    BEGIN SELECT RAISE(ABORT, 'invalid bill payment finance data'); END;

    DROP TRIGGER IF EXISTS income_schedules_finance_insert;
    DROP TRIGGER IF EXISTS income_schedules_finance_update;
    CREATE TRIGGER income_schedules_finance_insert BEFORE INSERT ON income_schedules
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR (NEW.anchor_date IS NOT NULL AND (date(NEW.anchor_date) IS NULL OR date(NEW.anchor_date) != NEW.anchor_date))
    BEGIN SELECT RAISE(ABORT, 'invalid income schedule finance data'); END;
    CREATE TRIGGER income_schedules_finance_update BEFORE UPDATE OF amount, anchor_date, account_id ON income_schedules
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR (NEW.anchor_date IS NOT NULL AND (date(NEW.anchor_date) IS NULL OR date(NEW.anchor_date) != NEW.anchor_date))
    BEGIN SELECT RAISE(ABORT, 'invalid income schedule finance data'); END;

    DROP TRIGGER IF EXISTS transfers_finance_insert;
    DROP TRIGGER IF EXISTS transfers_finance_update;
    CREATE TRIGGER transfers_finance_insert BEFORE INSERT ON transfers
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.from_account_id) != 'integer' OR NEW.from_account_id < 1
      OR typeof(NEW.to_account_id) != 'integer' OR NEW.to_account_id < 1
      OR NEW.from_account_id = NEW.to_account_id
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid transfer finance data'); END;
    CREATE TRIGGER transfers_finance_update BEFORE UPDATE OF amount, from_account_id, to_account_id, date ON transfers
    WHEN typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR typeof(NEW.from_account_id) != 'integer' OR NEW.from_account_id < 1
      OR typeof(NEW.to_account_id) != 'integer' OR NEW.to_account_id < 1
      OR NEW.from_account_id = NEW.to_account_id
      OR date(NEW.date) IS NULL OR date(NEW.date) != NEW.date
    BEGIN SELECT RAISE(ABORT, 'invalid transfer finance data'); END;

    DROP TRIGGER IF EXISTS recurring_transaction_templates_finance_insert;
    DROP TRIGGER IF EXISTS recurring_transaction_templates_finance_update;
    CREATE TRIGGER recurring_transaction_templates_finance_insert BEFORE INSERT ON recurring_transaction_templates
    WHEN typeof(NEW.recurring_series_id) != 'integer' OR NEW.recurring_series_id < 1
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
    BEGIN SELECT RAISE(ABORT, 'invalid recurring transaction amount'); END;
    CREATE TRIGGER recurring_transaction_templates_finance_update BEFORE UPDATE OF recurring_series_id, category_id, account_id, amount ON recurring_transaction_templates
    WHEN typeof(NEW.recurring_series_id) != 'integer' OR NEW.recurring_series_id < 1
      OR typeof(NEW.category_id) != 'integer' OR NEW.category_id < 1
      OR (NEW.account_id IS NOT NULL AND (typeof(NEW.account_id) != 'integer' OR NEW.account_id < 1))
      OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
    BEGIN SELECT RAISE(ABORT, 'invalid recurring transaction amount'); END;

    DROP TRIGGER IF EXISTS recurring_transfer_templates_finance_insert;
    DROP TRIGGER IF EXISTS recurring_transfer_templates_finance_update;
    CREATE TRIGGER recurring_transfer_templates_finance_insert BEFORE INSERT ON recurring_transfer_templates
    WHEN typeof(NEW.recurring_series_id) != 'integer' OR NEW.recurring_series_id < 1
      OR typeof(NEW.from_account_id) != 'integer' OR NEW.from_account_id < 1
      OR typeof(NEW.to_account_id) != 'integer' OR NEW.to_account_id < 1
      OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR NEW.from_account_id = NEW.to_account_id
    BEGIN SELECT RAISE(ABORT, 'invalid recurring transfer finance data'); END;
    CREATE TRIGGER recurring_transfer_templates_finance_update BEFORE UPDATE OF recurring_series_id, amount, from_account_id, to_account_id ON recurring_transfer_templates
    WHEN typeof(NEW.recurring_series_id) != 'integer' OR NEW.recurring_series_id < 1
      OR typeof(NEW.from_account_id) != 'integer' OR NEW.from_account_id < 1
      OR typeof(NEW.to_account_id) != 'integer' OR NEW.to_account_id < 1
      OR typeof(NEW.amount) NOT IN ('integer','real') OR NEW.amount <= 0 OR NEW.amount > ${max}
      OR NEW.from_account_id = NEW.to_account_id
    BEGIN SELECT RAISE(ABORT, 'invalid recurring transfer finance data'); END;

    DROP TRIGGER IF EXISTS recurring_series_finance_insert;
    DROP TRIGGER IF EXISTS recurring_series_finance_update;
    CREATE TRIGGER recurring_series_finance_insert BEFORE INSERT ON recurring_series
    WHEN typeof(NEW.frequency_interval) != 'integer' OR NEW.frequency_interval < 1
      OR NEW.frequency_interval > ${recurrenceMax}
      OR (NEW.max_occurrences IS NOT NULL AND (typeof(NEW.max_occurrences) != 'integer'
        OR NEW.max_occurrences < 1 OR NEW.max_occurrences > ${recurrenceMax}))
      OR date(NEW.start_date) IS NULL OR date(NEW.start_date) != NEW.start_date
      OR (NEW.end_date IS NOT NULL AND (date(NEW.end_date) IS NULL OR date(NEW.end_date) != NEW.end_date))
      OR (NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date)
      OR (NEW.next_due_date IS NOT NULL AND (date(NEW.next_due_date) IS NULL OR date(NEW.next_due_date) != NEW.next_due_date))
    BEGIN SELECT RAISE(ABORT, 'invalid recurring series finance data'); END;
    CREATE TRIGGER recurring_series_finance_update BEFORE UPDATE OF frequency_interval, max_occurrences, start_date, end_date, next_due_date ON recurring_series
    WHEN typeof(NEW.frequency_interval) != 'integer' OR NEW.frequency_interval < 1
      OR NEW.frequency_interval > ${recurrenceMax}
      OR (NEW.max_occurrences IS NOT NULL AND (typeof(NEW.max_occurrences) != 'integer'
        OR NEW.max_occurrences < 1 OR NEW.max_occurrences > ${recurrenceMax}))
      OR date(NEW.start_date) IS NULL OR date(NEW.start_date) != NEW.start_date
      OR (NEW.end_date IS NOT NULL AND (date(NEW.end_date) IS NULL OR date(NEW.end_date) != NEW.end_date))
      OR (NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date)
      OR (NEW.next_due_date IS NOT NULL AND (date(NEW.next_due_date) IS NULL OR date(NEW.next_due_date) != NEW.next_due_date))
    BEGIN SELECT RAISE(ABORT, 'invalid recurring series finance data'); END;

    DROP TRIGGER IF EXISTS recurring_occurrences_finance_insert;
    DROP TRIGGER IF EXISTS recurring_occurrences_finance_update;
    CREATE TRIGGER recurring_occurrences_finance_insert BEFORE INSERT ON recurring_occurrences
    WHEN typeof(NEW.series_id) != 'integer' OR NEW.series_id < 1
      OR date(NEW.scheduled_date) IS NULL OR date(NEW.scheduled_date) != NEW.scheduled_date
    BEGIN SELECT RAISE(ABORT, 'invalid recurring occurrence date'); END;
    CREATE TRIGGER recurring_occurrences_finance_update BEFORE UPDATE OF series_id, scheduled_date ON recurring_occurrences
    WHEN typeof(NEW.series_id) != 'integer' OR NEW.series_id < 1
      OR date(NEW.scheduled_date) IS NULL OR date(NEW.scheduled_date) != NEW.scheduled_date
    BEGIN SELECT RAISE(ABORT, 'invalid recurring occurrence date'); END;
  `);
}

function migrateFinancialConstraintsV8(db, { dbPath, beforeCommit } = {}) {
  const currentVersion = assertSupportedSchemaVersion(db);
  if (currentVersion >= FINANCIAL_CONSTRAINTS_SCHEMA_VERSION) return { migrated: false, backupPath: null };
  if (currentVersion !== SESSION_SECURITY_SCHEMA_VERSION) {
    throw new Error(`Financial constraints migration requires schema version ${SESSION_SECURITY_SCHEMA_VERSION}`);
  }
  const issues = auditFinancialRows(db);
  if (issues.length) {
    throw new Error(`Financial validation blocked by malformed legacy rows: ${issues.slice(0, 20).join(', ')}`);
  }
  const populated = OWNED_TABLES.some(table => countRows(db, table) > 0);
  const backupPath = populated && dbPath && dbPath !== ':memory:'
    ? createNamedMigrationBackup(db, dbPath, 'pre-financial-constraints-v8')
    : null;
  db.transaction(() => {
    createFinancialValidationTriggers(db);
    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(FINANCIAL_CONSTRAINTS_SCHEMA_VERSION, 'financial-constraints');
    db.pragma(`user_version = ${FINANCIAL_CONSTRAINTS_SCHEMA_VERSION}`);
  })();
  return { migrated: true, backupPath };
}

function migrateLoginSecurityV9(db, { beforeCommit } = {}) {
  const currentVersion = assertSupportedSchemaVersion(db);
  if (currentVersion >= LOGIN_SECURITY_SCHEMA_VERSION) return { migrated: false };
  if (currentVersion !== FINANCIAL_CONSTRAINTS_SCHEMA_VERSION) {
    throw new Error(`Login security migration requires schema version ${FINANCIAL_CONSTRAINTS_SCHEMA_VERSION}`);
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE login_rate_limits (
        bucket_type TEXT NOT NULL CHECK(bucket_type IN ('account', 'ip')),
        bucket_key TEXT NOT NULL CHECK(length(bucket_key) = 64),
        short_window_started_at INTEGER NOT NULL,
        short_failures INTEGER NOT NULL DEFAULT 0 CHECK(short_failures >= 0),
        long_window_started_at INTEGER NOT NULL,
        long_failures INTEGER NOT NULL DEFAULT 0 CHECK(long_failures >= 0),
        cooldown_level INTEGER NOT NULL DEFAULT 0 CHECK(cooldown_level >= 0),
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bucket_type, bucket_key)
      );

      CREATE TABLE login_attempt_claims (
        id TEXT NOT NULL CHECK(length(id) BETWEEN 16 AND 64),
        bucket_type TEXT NOT NULL CHECK(bucket_type IN ('account', 'ip')),
        bucket_key TEXT NOT NULL CHECK(length(bucket_key) = 64),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, bucket_type)
      );

      CREATE INDEX idx_login_rate_limits_expiry
        ON login_rate_limits(expires_at);
      CREATE INDEX idx_login_attempt_claims_bucket
        ON login_attempt_claims(bucket_type, bucket_key, expires_at);
      CREATE INDEX idx_login_attempt_claims_expiry
        ON login_attempt_claims(expires_at);
    `);

    beforeCommit?.(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(LOGIN_SECURITY_SCHEMA_VERSION, 'login-security');
    db.pragma(`user_version = ${LOGIN_SECURITY_SCHEMA_VERSION}`);
  })();
  return { migrated: true };
}

module.exports = {
  MULTI_USER_SCHEMA_VERSION,
  RECURRING_BILLS_SCHEMA_VERSION,
  RECURRING_INCOME_SCHEMA_VERSION,
  RECURRENCE_RUNNER_SCHEMA_VERSION,
  RECURRING_TRANSACTIONS_SCHEMA_VERSION,
  RECURRING_TRANSFERS_SCHEMA_VERSION,
  SESSION_SECURITY_SCHEMA_VERSION,
  FINANCIAL_CONSTRAINTS_SCHEMA_VERSION,
  LOGIN_SECURITY_SCHEMA_VERSION,
  assertSupportedSchemaVersion,
  claimLegacyData,
  createMigrationBackup,
  createNamedMigrationBackup,
  hasPendingLegacyData,
  migrateRecurringBillsV2,
  migrateRecurringIncomeV3,
  migrateRecurrenceRunnerV4,
  migrateRecurringTransactionsV5,
  migrateRecurringTransfersV6,
  migrateSessionSecurityV7,
  migrateFinancialConstraintsV8,
  migrateLoginSecurityV9,
  auditFinancialRows,
  migrateToMultiUserV1,
  ownershipViolations,
};
