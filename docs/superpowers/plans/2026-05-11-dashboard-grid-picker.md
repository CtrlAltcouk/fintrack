# FinTrack v1.4.2: Grid Picker Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-state (span 1|2) widget resize with a 2D grid picker overlay (4 cols × 3 rows) that gives live CSS preview on hover and commits on mouseup, backed by a `{ w, h }` size format throughout.

**Architecture:** The dashboard CSS grid switches from 2 to 4 columns. Widget sizes stored in SQLite change from plain numbers (`1`|`2`) to `{ w, h }` objects (`w`: 1–4, `h`: 1–3). A new `showPicker()` helper injects the picker overlay directly into the widget's DOM element and wires document-level mouse/keyboard listeners that clean themselves up before firing callbacks. No re-render during hover — only CSS property changes for instant live preview.

**Tech Stack:** Node.js/Express 4, better-sqlite3 (sync SQLite), vanilla JS SPA, CSS Grid, Chart.js (responsive: true — auto-resizes with container)

---

## File Map

| File | Change |
|------|--------|
| `routes/settings.js` | Update `DEFAULT_SIZES`, `_migrate()`, POST validation; export `_migrate` |
| `public/app.js` | Update `_renderDashboard` grid+spans; add `showPicker()` before it; rewire resize handles |
| `public/style.css` | Append picker overlay CSS |
| `package.json` | Bump version to `1.4.2` |
| `tests/settings.test.js` | New — unit tests for `_migrate()` |

---

### Task 1: Write failing tests for `_migrate()`

**Files:**
- Create: `tests/settings.test.js`
- Modify: `routes/settings.js` (last line only — export `_migrate`)

- [ ] **Step 1: Expose `_migrate` for unit tests**

In `routes/settings.js`, replace the final line:

```javascript
module.exports = router;
```

with:

```javascript
module.exports = router;
module.exports._migrate = _migrate; // exposed for unit tests
```

- [ ] **Step 2: Create `tests/settings.test.js`**

```javascript
// tests/settings.test.js
const assert = require('assert');
const { _migrate } = require('../routes/settings');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

function base(sizesOverride) {
  return {
    order: ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'],
    hidden: [],
    sizes: sizesOverride ?? { stats: 2, accounts: 2, bar_chart: 1, donut_chart: 1, calendar: 2 },
  };
}

// --- Migration: old number format ---

test('migrates numeric 2 to { w:4, h:1 }', () => {
  const { layout } = _migrate(base());
  assert.deepStrictEqual(layout.sizes.stats,    { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.accounts, { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.calendar, { w: 4, h: 1 });
});

test('migrates numeric 1 to { w:2, h:1 }', () => {
  const { layout } = _migrate(base());
  assert.deepStrictEqual(layout.sizes.bar_chart,   { w: 2, h: 1 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 1 });
});

test('sets changed=true when numeric sizes are migrated', () => {
  const { changed } = _migrate(base());
  assert.strictEqual(changed, true);
});

// --- Passthrough: already { w, h } ---

test('passes through valid { w, h } unchanged', () => {
  const clean = {
    stats: { w: 4, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout, changed } = _migrate(base(clean));
  assert.deepStrictEqual(layout.sizes.stats,       { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 1 });
  assert.strictEqual(changed, false);
});

test('passes through non-default { w, h } unchanged', () => {
  const custom = {
    stats: { w: 3, h: 2 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 1, h: 1 }, donut_chart: { w: 2, h: 3 }, calendar: { w: 4, h: 2 },
  };
  const { layout } = _migrate(base(custom));
  assert.deepStrictEqual(layout.sizes.stats,       { w: 3, h: 2 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 3 });
});

// --- Invalid / missing sizes ---

test('fills missing size with default', () => {
  const { layout } = _migrate(base({}));
  assert.deepStrictEqual(layout.sizes.stats,    { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.bar_chart, { w: 2, h: 1 });
});

test('replaces { w:0, h:1 } with default', () => {
  const sizes = {
    stats: { w: 0, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.stats, { w: 4, h: 1 });
});

test('replaces { w:2, h:5 } with default', () => {
  const sizes = {
    stats: { w: 4, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 5 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.bar_chart, { w: 2, h: 1 });
});

test('replaces { w:5, h:2 } with default', () => {
  const sizes = {
    stats: { w: 4, h: 1 }, accounts: { w: 5, h: 2 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.accounts, { w: 4, h: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run tests — expect failures**

```
node tests/settings.test.js
```

Expected: multiple `✗` failures because `_migrate` still uses the old `1`/`2` format.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/settings.test.js routes/settings.js
git commit -m "test: add failing tests for v1.4.2 _migrate { w, h } format"
```

---

### Task 2: Update `DEFAULT_SIZES` and `_migrate()` in `routes/settings.js`

