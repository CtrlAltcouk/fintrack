# Avatar & Profile Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users change their avatar colour and upload a profile photo from Settings → Personalisation → PROFILE card, with the photo/colour shown consistently everywhere an avatar appears.

**Architecture:** New `avatar TEXT` column on `users` (nullable, base64 data URL). Two new PATCH routes in `routes/users.js`. `routes/auth.js` and the users picker include `avatar` in responses. Frontend: `avatarCircle()` helper generates consistent avatar HTML everywhere; `applyUserPill()` updates the sidebar/sheet pill imperatively; a PROFILE card at the top of Personalisation hosts the colour swatches and photo upload.

**Tech Stack:** Node.js/Express, better-sqlite3, vanilla JS, FileReader API

---

## File Map

| File | Change |
|------|--------|
| `db.js` | Add `avatar TEXT` migration to `users` table |
| `routes/users.js` | Add `PATCH /:id/colour` + `PATCH /:id/avatar`; add `avatar` to picker SELECT |
| `routes/auth.js` | Add `avatar` to `/me` SELECT and `/login` response |
| `public/app.js` | `avatarCircle()`, `applyUserPill()`, update `init()`, login picker, admin tab, PROFILE card, 3 new globals |
| `package.json` | Version → `2.2.0` |
| `HANDOFF.md` | Version + current progress |

---

## Task 1: DB migration — add `avatar` column to `users`

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add migration**

In `db.js`, add the following after the existing column-addition block that ends around line 177 (the one that adds `user_id` columns to various tables):

```js
try {
  db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}
```

- [ ] **Step 2: Verify**

```bash
node -e "const db = require('./db'); console.log(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name).join(', '))"
```

Expected output includes: `..., colour, is_admin, session_token, created_at, avatar`

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "feat: add avatar column to users table"
```

---

## Task 2: New PATCH routes + update picker — `routes/users.js`

**Files:**
- Modify: `routes/users.js`

Two changes: (a) add `avatar` to the picker SELECT, (b) add two new PATCH routes before `module.exports`.

- [ ] **Step 1: Update picker SELECT**

Find:
```js
  res.json(db.prepare('SELECT id, display_name, colour FROM users ORDER BY id ASC').all());
```

Replace with:
```js
  res.json(db.prepare('SELECT id, display_name, colour, avatar FROM users ORDER BY id ASC').all());
```

- [ ] **Step 2: Add PATCH colour and avatar routes**

Find:
```js
// PATCH /api/users/:id/password — own account only
```

Insert the following two routes immediately before that line:

```js
// PATCH /api/users/:id/colour — own account only
router.patch('/:id/colour', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own colour' });
  const { colour } = req.body;
  if (!colour || typeof colour !== 'string' || !colour.trim())
    return res.status(400).json({ error: 'colour required' });
  db.prepare('UPDATE users SET colour = ? WHERE id = ?').run(colour.trim(), targetId);
  res.json({ ok: true, colour: colour.trim() });
});

