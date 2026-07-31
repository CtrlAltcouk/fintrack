# Outflow database migrations

## Schema versioning

Outflow records the current schema version in SQLite's `PRAGMA user_version` and records named migrations in the `schema_migrations` table. Migration 1 is `preserve-legacy-multi-user`.

Migrations run when `db.js` opens the configured database, before the HTTP server accepts application requests. Each migration is idempotent and its schema/data changes run in a SQLite transaction.

## Legacy single-user activation

A database created before multi-user support has financial records but no owner. Migration 1 preserves those records and adds nullable ownership columns. It does not create credentials and does not choose a password.

After the upgrade:

1. Open Outflow normally.
2. The existing first-run screen asks for an administrator name and password.
3. Create that account using credentials chosen by the owner/operator.
4. In the same database transaction, Outflow assigns every preserved legacy category, account, income schedule, bill, income row, transaction, transfer and setting to that administrator.
5. Bill-month ownership remains linked through its preserved bill ID.

If ownership or foreign-key validation fails, account creation and ownership assignment both roll back. The legacy records remain unclaimed and unchanged so the operator can restore or investigate safely.

## Backup and rollback

Before rebuilding a populated legacy `categories` or `settings` table, Outflow creates a consistent SQLite backup beside the configured database:

`<database>.pre-multi-user-v1.backup`

If that name already exists, a numeric suffix is added rather than overwriting it. Empty fresh databases do not create a migration backup.

The backup is deliberately retained after a successful migration. Keep it until the migrated owner can sign in and record counts and balances have been verified. Database files under the normal `data/` directory are ignored by Git. For an externally configured `FINTRACK_DB_PATH`, operators must keep the backup outside source control themselves.

To roll back, stop Outflow, preserve the failed database for diagnosis, copy the migration backup back to the configured database path, and start the previous application version. Never replace a live SQLite database while Outflow is running.
