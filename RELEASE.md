# Outflow release and operations guide

This guide covers installation and safe operation of the Version 1 production baseline, distributed as package version `2.3.0`.

## Installation

### Manual installation

```bash
git clone https://github.com/CtrlAltcouk/fintrack.git
cd fintrack
npm ci --omit=dev
npm start
```

Requirements: a Debian 12 host, a pinned Outflow semantic-version tag or full commit SHA, and root access for first-time service provisioning. The production database is `/var/lib/outflow/outflow.db`; production startup does not default to a database inside the checkout.

The installer creates a dedicated `outflow` account and systemd service. Code is installed beneath `/opt/outflow`, persistent data beneath `/var/lib/outflow`, configuration beneath `/etc/outflow`, and optional file logs beneath `/var/log/outflow`. Terminate HTTPS at a trusted reverse proxy. Do not expose an unencrypted instance directly to the internet.

Run `OUTFLOW_RELEASE_REF=vX.Y.Z bash setup.sh` only for a fresh host. The script refuses an existing Outflow installation, a legacy `/opt/fintrack` installation, conflicting old/new databases, or unexpected unmarked directories. Re-running setup changes nothing and directs the operator to the updater.

### Proxmox LXC installation

Run `install.sh <container-id> <vX.Y.Z|full-commit>` from the Proxmox host. It refuses an existing container ID, fetches the pinned release, provisions a Debian 12 container, and invokes the safe first-install flow. It does not execute mutable `main` directly.

Review the script and its requested container, storage, network, and root-password values before approving it.

## First startup and administrator setup

1. Start Outflow and open `http://<host>:3000`.
2. If the database contains no users, the first-run form is displayed.
3. Enter the administrator's name and a strong, unique password.
4. Submit the form and confirm the Dashboard opens.
5. Open Settings and review personalization, pay-period, backup, and user options.

First-user administrator creation is available only while no users exist. Afterward, creating or managing users and performing instance-wide operations requires an authenticated administrator. Normal authenticated users retain access to clearing only their own data.

When activating a migrated legacy database, first-user creation also claims preserved legacy financial rows for that administrator in one transaction. See [docs/migrations.md](docs/migrations.md).

## Backup procedure

Perform both an application export and a filesystem-level database backup before upgrades.

### Administrator export

1. Sign in as an administrator.
2. Open Settings, then the backup section.
3. Select **Download Backup**.
4. Store the downloaded `outflow-backup-YYYY-MM-DD.json` outside the application host.
5. Confirm the file is non-empty and contains an Outflow metadata section. Treat it as sensitive financial data.

### SQLite snapshot

1. Stop Outflow or otherwise prevent all writes.
2. Use SQLite's backup API to snapshot `/var/lib/outflow/outflow.db` into `/var/lib/outflow/backups`, or copy the database and sidecars only while the service is fully stopped.
3. Restart the unchanged service if the upgrade is not proceeding immediately.

Do not copy or replace a live SQLite database while Outflow is writing to it. Never store backups in Git.

## Upgrade procedure

Schema migration 8 validates existing finance values before adding database-level protections. A populated file-backed Version 7 database receives a non-overwriting pre-migration backup. If startup reports malformed legacy row IDs, follow the recovery procedure in `docs/financial-validation.md` from a verified database copy.

1. Read `CHANGELOG.md` and any migration notes, then choose an immutable tag or full commit SHA.
2. Record the deployed commit and package version.
3. Complete and verify both backup procedures above.
4. Run the release checklist against the candidate commit.
5. Stop the service or remove write traffic.
6. For Proxmox, run `update.sh <container-id> <pinned-release>`. Otherwise run `bash /opt/outflow/app/scripts/deploy-update.sh <pinned-release>` as root inside the host/container.
7. The updater creates and verifies a non-overwriting SQLite backup, stages code in a new release directory, runs `npm ci --omit=dev` and syntax validation, then switches `/opt/outflow/app` atomically.
8. If startup or the readiness check fails, the previous release pointer and verified database snapshot are restored.
9. Review startup logs for migration or database errors.
10. Verify administrator login, user switching, Dashboard data, one report, and backup export.