**Files:**
- Modify: `routes/settings.js`

- [ ] **Step 1: Replace `DEFAULT_SIZES` (line 7)**

Old:
```javascript
const DEFAULT_SIZES = { stats: 2, accounts: 2, bar_chart: 1, donut_chart: 1, calendar: 2 };
```

New:
```javascript
const DEFAULT_SIZES = {
  stats:       { w: 4, h: 1 },
  accounts:    { w: 4, h: 1 },
  bar_chart:   { w: 2, h: 1 },
  donut_chart: { w: 2, h: 1 },
  calendar:    { w: 4, h: 1 },
};
```

`DEFAULT_LAYOUT` (lines 9–13) spreads `DEFAULT_SIZES` and needs no separate change.

- [ ] **Step 2: Replace steps 5–6 in `_migrate()` (lines 51–63)**

Old:
```javascript
  // 5. Ensure sizes is an object
  if (!layout.sizes || typeof layout.sizes !== 'object' || Array.isArray(layout.sizes)) {
    layout.sizes = { ...DEFAULT_SIZES };
    changed = true;
  }

  // 6. Fill missing / invalid size values
  for (const id of layout.order) {
    if (layout.sizes[id] !== 1 && layout.sizes[id] !== 2) {
      layout.sizes[id] = DEFAULT_SIZES[id] ?? 2;
      changed = true;
    }
  }
```

New:
```javascript
  // 5. Ensure sizes is an object
  if (!layout.sizes || typeof layout.sizes !== 'object' || Array.isArray(layout.sizes)) {
    layout.sizes = { ...DEFAULT_SIZES };
    changed = true;
  }

  // 6. Migrate numeric sizes (v1.4.1) and fill missing / invalid { w, h } values
  for (const id of layout.order) {
    const s = layout.sizes[id];
    const def = DEFAULT_SIZES[id] ?? { w: 4, h: 1 };
    if (typeof s === 'number') {
      layout.sizes[id] = s === 1 ? { w: 2, h: 1 } : { w: 4, h: 1 };
      changed = true;
    } else if (
      !s || typeof s !== 'object' ||
      ![1, 2, 3, 4].includes(s.w) ||
      ![1, 2, 3].includes(s.h)
    ) {
      layout.sizes[id] = { ...def };
      changed = true;
    }
  }
```

- [ ] **Step 3: Run tests — all should pass**

```
node tests/settings.test.js
```

Expected:
```
  ✓ migrates numeric 2 to { w:4, h:1 }
  ✓ migrates numeric 1 to { w:2, h:1 }
  ✓ sets changed=true when numeric sizes are migrated
  ✓ passes through valid { w, h } unchanged
  ✓ passes through non-default { w, h } unchanged
  ✓ fills missing size with default
  ✓ replaces { w:0, h:1 } with default
  ✓ replaces { w:2, h:5 } with default
  ✓ replaces { w:5, h:2 } with default

9 passed, 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add routes/settings.js
git commit -m "feat: update DEFAULT_SIZES and _migrate for { w, h } size format"
```

---

### Task 3: Update POST validation in `routes/settings.js`

**Files:**
- Modify: `routes/settings.js` (lines 94–103)

- [ ] **Step 1: Replace the sizes validation block**

Old (lines 94–103):
```javascript
  if (sizes !== undefined && (typeof sizes !== 'object' || Array.isArray(sizes)))
    return res.status(400).json({ error: 'sizes must be an object' });
  if (sizes) {
    for (const [k, v] of Object.entries(sizes)) {
      if (!KNOWN_WIDGETS.includes(k))
        return res.status(400).json({ error: `sizes contains unknown widget ID: ${k}` });
      if (v !== 1 && v !== 2)
        return res.status(400).json({ error: `sizes.${k} must be 1 or 2` });
    }
  }
```

New:
```javascript
  if (sizes !== undefined && (typeof sizes !== 'object' || Array.isArray(sizes)))
    return res.status(400).json({ error: 'sizes must be an object' });
  if (sizes) {
    for (const [k, v] of Object.entries(sizes)) {
      if (!KNOWN_WIDGETS.includes(k))
        return res.status(400).json({ error: `sizes contains unknown widget ID: ${k}` });
      if (!v || typeof v !== 'object' || ![1,2,3,4].includes(v.w) || ![1,2,3].includes(v.h))
        return res.status(400).json({ error: `sizes.${k} must be { w: 1-4, h: 1-3 }` });
    }
  }
```

- [ ] **Step 2: Verify POST validation with curl**

Start the server: `npm run dev`

