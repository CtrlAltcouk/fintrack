# Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Backup & Restore card to Settings → System tab so admin users can download a full JSON backup of all app data and restore from it.

**Architecture:** New `routes/backup.js` handles `GET /api/backup` (JSON file download) and `POST /api/backup/restore` (replace or merge restore). Mounted in `server.js` with `requireAuth`. The frontend card lives in `systemHTML` in `app.js` — two global functions (`updateRestoreWarning`, `doRestore`) handle interactivity. Card is only rendered when `currentUser.is_admin` is true. JSON body limit increased to 50 MB to handle large backups.

**Tech Stack:** Node.js/Express, better-sqlite3, vanilla JS

---

## File Map

| File | Change |
|------|--------|
| `routes/backup.js` | **New.** `GET /` (backup download) + `POST /restore` (replace/merge) |
| `server.js` | Mount backup route; increase `express.json` limit to 50 MB |
| `public/app.js` | Add Backup & Restore card to `systemHTML`; add `updateRestoreWarning` and `doRestore` globals |
| `package.json` | Version → `2.1.0` |
| `HANDOFF.md` | Version + current progress |

---

## Task 1: Create `routes/backup.js`

**Files:**
- Create: `routes/backup.js`

Context: `requireAuth` middleware sets `req.user` (full user row including `is_admin`). `better-sqlite3` is synchronous. `db.transaction(fn)()` runs `fn` inside a SQLite transaction that auto-rolls-back on error.

- [ ] **Step 1: Create the file**

Write `routes/backup.js` with this exact content:

