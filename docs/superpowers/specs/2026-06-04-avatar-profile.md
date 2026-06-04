# Avatar & Profile Photo Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Version target:** 2.2.0

---

## Goal

Let users change their avatar colour and upload a profile photo from Settings → Personalisation. The photo (or coloured initial) appears consistently in the sidebar user pill, mobile sheet pill, login screen user picker, and admin Users tab.

---

## Backend

### DB migration — `db.js`

Add `avatar TEXT` column (nullable, default NULL) to `users` table using the existing idempotent migration pattern (try ALTER TABLE, ignore "duplicate column" error).

### New routes — `routes/users.js`

**`PATCH /api/users/:id/colour`** (own account only)
- Returns 403 if `Number(req.params.id) !== req.userId`
- Body: `{ colour }` — must be a non-empty string
- Returns 400 if missing or empty
- Updates `users.colour` for that user
- Returns `{ ok: true, colour }`

**`PATCH /api/users/:id/avatar`** (own account only)
- Returns 403 if `Number(req.params.id) !== req.userId`
- Body: `{ avatar }` — base64 data URL string, or `null` to remove
- If provided (non-null): validates starts with `data:image/`, length ≤ 400,000 chars (~300 KB file); returns 400 if invalid
- Updates `users.avatar` (NULL if avatar is null)
- Returns `{ ok: true }`

### Updated routes

| Route | Change |
|-------|--------|
| `GET /api/auth/me` | Add `avatar` to SELECT |
| `POST /api/auth/login` | Add `avatar` to response JSON |
| `GET /api/users/picker` | Add `avatar` to SELECT |
| `GET /api/users` (admin) | Already uses `SELECT *` — no change needed |

---

## Frontend — `public/app.js`

### Shared helper

```js
function avatarCircle(user, size = 36) {
  const s = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0`;
  if (user.avatar) return `<img src="${esc(user.avatar)}" style="${s}" alt="">`;
  return `<div class="user-avatar-circle" style="background:${esc(user.colour)};width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px">${esc(user.display_name[0].toUpperCase())}</div>`;
}
```

Used in the login picker, admin Users tab, and Personalisation preview. The user pill (sidebar + sheet) is updated imperatively rather than via this helper.

### User pill — `init()` function

After login, if `me.avatar` is set the pill avatar element shows `<img>` instead of a text initial:

```js
function applyUserPill(me) {
  const avatarEl       = document.getElementById('user-pill-avatar');
  const sheetAvatarEl  = document.getElementById('sheet-pill-avatar');
  if (me.avatar) {
    avatarEl.innerHTML      = `<img src="${me.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    sheetAvatarEl.innerHTML = `<img src="${me.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
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

Called from `init()` and after any avatar/colour change.

### Login screen user picker

Replace the hardcoded `<div class="user-avatar-circle"...>` with `${avatarCircle(u, 48)}`.

### Admin Users tab

Replace the hardcoded avatar circle with `${avatarCircle(u, 28)}`.

### Personalisation tab — PROFILE card

New card at the top of `personalisationHTML`, above the APPEARANCE card:

```html
<div class="card" style="margin-bottom:16px">
  <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">PROFILE</div>
  <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
    <!-- Live preview — rendered inline using avatarCircle(currentUser, 48) -->
    <div id="avatarPreview" style="width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
      ${avatarCircle(currentUser, 48)}
    </div>
    <!-- Colour swatches -->
    <div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Avatar colour</div>
      <div class="colour-picker-row" id="avatarColours">
        <!-- 7 preset swatches, current colour highlighted -->
      </div>
    </div>
    <!-- Photo controls -->
    <div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Profile photo</div>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('avatarFileInput').click()">Upload photo</button>
      <input type="file" id="avatarFileInput" accept="image/*" style="display:none" onchange="window.uploadAvatar(this)">
      ${currentUser.avatar ? `<div style="margin-top:6px"><button class="btn btn-ghost btn-sm" style="color:var(--danger);font-size:11px" onclick="window.removeAvatar()">Remove photo</button></div>` : ''}
    </div>
  </div>
</div>
```

### New global functions

**`window.pickAvatarColour(colour)`**
- Calls `PATCH /api/users/:id/colour`
- On success: updates `currentUser.colour`, re-highlights swatches, updates avatar preview, calls `applyUserPill(currentUser)`

**`window.uploadAvatar(input)`**
- Validates `input.files[0].size <= 200 * 1024` (200 KB) — shows inline error if too large
- Reads as data URL via `FileReader`
- Calls `PATCH /api/users/:id/avatar` with the base64 string
- On success: updates `currentUser.avatar`, calls `applyUserPill(currentUser)`, calls `pages.settings('personalisation')` to re-render (shows Remove button)

**`window.removeAvatar()`**
- Calls `PATCH /api/users/:id/avatar` with `{ avatar: null }`
- On success: sets `currentUser.avatar = null`, calls `applyUserPill(currentUser)`, calls `pages.settings('personalisation')` to re-render (hides Remove button)

---

## Files changed

| File | Change |
|------|--------|
| `db.js` | Add `avatar TEXT` column migration |
| `routes/users.js` | Add `PATCH /:id/colour` + `PATCH /:id/avatar`; add `avatar` to picker SELECT |
| `routes/auth.js` | Add `avatar` to `/me` SELECT and `/login` response |
| `public/app.js` | `avatarCircle()` helper; `applyUserPill()`; update `init()`; update login picker + admin tab; add PROFILE card to Personalisation; add `pickAvatarColour`, `uploadAvatar`, `removeAvatar` globals |

No new routes file needed. No new settings keys.

---

## Colours (preset palette — matches account creation)

```js
['#4a9eff', '#f7a4a2', '#a8d8a8', '#ffd700', '#c39bd3', '#ff8c42', '#76d7c4']
```

---

## Testing

1. Settings → Personalisation → PROFILE card visible
2. Click a colour swatch → sidebar pill updates immediately, no page reload
3. Upload a photo ≤ 200 KB → preview and pill show photo
4. Upload a photo > 200 KB → inline error, no API call
5. Remove photo → reverts to coloured initial in preview and pill
6. Log out and back in → photo/colour persists
7. Login screen user picker shows photo for users who have one
8. Admin Users tab shows photos for users who have them
9. `PATCH /api/users/:id/colour` as a different user → 403
10. `PATCH /api/users/:id/avatar` with invalid data URL → 400