**Valid request — expect `{"ok":true}`:**
```bash
curl -s -X POST http://localhost:3000/api/settings/dashboard \
  -H "Content-Type: application/json" \
  -d '{"order":["stats","accounts","bar_chart","donut_chart","calendar"],"hidden":[],"sizes":{"stats":{"w":4,"h":1},"accounts":{"w":4,"h":1},"bar_chart":{"w":2,"h":1},"donut_chart":{"w":2,"h":1},"calendar":{"w":4,"h":1}}}'
```

**Invalid w value — expect `400`:**
```bash
curl -s -X POST http://localhost:3000/api/settings/dashboard \
  -H "Content-Type: application/json" \
  -d '{"order":["stats","accounts","bar_chart","donut_chart","calendar"],"hidden":[],"sizes":{"stats":{"w":5,"h":1},"accounts":{"w":4,"h":1},"bar_chart":{"w":2,"h":1},"donut_chart":{"w":2,"h":1},"calendar":{"w":4,"h":1}}}'
```

**Invalid h value — expect `400`:**
```bash
curl -s -X POST http://localhost:3000/api/settings/dashboard \
  -H "Content-Type: application/json" \
  -d '{"order":["stats","accounts","bar_chart","donut_chart","calendar"],"hidden":[],"sizes":{"stats":{"w":4,"h":4},"accounts":{"w":4,"h":1},"bar_chart":{"w":2,"h":1},"donut_chart":{"w":2,"h":1},"calendar":{"w":4,"h":1}}}'
```

- [ ] **Step 3: Commit**

```bash
git add routes/settings.js
git commit -m "feat: update POST /settings/dashboard to validate { w, h } sizes"
```

---

### Task 4: Add picker overlay CSS to `public/style.css`

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Append picker CSS to the end of `public/style.css`**

```css
/* ── Dashboard grid picker ─────────────────────────────────────── */
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

- [ ] **Step 2: Verify in browser**

Open the app and check DevTools console — no CSS errors.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: add dash-picker CSS for grid picker overlay"
```

---

### Task 5: Update `_renderDashboard` grid and spans in `public/app.js`

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Replace `span` variable with `sz` (line 123)**

Old:
```javascript
    const span = editSizes[id] ?? 2;
```

New:
```javascript
    const sz = editSizes[id] ?? { w: 4, h: 1 };
```

- [ ] **Step 2: Update ghost slot from `span 2` to `span 4` (line 130)**

Old:
```javascript
          style="grid-column:span 2;border:1px dashed #333;border-radius:8px;padding:10px 16px;
```

New:
```javascript
          style="grid-column:span 4;border:1px dashed #333;border-radius:8px;padding:10px 16px;
```

- [ ] **Step 3: Update normal-mode widget span (line 145)**

Old:
```javascript
      return `<div data-widget="${id}" style="grid-column:span ${span}">${inner}</div>`;
```

New:
```javascript
      return `<div data-widget="${id}" style="grid-column:span ${sz.w};grid-row:span ${sz.h}">${inner}</div>`;
```

- [ ] **Step 4: Update edit-mode widget span (lines 150–152)**

Old:
```javascript
      <div class="dash-widget" draggable="true" data-widget="${id}"
        style="position:relative;grid-column:span ${span};border:1px dashed #f7a4a244;
               border-radius:8px;padding-top:30px">
```

New:
```javascript
      <div class="dash-widget" draggable="true" data-widget="${id}"
        style="position:relative;grid-column:span ${sz.w};grid-row:span ${sz.h};border:1px dashed #f7a4a244;
               border-radius:8px;padding-top:30px">
```

- [ ] **Step 5: Update container grid to 4 columns (line 184)**

Old:
```javascript
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
```

New:
```javascript
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px">
```

- [ ] **Step 6: Verify dashboard renders correctly**