Migrations run automatically when the database opens and before the HTTP listener begins accepting requests. Migration transactions roll back on failure. Some legacy migrations also retain a uniquely named backup beside the configured database.

### Migrating a legacy FinTrack layout

If `/opt/fintrack` or `/opt/fintrack/data/fintrack.db` exists, setup stops before creating Outflow data. It never silently moves a live database or creates a second empty one.

1. Stop the historical `fintrack` PM2 process and prevent writes.
2. Resolve the actual database from `FINTRACK_DB_PATH`; otherwise use `/opt/fintrack/data/fintrack.db`.
3. Create a timestamped SQLite backup outside `/opt/fintrack`, verify it is non-empty, and run `PRAGMA quick_check` against it.
4. Preserve the complete legacy directory and PM2 configuration under a dated, non-conflicting name.
5. Run the fresh Outflow installer with `OUTFLOW_DEFER_START=1` before allowing user traffic; this installs and enables the service without creating an empty database.
6. Stop `outflow`, place a verified copy at `/var/lib/outflow/outflow.db`, set owner/group to `outflow`, mode `0600`, and start the service.
7. Verify migration version, ownership, balances, recurrence state, and login before removing any preserved legacy files.

If both old and new databases exist, stop and determine which is authoritative. Never merge or overwrite them during installation.

## Restore procedure

Restore is an administrator-only operation and replaces sensitive production data. Take a fresh filesystem snapshot first even when restoring an older export.

1. Sign in as an administrator.
2. Open Settings and select the backup restore control.
3. Choose a trusted Outflow JSON backup.
4. Use **replace** mode for disaster recovery unless a documented recovery plan specifically requires another mode.
5. Review the warning and start the restore.
6. Allow Outflow to validate the entire backup before replacement begins.
7. Sign in again. Session credentials are intentionally omitted from all exports and every successful restore logs out every user, including restores of legacy Version 1-6 backups.
8. Verify users, accounts, balances, transactions, bills, income, settings, and reports.

If validation fails, the production database is not replaced. If an operational restore fails, Outflow rolls back the transaction and returns a safe error response.

## Session security and reverse proxies

The default absolute session lifetime is 12 hours. Override it with `OUTFLOW_SESSION_TTL_HOURS` only after considering the security of the host; accepted values are positive hours up to 720. Invalid configuration prevents startup before the database is opened.

Production must be served over HTTPS. Outflow marks production session cookies `Secure`, so direct production HTTP login is intentionally unsupported. If a reverse proxy terminates TLS, configure the exact number of trusted proxy hops with `OUTFLOW_TRUST_PROXY_HOPS`; leave it at `0` for direct connections. Do not enable broad or unbounded forwarded-header trust.

The Version 7 schema upgrade replaces plaintext session storage with a one-way digest and absolute UTC expiry metadata. Existing plaintext sessions are invalidated, not converted, so all users must sign in once after the upgrade. Password changes, logout, user deletion, and successful backup restore also revoke affected sessions. Development localhost HTTP remains available because `Secure` is disabled only when `NODE_ENV` is not `production`.

Version 9 adds persisted login throttling without changing users or credentials. The operational limiter state is not exported; a successful replace restore starts with empty limiter state. Review [docs/login-security.md](docs/login-security.md) before overriding any login limit, and verify the exact `OUTFLOW_TRUST_PROXY_HOPS` value so client-IP buckets cannot be spoofed or collapsed onto a proxy.

## Service lifecycle and diagnostics

- `GET /api/health` is a liveness probe. It confirms that the HTTP process can answer and intentionally does not inspect dependencies.
- `GET /api/ready` is a readiness probe. It returns HTTP 200 only while the process is accepting work, SQLite responds, foreign-key enforcement is enabled, and the database is at the schema version supported by this release. It returns HTTP 503 during shutdown or when those checks fail.
- Startup logs identify the package version, environment, bound port, and supported schema version without logging credentials or financial data.
- `SIGTERM` and `SIGINT` initiate an idempotent drain: the HTTP listener and recurrence runner stop before SQLite closes. The systemd service grants 30 seconds for shutdown.