// PATCH /api/users/:id/avatar — own account only
router.patch('/:id/avatar', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own avatar' });
  const { avatar } = req.body;
  if (avatar !== null && avatar !== undefined) {
    if (typeof avatar !== 'string' || !avatar.startsWith('data:image/'))
      return res.status(400).json({ error: 'avatar must be a base64 image data URL' });
    if (avatar.length > 400000)
      return res.status(400).json({ error: 'avatar too large (max ~300 KB)' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar ?? null, targetId);
  res.json({ ok: true });
});

```

- [ ] **Step 3: Verify**

```bash
node -e "require('./routes/users')" 2>&1 | head -3
```

Expected: no output (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add routes/users.js
git commit -m "feat: add PATCH colour/avatar routes, include avatar in user picker"
```

---

## Task 3: Add `avatar` to auth responses — `routes/auth.js`

**Files:**
- Modify: `routes/auth.js`

Two changes: `/me` SELECT and `/login` response.

- [ ] **Step 1: Update /me SELECT**

Find:
```js
    'SELECT id, display_name, colour, is_admin FROM users WHERE session_token = ?'
```

Replace with:
```js
    'SELECT id, display_name, colour, is_admin, avatar FROM users WHERE session_token = ?'
```

- [ ] **Step 2: Update /login response**

Find:
```js
  res.json({ id: user.id, display_name: user.display_name, colour: user.colour, is_admin: user.is_admin });
```

Replace with:
```js
  res.json({ id: user.id, display_name: user.display_name, colour: user.colour, is_admin: user.is_admin, avatar: user.avatar ?? null });
```

- [ ] **Step 3: Commit**

```bash
git add routes/auth.js
git commit -m "feat: include avatar in auth/me and login responses"
```

---

## Task 4: Frontend — `public/app.js`

**Files:**
- Modify: `public/app.js`

Six changes in order. Read the relevant sections before each edit.

---

### 4a — Add `avatarCircle()` and `applyUserPill()` helpers

Place both functions immediately before the `async function init()` declaration.

- [ ] **Step 1: Find the insertion point**

Locate `async function init() {` (around line 1952). Insert the following two functions immediately before it:

```js
function avatarCircle(user, size) {
  size = size || 36;
  const s = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex-shrink:0';
  if (user.avatar)
    return '<img src="' + esc(user.avatar) + '" style="' + s + '" alt="">';
  return '<div class="user-avatar-circle" style="background:' + esc(user.colour) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px">' + esc(user.display_name[0].toUpperCase()) + '</div>';
}

function applyUserPill(me) {
  const avatarEl      = document.getElementById('user-pill-avatar');
  const sheetAvatarEl = document.getElementById('sheet-pill-avatar');
  const imgHtml = me.avatar
    ? `<img src="${esc(me.avatar)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : '';
  if (me.avatar) {
    avatarEl.innerHTML      = imgHtml;
    sheetAvatarEl.innerHTML = imgHtml;
    avatarEl.style.background      = '';
    sheetAvatarEl.style.background = '';
  } else {
    avatarEl.innerHTML      = me.display_name[0].toUpperCase();
    sheetAvatarEl.innerHTML = me.display_name[0].toUpperCase();
    avatarEl.style.background      = me.colour;
    sheetAvatarEl.style.background = me.colour;
  }
  document.getElementById('user-pill-name').textContent  = me.display_name;
  document.getElementById('sheet-pill-name').textContent = me.display_name;
}

