# Backup & Restore Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Version target:** 2.1.0

---

## Goal

Add a Backup & Restore card to Settings → System tab. Admin users can download a full JSON backup of all app data and restore from a previous backup file. Supports two restore modes: Replace (default) and Merge (not recommended, with warning).

---

## Scope

- **Admin-only** — both backup and restore require `is_admin = 1`. Non-admins see neither button.
- **Full backup** — covers all tables: `users`, `accounts`, `transactions`, `transfers`, `income`, `income_schedules`, `bills`, `bill_months`, `categories`, `settings`.
- **Browser download / file upload** — no files stored on the server.

---

## Backup — `GET /api/backup`

Admin-only (403 if not admin).

Queries all tables and serialises to JSON:

```json
{
  "meta": {
    "app": "outflow",
    "version": "2.1.0",
    "exported_at": "2026-06-04T18:00:00.000Z"
  },
  "users": [...],
  "accounts": [...],
  "transactions": [...],
  "transfers": [...],
  "income": [...],
  "income_schedules": [...],
  "bills": [...],
  "bill_months": [...],
  "categories": [...],
  "settings": [...]
}
```

Response headers:
```
Content-Type: application/json
Content-Disposition: attachment; filename="outflow-backup-YYYY-MM-DD.json"
```

The browser saves the file automatically. No server-side file storage.

---

## Restore — `POST /api/backup/restore?mode=replace|merge`

Admin-only (403 if not admin). Body: the JSON backup object. Query param `mode` defaults to `replace`.

### Validation

Before touching the database, validate:
1. `body.meta.app === 'outflow'` — rejects foreign files
2. All required table keys present: `users`, `accounts`, `transactions`, `transfers`, `income`, `income_schedules`, `bills`, `bill_months`, `categories`, `settings`
3. Each value is an array

Returns `400` with a descriptive error message if validation fails.

### Replace mode

1. Begin SQLite transaction
2. `PRAGMA foreign_keys = OFF`
3. `DELETE FROM` every table (order: `bill_months`, `settings`, `transfers`, `transactions`, `income`, `bills`, `accounts`, `income_schedules`, `categories`, `users`)
4. `INSERT INTO` every table from backup data (order: `users`, `categories`, `accounts`, `income_schedules`, `bills`, `income`, `transactions`, `transfers`, `bill_months`, `settings`)
5. `PRAGMA foreign_keys = ON`
6. Commit
7. Clear `fintrack_session` cookie — user must log back in

Returns `{ ok: true }`. On any error: rollback, return `500` with error message. Database is left untouched on failure.

### Merge mode

Uses `INSERT OR IGNORE` for every table — skips rows where the primary key already exists. No deletes. Wrapped in a transaction; rolls back fully on error.

Returns `{ ok: true }`. Same error handling as replace.

---

## Route file

New file: `routes/backup.js`  
Mounted in `server.js` at `/api/backup` with `requireAuth`.

The route file handles its own admin check (`if (!req.userIsAdmin) return res.status(403)...`) — `requireAuth` only checks session validity.

> **Note:** `requireAuth` middleware currently sets `req.userId`. To check admin status, the route queries `SELECT is_admin FROM users WHERE id = ?` using `req.userId`.

---

## Frontend — Settings → System tab (`public/app.js`)

New card added to `systemHTML`, inserted **before** the existing Danger Zone card.

### Backup section

A "Download Backup" button. Clicking it navigates to `/api/backup` via `window.location.href` — the browser handles the download.

### Restore section

- File input (`accept=".json"`) — Restore button disabled until a file is chosen
- Mode selector: `<select>` with two options:
  - `replace` — "Replace all data" (default)
  - `merge` — "Merge with existing data"
- Warning block that updates on mode change:
  - **Replace:** amber — *"All existing data will be permanently replaced. You will be logged out after restore."*
  - **Merge:** red — *"Not recommended — merge may leave data in an inconsistent state if the backup conflicts with existing records."*
- Restore button triggers a `fetch POST /api/backup/restore?mode=...` with the file contents as JSON body
- On success: show confirmation message, then after 1.5 seconds call `showLogin()` (replace) or `pages.settings('system')` (merge)
- On error: show server error message inline

### Admin-only visibility

The entire Backup & Restore card only renders when `currentUser?.is_admin` is true — same pattern as the Users tab.

---

## Files changed

| File | Change |
|------|--------|
| `routes/backup.js` | **New.** `GET /api/backup` + `POST /api/backup/restore` |
| `server.js` | Mount `routes/backup.js` at `/api/backup` with `requireAuth` |
| `public/app.js` | Add Backup & Restore card to `systemHTML` |

No schema changes. No new settings keys.

---

## Testing

1. Log in as admin → Settings → System → Backup & Restore card is visible
2. Log in as non-admin → card is not visible
3. Click Download Backup → browser downloads `outflow-backup-YYYY-MM-DD.json`
4. Open the file — verify all tables present, data looks correct
5. Restore (Replace) → confirmation shown → redirected to login → log back in → all data intact
6. Restore (Merge) → red warning visible before confirming → success message shown
7. Restore with a corrupted/wrong file → inline error message shown, no data changed
8. `GET /api/backup` as non-admin → 403
9. `POST /api/backup/restore` as non-admin → 403
