const fs = require('fs');

const MULTI_USER_SCHEMA_VERSION = 1;

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

module.exports = {
  MULTI_USER_SCHEMA_VERSION,
  claimLegacyData,
  createMigrationBackup,
  hasPendingLegacyData,
  migrateToMultiUserV1,
  ownershipViolations,
};