```

---

### 4b — Update `init()` to use `applyUserPill()`

- [ ] **Step 1: Replace init() body**

Find:
```js
async function init() {
  const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { showLogin(); return; }
  currentUser = me;
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  const sheetPill = document.getElementById('sheet-user-pill');
  document.getElementById('sheet-pill-avatar').style.background = me.colour;
  document.getElementById('sheet-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('sheet-pill-name').textContent = me.display_name;
  sheetPill.style.display = 'flex';
  await loadTheme();
  navigate('dashboard');
}
```

Replace with:
```js
async function init() {
  const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { showLogin(); return; }
  currentUser = me;
  const pill = document.getElementById('user-pill');
  applyUserPill(me);
  pill.style.display = 'flex';
  pill.onclick = logout;
  document.getElementById('sheet-user-pill').style.display = 'flex';
  await loadTheme();
  navigate('dashboard');
}
```

---

### 4c — Update login screen user picker

- [ ] **Step 1: Replace picker avatar**

Find:
```js
              <div class="user-avatar-circle" style="background:${u.colour}">${u.display_name[0].toUpperCase()}</div>
```

Replace with:
```js
              ${avatarCircle(u, 48)}
```

---

### 4d — Update admin Users tab

- [ ] **Step 1: Replace admin tab avatar**

Find:
```js
            <div class="user-avatar-circle" style="background:${u.colour};width:28px;height:28px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${esc(u.display_name)[0].toUpperCase()}</div>
```

Replace with:
```js
            ${avatarCircle(u, 28)}
```

---

### 4e — Add PROFILE card to Personalisation tab

- [ ] **Step 1: Insert PROFILE card at top of personalisationHTML**

Find:
```js
  const personalisationHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">APPEARANCE</div>
```

Replace with:
```js
  const personalisationHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">PROFILE</div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div id="avatarPreview" style="width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
          ${avatarCircle(currentUser, 48)}
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Avatar colour</div>
          <div class="colour-picker-row" id="avatarColours">
            ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map(c =>
              `<div class="colour-opt${currentUser.colour === c ? ' selected' : ''}" data-colour="${c}" style="background:${c}" onclick="window.pickAvatarColour('${c}')"></div>`
            ).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Profile photo</div>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('avatarFileInput').click()">Upload photo</button>
          <input type="file" id="avatarFileInput" accept="image/*" style="display:none" onchange="window.uploadAvatar(this)">
          ${currentUser.avatar ? `<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" style="color:var(--danger);font-size:11px" onclick="window.removeAvatar()">Remove photo</button></div>` : ''}
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">APPEARANCE</div>
```

---

### 4f — Add three global functions

- [ ] **Step 1: Add globals after settings helpers comment**

Find:
```js
window.updateRestoreWarning = function() {
```

Insert the following three functions immediately before that line:

```js
window.pickAvatarColour = async function(colour) {
  const result = await api(`/users/${currentUser.id}/colour`, { method: 'PATCH', body: { colour } });
  if (!result || result.error) return;
  currentUser.colour = colour;
  applyUserPill(currentUser);
  pages.settings('personalisation');
};

window.uploadAvatar = function(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 200 * 1024) {
    alert('Image too large — please choose a file under 200 KB.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(e) {
    const avatar = e.target.result;
    const result = await api(`/users/${currentUser.id}/avatar`, { method: 'PATCH', body: { avatar } });
    if (!result || result.error) { alert('Upload failed.'); return; }
    currentUser.avatar = avatar;
    applyUserPill(currentUser);
    pages.settings('personalisation');
  };
  reader.readAsDataURL(file);
};

window.removeAvatar = async function() {
  const result = await api(`/users/${currentUser.id}/avatar`, { method: 'PATCH', body: { avatar: null } });
  if (!result || result.error) return;
  currentUser.avatar = null;
  applyUserPill(currentUser);
  pages.settings('personalisation');
};

```

---

### 4g — Commit

- [ ] **Step 1: Commit all app.js changes**

```bash
git add public/app.js
git commit -m "feat: avatar colour + profile photo UI in Personalisation tab"
```

---

## Task 5: Verify, version bump, HANDOFF, push

**Files:**
- Modify: `package.json`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Manual smoke test**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3000`. Log in. Then check:
- Settings → Personalisation → PROFILE card appears at top
- Current colour is highlighted in the swatch row
- Click a different colour → sidebar pill updates immediately, page re-renders with new swatch highlighted
- Upload photo (< 200 KB image) → preview and sidebar pill show the photo
- Upload photo (> 200 KB) → alert shown, no change
- "Remove photo" button appears when photo is set; clicking it reverts to coloured initial
- Log out → log back in → colour and photo persist
- Login screen shows photo in user picker if set
- Admin Users tab shows photo next to username

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
  "version": "2.1.0",
```
Replace with:
```json
  "version": "2.2.0",
```

- [ ] **Step 3: Update HANDOFF.md**

**Change 1 — version:**
Find: `**Current version:** \`2.1.0\``
Replace: `**Current version:** \`2.2.0\``

**Change 2 — core features list** (add after Backup & Restore bullet):
```
- **Avatar colour & profile photo** — users can change their avatar colour (7 presets) and upload a profile photo from Settings → Personalisation → PROFILE card; photo shown in sidebar pill, login picker, and admin Users tab (v2.2.0)
```

**Change 3 — replace Current Progress section** (from `## Current Progress` to the `---` before `## Active Work-in-Progress`):

```markdown
## Current Progress — Last Session (2026-06-04)

### Avatar Colour & Profile Photo (v2.2.0)

Users can change their avatar colour (7 presets) and upload a profile photo (≤ 200 KB, stored as base64 in `users.avatar`) from Settings → Personalisation → new PROFILE card. Photo shown in sidebar pill, mobile sheet pill, login screen user picker, and admin Users tab. Colour change is independent of photo — both coexist.

| Area | What changed |
|------|-------------|
| `db.js` | `avatar TEXT` column migration on `users` |
| `routes/users.js` | `PATCH /:id/colour`, `PATCH /:id/avatar`; avatar in picker SELECT |
| `routes/auth.js` | `avatar` in `/me` and `/login` responses |
| `public/app.js` | `avatarCircle()`, `applyUserPill()`, updated `init()`, login picker, admin tab, PROFILE card, `pickAvatarColour`/`uploadAvatar`/`removeAvatar` globals |
| `package.json` | version → 2.2.0 |

---
```

- [ ] **Step 4: Commit and push**

```bash
git add package.json HANDOFF.md
git commit -m "docs: bump to 2.2.0, update HANDOFF for avatar/profile feature"
git push origin main
```
