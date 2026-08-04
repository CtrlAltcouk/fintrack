# Outflow database migrations

## Version 9: login security

Version 9 creates the bounded `login_rate_limits` and `login_attempt_claims` operational tables plus expiry and lookup indexes. It does not rebuild or rewrite users, sessions, financial rows, or recurrence data, so no migration backup is required. Schema creation, indexes, migration record, and `PRAGMA user_version` advance in one SQLite transaction and roll back together on failure. The tables are deliberately excluded from JSON backups because they contain temporary abuse-prevention state rather than application data. See [Login brute-force protection](login-security.md).

## Version 7: session security

Version 7 adds `session_token_hash`, `session_created_at`, and `session_expires_at` to `users`, plus a unique partial lookup index and session-state consistency triggers. The migration runs in one SQLite transaction, preserves every user and password hash, sets every legacy plaintext `session_token` to `NULL`, and advances `PRAGMA user_version` only at commit.

Legacy bearer tokens are never hashed and retained because an exported or previously copied plaintext token may already be exposed. Upgrading therefore performs a deliberate one-time logout for all users. Re-running the migration is a no-op, injected failures roll back the columns, index, triggers, version, and user values, and databases newer than the supported schema are rejected before base-schema changes run.

JSON exports omit all legacy and Version 7 session fields. Restore normalization strips those fields from Version 1â€“6 and current backups, so a successful restore always requires fresh authentication. A failed replace restore remains transactional and preserves the original database, including its current sessions.

## Schema versioning

Outflow records the current schema version in SQLite's `PRAGMA user_version` and records named migrations in the `schema_migrations` table. Migration 1 is `preserve-legacy-multi-user`; migration 2 is `recurring-bills-foundation`; migration 3 is `recurring-income-foundation`; migration 4 is `recurrence-runner-infrastructure`; migration 5 is `recurring-transactions`; migration 6 is `recurring-transfers`; migration 7 is `session-security`; migration 8 is `financial-constraints`; migration 9 is `login-security`.

Migration 8 audits all existing monetary values and finance dates before mutation, then installs compatible validation triggers transactionally. It preserves SQLite `REAL` values, IDs, ownership, history, and recurrence links. Populated file-backed databases receive a non-overwriting pre-migration backup. Malformed legacy rows stop startup with table/row/field identifiers and are never silently rewritten; see [Financial validation](financial-validation.md) for recovery steps.

Migrations run when `db.js` opens the configured database, before the HTTP server accepts application requests. Each migration is idempotent and its schema/data changes run in a SQLite transaction.

Production deployments set `OUTFLOW_DB_PATH=/var/lib/outflow/outflow.db` in `/etc/outflow/outflow.env`. `FINTRACK_DB_PATH` remains a backwards-compatible alias, but both variables must resolve to the same file when both are set. Production startup rejects a database beneath `/opt/outflow` or the active release checkout. Development retains the repository-local default.

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

The backup is deliberately retained after a successful migration. Keep it until the migrated owner can sign in and record counts and balances have been verified. Development database files under `data/` are ignored by Git. Supported production deployments keep the database and adjacent migration backups beneath `/var/lib/outflow`, outside replaceable code and source control.

To roll back, stop Outflow, preserve the failed database for diagnosis, copy the migration backup back to the configured database path, and start the previous application version. Never replace a live SQLite database while Outflow is running.

## Recurring Bills migration

Migration 2 creates the shared `recurring_series` and `recurring_occurrences` tables, links each existing bill to a monthly series, and rebuilds `bill_months` so multiple occurrences in one month can be represented. Existing bill and bill-month IDs, ownership, payment timestamps, account links and transfer links are copied unchanged. Foreign-key and ownership checks run before commit.

Before a populated database is rebuilt, Outflow creates:

`<database>.pre-recurring-bills-v2.backup`

As with the Version 1 backup, an existing file is never overwritten; a numeric suffix is selected. Schema creation, legacy mapping, the bill-month rebuild, migration version and ownership triggers share one transaction. Any failure rolls all of them back. To roll back operationally, stop Outflow and restore this backup before starting the earlier application version.

## Recurring Income migration

Migration 3 maps every existing income schedule into the shared recurrence ledger and rebuilds `income_schedules` and `income` to add their series and occurrence links. Schedule IDs, income IDs, amounts, descriptions, dates, ownership, account links and future projections are preserved. Inactive schedules become deleted series while their historical and projected income entries remain intact.

A populated database is backed up to `<database>.pre-recurring-income-v3.backup`, again using a numeric suffix rather than overwriting a prior backup. The schedule mapping, occurrence mapping, table rebuilds, ownership triggers and schema version are committed as one transaction and roll back together on failure.

## Recurrence runner migration

Migration 4 adds only the transient `recurring_execution_claims` table and the aggregate `recurrence_runner_state` diagnostics row. It does not rebuild or rewrite financial tables, so no migration backup is needed. Both tables and the schema-version update are transactional and roll back together on failure. Execution claims are deliberately excluded from JSON backups; they are process coordination state rather than financial data.

## Recurring Transactions migration

Migration 5 adds `recurring_transaction_templates`, the nullable unique `transactions.recurring_occurrence_id` link, supporting indexes, and ownership triggers. Existing transaction rows and IDs remain unchanged. Because a populated financial table is altered, a consistent non-overwriting backup is created as `<database>.pre-recurring-transactions-v5.backup` before migration. Schema changes, triggers, validation, and the version update share one transaction and roll back together on failure.

Older JSON backups are upgraded in memory during restore by adding an empty template collection and a null occurrence link to historical transactions. Runner claims and diagnostics remain excluded from backup data.

## Recurring Transfers migration

Migration 6 adds `recurring_transfer_templates`, the nullable unique `transfers.recurring_occurrence_id` link, supporting account indexes, and transfer ownership triggers. Existing transfer rows, IDs, account links, amounts, dates, and notes remain unchanged. Populated databases are backed up to `<database>.pre-recurring-transfers-v6.backup` without overwriting an existing backup. Schema changes, ownership validation, and the version update are transactional and roll back together on failure.

Older JSON backups are upgraded in memory with an empty recurring-transfer template collection and null occurrence links. Restore validation checks both transfer accounts and any recurrence links before replacing production data.
