# FinTrack v1.4.2: Dashboard Grid Picker Resize

## Overview

Replace the 2-state snap resize (half / full width only) with a 2D grid picker overlay. Widgets can now span 1–4 columns wide and 1–3 rows tall. The picker appears on `mousedown` of the resize handle in edit mode; hovering over cells gives a live CSS preview; releasing commits the chosen size.

---

## Grid Layout

The dashboard widget container changes from a 2-column to a 4-column CSS grid:

```css
display: grid;
grid-template-columns: 1fr 1fr 1fr 1fr;
gap: 16px;
```

Each widget element gets:
```css
grid-column: span W;
grid-row: span H;
```
where `W` is 1–4 and `H` is 1–3.

No fixed `grid-auto-rows` is set — widget height is determined by inner content × row span naturally.

---

## Database

### `settings` table — `dashboard_layout` key

`sizes` values change from a plain number (`1` or `2`) to a `{ w, h }` object:

```json
{
  "order": ["stats", "accounts", "bar_chart", "donut_chart", "calendar"],
  "hidden": [],
  "sizes": {
    "stats":       { "w": 4, "h": 1 },
    "accounts":    { "w": 4, "h": 1 },
    "bar_chart":   { "w": 2, "h": 1 },
    "donut_chart": { "w": 2, "h": 1 },
    "calendar":    { "w": 4, "h": 1 }
  }
}
```

No schema migration needed — same `settings` table and key, updated JSON shape.

---

## API — `routes/settings.js`

### Constants

```javascript
const DEFAULT_SIZES = {
  stats:       { w: 4, h: 1 },
  accounts:    { w: 4, h: 1 },
  bar_chart:   { w: 2, h: 1 },
  donut_chart: { w: 2, h: 1 },
  calendar:    { w: 4, h: 1 },
};
```

### Migration helper — `_migrate(layout)`

Existing steps (order/hidden migration) are unchanged. Add a new step for sizes:

For each widget in `order`:
1. If `sizes[id]` is a plain number: convert `1` → `{ w: 2, h: 1 }`, `2` → `{ w: 4, h: 1 }`
2. If `sizes[id]` is missing, not an object, or has `w`/`h` outside valid ranges: replace with `DEFAULT_SIZES[id]`
3. Clamp: `w` must be in `[1, 2, 3, 4]`, `h` must be in `[1, 2, 3]`

If migration changed anything, upsert back to the database before returning.

### `GET /api/settings/dashboard`

Unchanged — returns layout after `_migrate`.

### `POST /api/settings/dashboard`

Body: `{ order: string[], hidden: string[], sizes: object }`

Updated `sizes` validation:
- Must be an object
- For every key in `sizes`: key must be a known widget ID
- Value must be an object with `w` in `[1, 2, 3, 4]` and `h` in `[1, 2, 3]`
- Missing widget IDs in `sizes` are filled from `DEFAULT_SIZES` before storing

On success: upserts and returns `{ ok: true }`.
On failure: returns `400` with `{ error: '...' }`.

---

## Frontend — `public/app.js`

### `_renderDashboard(editMode, editOrder, editHidden, editSizes)`

No new parameters. `editSizes` now holds `{ w, h }` objects.

**Widget container:**
```javascript
`<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px">`
```

**Each widget element** (`sz = editSizes[id] ?? DEFAULT_SIZES[id]`):
```javascript
style="grid-column:span ${sz.w};grid-row:span ${sz.h}"
```

**Ghost slots in edit mode:** always `grid-column: span 4` (full-width, unchanged behaviour).

### Resize handle — edit mode

Remove the old snap logic entirely. Replace with:

```javascript
handle.addEventListener('mousedown', e => {
  e.preventDefault();
  e.stopPropagation();
  const widgetId = handle.dataset.widget;
  const el = handle.closest('[data-widget]');
  const original = { ...editSizes[widgetId] };

  showPicker(el, widgetId, editSizes[widgetId],
    (w, h) => {
      // onHover: live CSS update — no re-render
      el.style.gridColumn = `span ${w}`;
      el.style.gridRow    = `span ${h}`;
    },
    (w, h) => {
      // onCommit
      editSizes[widgetId] = { w, h };
      _renderDashboard(true, editOrder, editHidden, editSizes);
    },
    () => {
      // onCancel (mouseup outside picker or Escape)
      el.style.gridColumn = `span ${original.w}`;
      el.style.gridRow    = `span ${original.h}`;
      _renderDashboard(true, editOrder, editHidden, editSizes);
    }
  );
});
```

### `showPicker(el, widgetId, currentSize, onHover, onCommit, onCancel)`

A self-contained helper function defined at module level (not inside `_renderDashboard`).

Behaviour:
1. Build a 4-column × 3-row grid of `.dash-picker-cell` elements. Cells up to `currentSize.w` wide and `currentSize.h` tall are marked `.active` on open.
2. Inject the picker div (`.dash-picker`) into `el` (absolute, bottom-right).
3. On `mousemove` over a cell: compute `{ w, h }` from the cell's `data-w`/`data-h` attributes; mark cells `.hover` (all cells with `data-w <= w && data-h <= h`); update the label; call `onHover(w, h)`.
4. On `mouseup` over a cell: remove all `document` listeners, remove picker from DOM, call `onCommit(w, h)`.
5. On `mouseup` outside picker: remove all listeners, remove picker, call `onCancel()`.
6. On `keydown` Escape: remove all listeners, remove picker, call `onCancel()`.

All `document` event listeners (`mousemove`, `mouseup`, `keydown`) are added inside `mousedown` and removed before any callback fires. No listener leaks across re-renders.

### Done button

Unchanged structurally — `editSizes` now holds `{ w, h }` objects but the spread/post logic is identical:

```javascript
await api('/settings/dashboard', {
  method: 'POST',
  body: { order: editOrder, hidden: editHidden, sizes: editSizes },
});
_dashData.layout = {
  order: [...editOrder],
  hidden: [...editHidden],
  sizes: { ...editSizes },
};
```

### `pages.dashboard`

Unchanged — `layout.sizes` from the API now contains `{ w, h }` objects; `_renderDashboard` receives them directly.

---

## CSS — `public/style.css`

No changes to existing rules. Add picker overlay styles:

```css
.dash-picker {
  position: absolute;
  bottom: 18px;
  right: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  z-index: 100;
  user-select: none;
}

.dash-picker-row { display: flex; gap: 3px; }

.dash-picker-cell {
  width: 18px;
  height: 18px;
  border: 1px solid #2a2a2a;
  border-radius: 2px;
  background: #111;
  cursor: pointer;
}

.dash-picker-cell.active { background: #f7a4a2; border-color: #f7a4a2; }
.dash-picker-cell.hover  { background: #f7a4a244; border-color: #f7a4a266; }

.dash-picker-label {
  font-size: 9px;
  color: #f7a4a2;
  text-align: center;
  margin-top: 2px;
  white-space: nowrap;
}
```

---

## Version

`package.json` version bumped to `1.4.2`.

---

## Out of Scope

- Row-height resizing beyond natural content height
- Mobile / touch support for the picker
- Free-form drag (non-snap) resizing
- Per-widget configuration beyond `{ w, h }`
