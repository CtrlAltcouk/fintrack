# Changelog

All notable production changes to Outflow are documented here. This project follows semantic versioning for package releases.

## Unreleased

### Fixed

- Separated immutable releases from persistent data and removed the installer path that could erase `/opt/fintrack/data/fintrack.db` during reinstallation.
- Added first-install detection, legacy-layout conflict handling, guarded staging cleanup, pinned release updates, verified pre-update database backups, and health-check rollback.
- Required production databases to live outside replaceable application code while retaining `FINTRACK_DB_PATH` as a compatibility alias.
- Added validated runtime port/environment configuration, distinct liveness and readiness probes, and graceful HTTP/runner/SQLite shutdown on `SIGTERM` and `SIGINT`.
- Changed supervised restarts to use the graceful shutdown path and made deployment activation wait for database/schema readiness.

### Operations

- Added a reproducible GitHub Actions verification workflow based on `npm ci`, Node.js 20, the lockfile, Chromium, and the repository release check.
- Added release metadata verification, systemd shutdown limits and sandboxing, and explicit supported-deployment and diagnostics guidance.

## Version 1 release baseline (package 2.3.0) - 2026-07-31

This is the first production-readiness milestone for the modern Outflow application. The package version remains `2.3.0` to preserve the repository's existing release and tag history.

### Added

- Responsive application foundation covering phone, tablet, and desktop layouts.
- Modern Dashboard, Daily Spending, Bills, Income, Accounts, Settings, and Reports experiences.
- Shared `ui-*` design system and modular vanilla JavaScript frontend architecture.
- Automated unit, API, migration, accessibility, responsive, and Playwright regression coverage.
- Transactional legacy ownership migration with non-overwriting pre-migration backups.
- Release documentation, repository-native syntax verification, and a release-check command.

### Changed

- Standardized cards, forms, filters, tables, modals, status messages, loading states, and keyboard focus presentation.
- Modularized page controllers, rendering helpers, API handling, navigation, charts, modals, formatting, and state helpers.
- Improved package metadata and deployment guidance without changing normal startup behaviour.

### Security

- Enforced administrator authorization in the backend for user administration, updates, restart, instance-wide clearing, backup export, and restore.
- Enforced per-user ownership while preserving valid same-user operations.
- Bounded JSON request sizes and validated backups before production data replacement.
- Normalized frontend API failures, preserved authentication handling, and added request timeouts.
- Added privacy-minimized, failure-contained security audit logging.
- Removed user-controlled text from inline JavaScript contexts.

### Reliability

- Preserved legacy data during schema migration and rolled back schema, data, version, and ownership changes on migration failure.
- Ensured Playwright closes its HTTP listener, SQLite connection, temporary listeners, environment changes, and temporary directories.
- Kept `npm start` and the default production database path unchanged.

### Upgrade note

Read [RELEASE.md](RELEASE.md) before deployment. Always create and verify a backup before starting a new version.
