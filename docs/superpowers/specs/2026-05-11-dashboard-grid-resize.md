# FinTrack v1.4.1: Dashboard Grid Resize & Chart Widget Split

## Overview

The dashboard gains a 2-column CSS grid layout. Each widget can be half-width (1 column) or full-width (2 columns). In edit mode a drag handle at the bottom-right of each widget snaps it between the two sizes. The `charts` widget is retired and replaced by two independent widgets — `bar_chart` and `donut_chart` — each movable and resizable individually.

---

## Widgets

Five named widgets (replaces the previous four):

| ID | Display name | Default size |
|----|-------------|-------------|
| `stats` | Monthly Stats | 2 (full-width) |
| `accounts` | Account Balances | 2 (full-width) |
| `bar_chart` | Income vs Spending | 1 (half-width) |
| `donut_chart` | Spending by Category | 1 (half-width) |
| `calendar` | Calendar | 2 (full-width) |

Default order: `stats → accounts → bar_chart → donut_chart → calendar`, all visible.

The retired `charts` widget ID must no longer appear in `KNOWN_WIDGETS`.

---

## Grid Layout

The dashboard widget container uses CSS:

```css
display: grid;
grid-template-columns: 1fr 1fr;
gap: 16px;
```

Each widget element gets `grid-column: span 1` (half-width) or `grid-column: span 2` (full-width).

### Responsive content

`.stat-grid` changes from `repeat(3, 1fr)` to `repeat(auto-fit, minmax(120px, 1fr))` in `style.css` so stat cards wrap naturally when their widget is at half-width.

Chart.js instances already use `responsive: true` — they fill their container automatically at any size.

---

## Database

### `settings` table — layout record

Key: `dashboard_layout`

Value: JSON string extended with a `sizes` field:

```json
{
  "order": ["stats", "accounts", "bar_chart", "donut_chart", "calendar"],
  "hidden": [],
  "sizes": {
    "stats": 2,
    "accounts": 2,
    "bar_chart": 1,
    "donut_chart": 1,
    "calendar": 2
  }
}
```

- `sizes` — object mapping every widget ID to `1` (half-width) or `2` (full-width)
- Missing widget IDs in `sizes` default to `2`

No schema migration needed — same `settings` table, just an updated JSON value.

---

## API — `routes/settings.js`

### Constants

```javascript
const KNOWN_WIDGETS = ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'];

const DEFAULT_SIZES = { stats: 2, accounts: 2, bar_chart: 1, donut_chart: 1, calendar: 2 };

const DEFAULT_LAYOUT = {
  order: ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'],
  hidden: [],
  sizes: DEFAULT_SIZES,
};
```

### Migration helper

A `_migrate(layout)` function normalises any stored layout to the current schema:

1. If `order` contains `'charts'`, replace it with `'bar_chart'` and `'donut_chart'` at the same index (insert both in place of the single `'charts'` entry).
2. Remove any IDs from `order` that are not in `KNOWN_WIDGETS`.
3. Add any `KNOWN_WIDGETS` IDs missing from `order` to the end.
4. Ensure `hidden` contains only IDs present in `order`; remove any that aren't.
5. If `sizes` is absent or not an object, set it to `DEFAULT_SIZES`.
6. For each widget in `order`, if `sizes[id]` is missing or not `1`/`2`, default it to `DEFAULT_SIZES[id] ?? 2`.

This function is called by `GET /api/settings/dashboard` before returning the stored layout. If migration changed anything, the migrated layout is upserted back to the database before returning so subsequent reads are already clean.

### `GET /api/settings/dashboard`

Returns the current layout after running `_migrate`. If no row exists, returns `DEFAULT_LAYOUT`.

### `POST /api/settings/dashboard`

Body: `{ order: string[], hidden: string[], sizes: object }`

Validation:
- `order` must be an array containing all 5 known widget IDs — exactly once each
- `hidden` must be an array of widget IDs all present in `order`
- `sizes` must be an object; for every key in `sizes`, the key must be a known widget ID and the value must be `1` or `2`
- Missing widget IDs in `sizes` are filled with their default from `DEFAULT_SIZES` before storing

On success: upserts and returns `{ ok: true }`.
On failure: returns `400` with `{ error: '...' }`.

---

## Frontend — `public/app.js`

### Module-level state

```javascript
let barChart = null, donutChart = null;
let calYear = null, calMonth = null;
let _dashData = null;
```

No new module-level variables.

### `WIDGET_NAMES`

