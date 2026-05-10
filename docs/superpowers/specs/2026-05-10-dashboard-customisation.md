# FinTrack v1.4.0: Customisable Dashboard

## Overview

Users can personalise their dashboard by entering an edit mode that allows widgets to be reordered via drag-and-drop and individually hidden or restored. The layout is persisted server-side so it survives browser clears and works across devices.

---

## Widgets

The dashboard has four named widgets:

| ID | Display name | Content |
|----|-------------|---------|
| `stats` | Monthly Stats | Income / Spent / Remaining stat cards |
| `accounts` | Account Balances | Account Balances card |
| `charts` | Charts | Bar chart + Donut chart (chart-grid) |
| `calendar` | Calendar | Calendar widget |

Default order (when no layout has been saved): `stats → accounts → charts → calendar`, all visible.

---

## Database

### New table: `settings`

Added via `db.exec()` in `db.js`:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Layout record

Key: `dashboard_layout`
Value: JSON string, e.g.:
```json
{ "order": ["stats", "accounts", "charts", "calendar"], "hidden": [] }
```

- `order` — full list of all 4 widget IDs in display order (hidden widgets stay in the list so their position is remembered when restored)
- `hidden` — subset of widget IDs currently not rendered

---

## API — `routes/settings.js`

Mounted at `/api/settings` in `server.js`.

### `GET /api/settings/dashboard`

Returns the current layout. If no row exists in the `settings` table, returns the default:

```json
{ "order": ["stats", "accounts", "charts", "calendar"], "hidden": [] }
```

### `POST /api/settings/dashboard`

Body: `{ order: string[], hidden: string[] }`

Validation:
- `order` must be an array containing all 4 known widget IDs (`stats`, `accounts`, `charts`, `calendar`) — exactly once each, no extras, no omissions
- `hidden` must be an array of widget IDs that are all present in `order`

On success: upserts the record and returns `{ ok: true }`.
On failure: returns `400` with `{ error: '...' }`.

---

## Frontend

### `pages.dashboard` changes in `public/app.js`

On render, fetch layout and summary in parallel:

```javascript
const [summary, accounts, layout] = await Promise.all([
  api(`/summary/${year}/${month}`),
  getAccounts(),
  api('/settings/dashboard'),
]);
```

#### Normal mode

- Dashboard header shows an **✏️ Edit** button (right side, ghost style)
- Widgets are rendered in `layout.order` order; widgets in `layout.hidden` are not rendered

#### Edit mode

Entered by clicking ✏️ Edit. The header button changes to **✓ Done**.

Each **visible** widget:
- Has a `⠿` drag handle on its left edge (cursor: grab)
- Has a red `✕` button (absolute position, top-right corner)
- Has `draggable="true"` on its container div
- Has a `data-widget` attribute with the widget ID

Each **hidden** widget:
- Renders as a faded ghost slot in its position within the order
- Shows the widget name and a green `＋` button
- Clicking `＋` restores the widget in place (removes it from `hidden`)

**Drag and drop** (HTML5 API — no new libraries):
- `dragstart` on a widget: store the dragged widget ID in a variable
- `dragover` on a widget: allow drop, show visual swap indicator
- `drop` on a widget: swap positions in the in-memory order array and re-render edit mode

**✓ Done:**
- POSTs current `order` and `hidden` to `POST /api/settings/dashboard`
- On success: re-renders dashboard in normal mode with saved layout

**State during edit mode:**
Tracked in two local variables inside `pages.dashboard`:
- `editOrder` — mutable copy of `layout.order`
- `editHidden` — mutable copy of `layout.hidden`

These are updated as the user drags and removes/restores widgets. On Done, these are POSTed.

---

## Clear-data

`POST /api/update/clear-data` does **not** delete the `settings` row — dashboard layout is a preference, not user financial data.

---

## Version

`package.json` version bumped to `1.4.0`.

---

## Out of Scope

- Resizing widgets
- Adding entirely new widget types
- Per-widget configuration options
- Mobile touch drag support (HTML5 DnD is pointer-only)