Use the systemd journal for production diagnostics (`journalctl -u outflow`). Do not enable request-body logging or copy sensitive exports into logs or support tickets.

## Supported deployment targets

The release-supported path is Debian 12 with the supplied systemd deployment, either directly or inside a Debian 12 Proxmox LXC. No official Docker image or Compose file is included in this release. Operators who create their own container deployment are responsible for persistent SQLite storage, signal forwarding, readiness probes, reverse-proxy TLS, backup, and rollback testing.

## Rollback procedure

1. Stop Outflow completely.
2. Preserve the failed database and logs separately for diagnosis.
3. Point `/opt/outflow/app` back to the preserved previous release.
4. Restore the matching pre-upgrade SQLite snapshot to `/var/lib/outflow/outflow.db` while the service is stopped.
5. Remove stale `-wal` and `-shm` sidecars only after confirming the service is stopped and the exact database path.
6. Ensure database ownership and filesystem permissions match the service account.
7. Start the previous application version.
8. Verify startup, login, Dashboard totals, and a known report.

For migration 1, a file named like `<database>.pre-multi-user-v1.backup` may be available. Numeric suffixes are used to avoid overwriting earlier backups. Follow [docs/migrations.md](docs/migrations.md) before using it.

Application rollback without database rollback is unsafe when the newer version has migrated the schema. Always restore a database snapshot that matches the application version.

## Release checklist

### Candidate verification

- [ ] Confirm `package.json`, `package-lock.json`, and `CHANGELOG.md` identify the intended release.
- [ ] Confirm the release tag is exactly `v<package.json version>`; the metadata check rejects a mismatched tag in CI.
- [ ] Resolve the distribution-license decision. `UNLICENSED` is valid for a private release but is not an open-source grant for a public repository.
- [ ] Run `npm ci` in a clean checkout.
- [ ] Run `npm audit --omit=dev` and confirm zero known production dependency findings.
- [ ] Run `npm run release-check` and confirm syntax, unit/API, Playwright, and diff checks pass.
- [ ] Confirm no test is skipped, focused, or dependent on production data.
- [ ] Confirm the Git working tree contains no database, backup, log, report, screenshot output, secret, or temporary artefact.

### Backup and migration

- [ ] Export and inspect an administrator JSON backup.
- [ ] Create a stopped-service SQLite snapshot and copy it off-host.
- [ ] Test a fresh installation and first-administrator creation.
- [ ] Test an upgrade using a copy of representative legacy data.
- [ ] Confirm migrated row counts, ownership, balances, and `PRAGMA user_version`.
- [ ] Confirm an injected migration failure preserves schema, data, version, ownership, and the original database.

### Deployment verification

- [ ] Record the release commit, package version, deployment time, and operator.
- [ ] Install with `npm ci --omit=dev` and restart the existing supervised process.
- [ ] Confirm startup logs contain no database, migration, or listener errors.
- [ ] Confirm `/api/health` returns 200 and `/api/ready` returns 200 before enabling user traffic.
- [ ] Send `SIGTERM` in staging and confirm the listener, recurrence runner, and SQLite close cleanly before the service restarts.
- [ ] Confirm HTTPS, proxy headers, filesystem permissions, and service restart policy.
- [ ] Verify administrator and normal-user login, user switching, and authorization boundaries.
- [ ] Verify Dashboard, Spending, Bills, Income, Accounts, Transfers, Reports, and Settings load.
- [ ] Verify a backup can still be exported after deployment.

### Rollback verification

- [ ] Stop the candidate version in a non-production environment.
- [ ] Restore the pre-upgrade database and previous application commit.
- [ ] Reinstall the previous lockfile with `npm ci --omit=dev`.
- [ ] Confirm the previous version starts and known balances and reports match.
- [ ] Document the tested rollback duration and any manual intervention.

## Operational maintenance

- Run production dependency audits regularly and before every upgrade.
- Keep Node.js, the operating system, reverse proxy, and process supervisor patched.
- Retain multiple encrypted, off-host backups and periodically test restoration.
- Restrict Settings administrator tools and database filesystem access to trusted operators.
- Monitor application startup, security-audit, proxy, disk-capacity, and backup-job logs without collecting unnecessary personal or financial data.