```javascript
const WIDGET_NAMES = {
  stats:     'Monthly Stats',
  accounts:  'Account Balances',
  bar_chart: 'Income vs Spending',
  donut_chart: 'Spending by Category',
  calendar:  'Calendar',
};
```

### `_widgetHtml(id, summary, accounts)`

Remove the `charts` case. Add:

```javascript
if (id === 'bar_chart') return `
  <div class="card" style="margin-bottom:0">
    <div class="chart-title">Income vs Spending (6 months)</div>
    <canvas id="barChart" height="180"></canvas>
  </div>`;

if (id === 'donut_chart') return `
  <div class="card" style="margin-bottom:0">
    <div class="chart-title">Spending by Category</div>
    <canvas id="donutChart" height="180"></canvas>
  </div>`;
```

All widgets remove their own `margin-bottom:24px` since the grid gap handles spacing.

### `_renderDashboard(editMode, editOrder, editHidden, editSizes)`

New fourth parameter: `editSizes` — object mapping widget IDs to `1` or `2`.

**Widget container HTML:**

```html
<div class="dash-grid">
  <!-- widgets rendered here -->
</div>
```

Where `.dash-grid` is:
```css
display: grid;
grid-template-columns: 1fr 1fr;
gap: 16px;
```

Applied as an inline style on the container div inside `main().innerHTML`.

**Each widget element** gets `style="grid-column: span ${editSizes[id] ?? 2}"`.

**Edit mode — visible widget wrapper:**

```html
<div class="dash-widget" draggable="true" data-widget="${id}"
  style="position:relative; grid-column:span ${span}; border:1px dashed #f7a4a244;
         border-radius:8px; padding-top:30px">
  <!-- drag bar with ⠿ handle and ✕ button (unchanged) -->
  ${inner}
  <div class="dash-resize-handle" data-widget="${id}"
    style="position:absolute;bottom:4px;right:4px;width:14px;height:14px;
           border-right:2px solid #555;border-bottom:2px solid #555;
           cursor:se-resize;border-radius:0 0 4px 0"></div>
</div>
```

**Resize handle wiring (inside edit mode section):**

```javascript
document.querySelectorAll('.dash-resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const widgetId = handle.dataset.widget;
    const startX = e.clientX;

    const onMove = () => {}; // no-op: snap-only, no live preview needed

    const onUp = ev => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const delta = ev.clientX - startX;
      const current = editSizes[widgetId] ?? 2;
      if (delta > 40 && current === 1) editSizes[widgetId] = 2;
      else if (delta < -40 && current === 2) editSizes[widgetId] = 1;
      _renderDashboard(true, editOrder, editHidden, editSizes);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});
```

`mousemove`/`mouseup` listeners are added to `document` only inside `mousedown`, so each drag creates its own closure with stable `onMove`/`onUp` references. They are removed before re-rendering, so no leaks accumulate across re-renders.

**Ghost slots** are always `grid-column: span 2` in edit mode (full-width, so they don't leave gaps).

**Normal mode** — widget HTML:
```html
<div data-widget="${id}" style="grid-column:span ${editSizes[id] ?? 2}">
  ${inner}
</div>
```

### Chart initialisation

Split into two independent checks:

```javascript
if (!editHidden.includes('bar_chart') && $('barChart')) {
  // init barChart
}
if (!editHidden.includes('donut_chart') && $('donutChart')) {
  // init donutChart
}
```

### Done button

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

```javascript
const [summary, accounts, layout] = await Promise.all([
  api(`/summary/${year}/${month}`),
  getAccounts(),
  api('/settings/dashboard'),
]);
_dashData = { summary, accounts, layout };
_renderDashboard(false, [...layout.order], [...layout.hidden], { ...layout.sizes });
```

Edit button:
```javascript
$('dashEdit')?.addEventListener('click', () => {
  _renderDashboard(true,
    [..._dashData.layout.order],
    [..._dashData.layout.hidden],
    { ..._dashData.layout.sizes });
});
```

---

## CSS — `public/style.css`

Change `.stat-grid`:

```css
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
```

Remove `.chart-grid` rule entirely (no longer used — the two chart widgets are independent).

---

## Clear-data

`POST /api/update/clear-data` does **not** delete the `settings` row — layout is a preference, not financial data.

---

## Version

`package.json` version bumped to `1.4.1`.

---

## Out of Scope

- Free-form drag resize (more than 2 snap positions)
- Row-height resizing
- Mobile touch support for resize handle
- Per-widget configuration beyond size