```js
const express = require('express');
const router  = express.Router();
const db      = require('../db');

const TABLES_EXPORT = [
  'users', 'categories', 'accounts', 'income_schedules',
  'bills', 'income', 'transactions', 'transfers', 'bill_months', 'settings',
];
const TABLES_DELETE = [
  'bill_months', 'settings', 'transfers', 'transactions',
  'income', 'bills', 'accounts', 'income_schedules', 'categories', 'users',
];

// GET /api/backup — download full JSON backup (admin only)
router.get('/', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const today = new Date().toISOString().slice(0, 10);
  const { version } = require('../package.json');
  const backup = { meta: { app: 'outflow', version, exported_at: new Date().toISOString() } };
  for (const t of TABLES_EXPORT) backup[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="outflow-backup-${today}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

// POST /api/backup/restore?mode=replace|merge — restore from JSON backup (admin only)
router.post('/restore', (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const mode   = req.query.mode === 'merge' ? 'merge' : 'replace';
  const backup = req.body;

  if (!backup?.meta?.app || backup.meta.app !== 'outflow')
    return res.status(400).json({ error: 'Invalid backup file — not an Outflow backup.' });
  for (const t of TABLES_EXPORT) {
    if (!Array.isArray(backup[t]))
      return res.status(400).json({ error: `Invalid backup file — missing table: ${t}` });
  }

  try {
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.transaction(() => {
      if (mode === 'replace') {
        for (const t of TABLES_DELETE) db.prepare(`DELETE FROM ${t}`).run();
      }
      const verb = mode === 'replace' ? 'INSERT' : 'INSERT OR IGNORE';
      for (const t of TABLES_EXPORT) {
        for (const row of backup[t]) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          db.prepare(`${verb} INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...Object.values(row));
        }
      }
    })();
    db.prepare('PRAGMA foreign_keys = ON').run();
    res.json({ ok: true, mode });
  } catch (err) {
    db.prepare('PRAGMA foreign_keys = ON').run();
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify the file exists**

```bash
node -e "require('./routes/backup')" 2>&1 | head -5
```

Expected: no output (no errors on require).

- [ ] **Step 3: Commit**

```bash
git add routes/backup.js
git commit -m "feat: add backup and restore route"
```

---

## Task 2: Update `server.js`

**Files:**
- Modify: `server.js`

Two changes: increase JSON body limit to 50 MB (default 100 KB would truncate large backups), and mount the backup route.

- [ ] **Step 1: Increase JSON body limit**

Find:
```js
app.use(express.json());
```

Replace with:
```js
app.use(express.json({ limit: '50mb' }));
```

- [ ] **Step 2: Mount backup route**

Find:
```js
app.use('/api/settings',         requireAuth, require('./routes/settings'));
```

Replace with:
```js
app.use('/api/settings',         requireAuth, require('./routes/settings'));
app.use('/api/backup',           requireAuth, require('./routes/backup'));
```

- [ ] **Step 3: Verify server starts**

```bash
node server.js
```

Expected: `Outflow running on http://localhost:3000` — no crash. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: mount backup route, increase JSON body limit to 50mb"
```

---

## Task 3: Update `public/app.js`

**Files:**
- Modify: `public/app.js`

Two changes: (a) add the Backup & Restore card to `systemHTML`, (b) add two global functions `updateRestoreWarning` and `doRestore` near the other Settings helpers.

- [ ] **Step 1: Add Backup & Restore card to `systemHTML`**

In `pages.settings`, find the start of `systemHTML` (the Restart App card):

```js
  const systemHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:8px">Restart App</div>
```

Replace with:

```js
  const systemHTML = `
    ${currentUser?.is_admin ? `
    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:8px">Backup &amp; Restore</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
        Download a full JSON backup of all users and data, or restore from a previous backup.
      </p>
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:500;margin-bottom:8px">Backup</div>
        <button class="btn btn-ghost" onclick="window.location.href='/api/backup'">Download Backup</button>
      </div>
      <div>
        <div style="font-size:13px;font-weight:500;margin-bottom:8px">Restore</div>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:420px">
          <input type="file" id="backupFile" accept=".json" style="color:var(--text);font-size:13px"
            onchange="document.getElementById('restoreBtn').disabled = !this.files.length">
          <select id="restoreMode" onchange="updateRestoreWarning()"
            style="background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:13px">
            <option value="replace">Replace all data (recommended)</option>
            <option value="merge">Merge with existing data</option>
          </select>
          <div id="restoreWarning" style="font-size:12px;padding:8px 12px;border-radius:6px;background:#3a2e00;color:#ffd666">
            All existing data will be permanently replaced. You will be logged out after restore.
          </div>
          <div id="restoreStatus" style="font-size:13px"></div>
          <button class="btn btn-ghost" id="restoreBtn" onclick="doRestore()" disabled>Restore</button>
        </div>
      </div>
    </div>` : ''}
    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:8px">Restart App</div>
```

- [ ] **Step 2: Add global helper functions**

Find the settings helpers block (just after the `pages.settings` function closes):

```js
// ── Settings helpers ──────────────────────────────────────────────────────

window.clearAllData = function() {
```

Replace with:

```js
// ── Settings helpers ──────────────────────────────────────────────────────

window.updateRestoreWarning = function() {
  const mode    = document.getElementById('restoreMode')?.value;
  const warning = document.getElementById('restoreWarning');
  if (!warning) return;
  if (mode === 'replace') {
    warning.style.background = '#3a2e00';
    warning.style.color      = '#ffd666';
    warning.textContent      = 'All existing data will be permanently replaced. You will be logged out after restore.';
  } else {
    warning.style.background = '#3a0000';
    warning.style.color      = '#ff9999';
    warning.textContent      = 'Not recommended — merge may leave data in an inconsistent state if the backup conflicts with existing records.';
  }
};

window.doRestore = async function() {
  const fileInput = document.getElementById('backupFile');
  const mode      = document.getElementById('restoreMode').value;
  const statusEl  = document.getElementById('restoreStatus');
  const btn       = document.getElementById('restoreBtn');
  if (!fileInput?.files[0]) return;
  if (!confirm(`Restore from "${fileInput.files[0].name}"? This cannot be undone.`)) return;
  btn.disabled         = true;
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Restoring…';
  try {
    const backup = JSON.parse(await fileInput.files[0].text());
    const result = await api(`/backup/restore?mode=${mode}`, { method: 'POST', body: backup });
    if (!result || result.error) throw new Error(result?.error || 'Unknown error');
    statusEl.style.color = '#4caf50';
    statusEl.textContent = 'Restore complete!';
    if (mode === 'replace') {
      setTimeout(() => showLogin(), 1500);
    } else {
      setTimeout(() => pages.settings('system'), 1500);
    }
  } catch (err) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = `Error: ${err.message}`;
    btn.disabled         = false;
  }
};

window.clearAllData = function() {
```

- [ ] **Step 3: Start dev server and verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Log in as **admin** → Settings → System tab:
- Backup & Restore card appears above Restart App
- "Download Backup" button triggers a file download named `outflow-backup-YYYY-MM-DD.json`
- Open the downloaded file — confirm all tables present (`users`, `accounts`, `transactions`, etc.) and data looks correct
- File input enables the Restore button when a `.json` file is chosen
- Switching to "Merge" mode turns the warning red with the not-recommended text
- Switching back to "Replace" turns it amber again

Log in as **non-admin** → Settings → System tab:
- Backup & Restore card is NOT visible

- [ ] **Step 4: Test restore (replace)**

With a backup file downloaded in Step 3:
- Choose the file, leave mode as Replace, click Restore
- Confirm the dialog
- Status shows "Restoring…" then "Restore complete!"
- After 1.5 s, login screen appears
- Log back in — all data is intact

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add backup and restore UI to settings system tab"
```

---

## Task 4: Bump version and update docs

**Files:**
- Modify: `package.json`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Bump version in `package.json`**

Find:
```json
  "version": "2.0.2",
```

Replace with:
```json
  "version": "2.1.0",
```

- [ ] **Step 2: Update `HANDOFF.md`**

Make these changes:

**Change 1 — version:**
Find: `**Current version:** \`2.0.2\``
Replace: `**Current version:** \`2.1.0\``

**Change 2 — core features list** (add after the Outflow rebrand bullet):
```
- **Backup & Restore** — admin-only JSON backup download and restore (replace/merge) in Settings → System (v2.1.0)
```

**Change 3 — Current Progress section:**
Replace the entire `## Current Progress — Last Session` section (up to the `---`) with:

```markdown
## Current Progress — Last Session (2026-06-04)

### Backup & Restore (v2.1.0)

New `routes/backup.js` handles `GET /api/backup` (downloads all tables as JSON) and `POST /api/backup/restore?mode=replace|merge`. Admin-only. Replace mode: disables foreign keys, deletes all rows in reverse dependency order, inserts from backup, re-enables foreign keys, clears session. Merge mode: `INSERT OR IGNORE`. Both wrapped in a SQLite transaction. JSON body limit raised to 50 MB in `server.js`. Frontend card added to `systemHTML` (admin-only), with download button, file input, mode selector, and amber/red warning block.

| Area | What changed |
|------|-------------|
| `routes/backup.js` | New — `GET /` backup download, `POST /restore` replace/merge |
| `server.js` | Mount `/api/backup`; `express.json({ limit: '50mb' })` |
| `public/app.js` | Backup & Restore card in systemHTML; `updateRestoreWarning()`, `doRestore()` globals |
| `package.json` | version → 2.1.0 |

---
```

- [ ] **Step 3: Commit and push**

```bash
git add package.json HANDOFF.md
git commit -m "docs: bump version to 2.1.0, update HANDOFF for backup/restore"
git push origin main
```