Start `npm run dev` and open the app dashboard. Confirm:
- Stats, Accounts, Calendar are full-width (span 4)
- Bar chart and Donut chart sit side-by-side at half-width (span 2 each)

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: switch dashboard to 4-column grid with { w, h } span support"
```

---

### Task 6: Add `showPicker()` helper to `public/app.js`

**Files:**
- Modify: `public/app.js`

Insert the complete `showPicker` function immediately before line 114 (`function _renderDashboard`).

- [ ] **Step 1: Insert `showPicker()` before `_renderDashboard`**

```javascript
function showPicker(el, currentSize, onHover, onCommit, onCancel) {
  const rows = [1, 2, 3];
  const cols = [1, 2, 3, 4];

  const labelEl = document.createElement('div');
  labelEl.className = 'dash-picker-label';
  labelEl.textContent = `${currentSize.w} wide × ${currentSize.h} tall`;

  const picker = document.createElement('div');
  picker.className = 'dash-picker';

  rows.forEach(h => {
    const row = document.createElement('div');
    row.className = 'dash-picker-row';
    cols.forEach(w => {
      const cell = document.createElement('div');
      cell.className = 'dash-picker-cell';
      cell.dataset.w = w;
      cell.dataset.h = h;
      if (w <= currentSize.w && h <= currentSize.h) cell.classList.add('active');
      row.appendChild(cell);
    });
    picker.appendChild(row);
  });
  picker.appendChild(labelEl);
  el.appendChild(picker);

  function updateHover(w, h) {
    picker.querySelectorAll('.dash-picker-cell').forEach(c => {
      c.classList.remove('active', 'hover');
      if (+c.dataset.w <= w && +c.dataset.h <= h) c.classList.add('hover');
    });
    labelEl.textContent = `${w} wide × ${h} tall`;
    onHover(w, h);
  }

  function cleanup() {
    document.removeEventListener('mousemove', onDocMove);
    document.removeEventListener('mouseup',   onDocUp);
    document.removeEventListener('keydown',   onDocKey);
    if (picker.parentNode) picker.parentNode.removeChild(picker);
  }

  function onDocMove(e) {
    const t = e.target;
    if (t.classList.contains('dash-picker-cell') && t.closest('.dash-picker') === picker) {
      updateHover(+t.dataset.w, +t.dataset.h);
    }
  }

  function onDocUp(e) {
    const t = e.target;
    if (t.classList.contains('dash-picker-cell') && t.closest('.dash-picker') === picker) {
      const w = +t.dataset.w, h = +t.dataset.h;
      cleanup();
      onCommit(w, h);
    } else {
      cleanup();
      onCancel();
    }
  }

  function onDocKey(e) {
    if (e.key === 'Escape') { cleanup(); onCancel(); }
  }

  document.addEventListener('mousemove', onDocMove);
  document.addEventListener('mouseup',   onDocUp);
  document.addEventListener('keydown',   onDocKey);
}

```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: add showPicker() helper for 2D grid picker overlay"
```

---

### Task 7: Wire resize handles to `showPicker()` and bump version

**Files:**
- Modify: `public/app.js` (lines 310–333)
- Modify: `package.json`

- [ ] **Step 1: Replace the resize handle block in `_renderDashboard` (lines 310–333)**

Old:
```javascript
  // Resize handles — drag right to expand, drag left to shrink
  document.querySelectorAll('.dash-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const widgetId = handle.dataset.widget;
      const startX = e.clientX;

      const onMove = () => {}; // snap-only: no live preview, resize commits on mouseup

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

New:
```javascript
  // Resize handles — open 2D grid picker on mousedown
  document.querySelectorAll('.dash-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const widgetId = handle.dataset.widget;
      const el = handle.closest('[data-widget]');
      const original = { ...(editSizes[widgetId] ?? { w: 4, h: 1 }) };

      showPicker(
        el,
        original,
        (w, h) => {
          el.style.gridColumn = `span ${w}`;
          el.style.gridRow    = `span ${h}`;
        },
        (w, h) => {
          editSizes[widgetId] = { w, h };
          _renderDashboard(true, editOrder, editHidden, editSizes);
        },
        () => {
          el.style.gridColumn = `span ${original.w}`;
          el.style.gridRow    = `span ${original.h}`;
          _renderDashboard(true, editOrder, editHidden, editSizes);
        },
      );
    });
  });
```

- [ ] **Step 2: Bump version in `package.json` (line 3)**

Old:
```json
  "version": "1.4.1",
```

New:
```json
  "version": "1.4.2",
```

- [ ] **Step 3: Full smoke test**

Start `npm run dev`, open the app dashboard.

1. Click **✏️ Edit**
2. Mousedown (hold) the resize handle (bottom-right corner, the `⌟` indicator) of any widget
3. **Verify:** a 4×3 grid picker appears near the handle; the cells up to the current size are pink
4. Move cursor over different cells — **verify:** the widget resizes live (CSS only) and the label updates ("1 wide × 2 tall" etc.)
5. Release over a cell — **verify:** the widget commits to that size; picker disappears; re-render runs
6. Repeat, release *outside* the picker — **verify:** widget returns to original size
7. Mousedown a handle, then press **Escape** — **verify:** widget returns to original size
8. Resize the donut chart to 1 wide × 1 tall — **verify:** it shrinks to quarter-width
9. Click **✓ Done** — **verify:** POST succeeds (no alert); refresh the page and confirm sizes persist

- [ ] **Step 4: Verify existing layout migration**

If `data/fintrack.db` has an old layout with numeric sizes, the first `GET /api/settings/dashboard` will auto-migrate them. Open the app and confirm no console errors appear and the dashboard renders with widgets at their expected sizes.

- [ ] **Step 5: Commit**

```bash
git add public/app.js package.json
git commit -m "feat: wire resize handles to showPicker, bump version to 1.4.2"
```
