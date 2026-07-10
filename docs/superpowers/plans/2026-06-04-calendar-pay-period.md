# Calendar Pay Period Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Pay Period mode is active, the calendar dashboard widget navigates by pay period instead of calendar month — showing only the weeks that overlap the period, greying out days outside it, and displaying the period label as the title.

**Architecture:** All production changes live in `public/app.js` and one new `public/calendar-utils.js` utility (following the `period-utils.js` pattern). Add `calPeriodIndex` module state. Refactor `renderCalendar` to branch at the top — PP path fetches settings + periods, fetches events for up to 2 months, builds a flexible-week grid; monthly path is left unchanged. PP nav calls `renderCalendar()` without args to avoid resetting `calPeriodIndex`.

**Tech Stack:** Vanilla JS, existing `computePeriods` from `period-utils.js`, existing `/calendar/:year/:month` endpoint, Node.js built-in `assert` for tests.

---

## File Map

| File | What changes |
|------|--------------|
| `public/calendar-utils.js` | **New** — `calGridBounds(fromStr, toStr)` helper, exported for tests via CommonJS, global for browser |
| `public/index.html` | Add `<script src="calendar-utils.js"></script>` before `app.js` |
| `public/app.js` | Add `calPeriodIndex`; update `renderCalendar` signature + PP path |
| `tests/calendar-pp.test.js` | **New** — unit tests for `calGridBounds` + event filtering logic |

---

### Task 1: Write failing tests

**Files:**
- Create: `tests/calendar-pp.test.js`

The tests import `calGridBounds` from `public/calendar-utils.js`, which doesn't exist yet, so they fail immediately with "Cannot find module".

- [ ] **Step 1: Create `tests/calendar-pp.test.js`**

```js
// tests/calendar-pp.test.js
const assert = require('assert');
const { calGridBounds } = require('../public/calendar-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── Grid bounds ───────────────────────────────────────────────────────────
// 2026-05-15 = Friday (day 5). Sunday before = 2026-05-10.
// 2026-06-11 = Thursday (day 4). Saturday after = 2026-06-13.
test('cross-month period: startSunday is the Sunday on or before period.from', () => {
  const { startSunday } = calGridBounds('2026-05-15', '2026-06-11');
  assert.strictEqual(startSunday, '2026-05-10');
});

test('cross-month period: endSaturday is the Saturday on or after period.to', () => {
  const { endSaturday } = calGridBounds('2026-05-15', '2026-06-11');
  assert.strictEqual(endSaturday, '2026-06-13');
});

test('period starting on Sunday: startSunday equals period.from', () => {
  // 2026-05-10 = Sunday
  const { startSunday } = calGridBounds('2026-05-10', '2026-06-06');
  assert.strictEqual(startSunday, '2026-05-10');
});

test('period ending on Saturday: endSaturday equals period.to', () => {
  // 2026-06-06 = Saturday
  const { endSaturday } = calGridBounds('2026-05-10', '2026-06-06');
  assert.strictEqual(endSaturday, '2026-06-06');
});

test('exact 4-week period Sun→Sat: grid is exactly 28 days', () => {
  // 2026-05-10 Sun → 2026-06-06 Sat
  const { startSunday, endSaturday } = calGridBounds('2026-05-10', '2026-06-06');
  const start = new Date(startSunday + 'T00:00:00');
  const end   = new Date(endSaturday + 'T00:00:00');
  const days  = (end - start) / 86400000 + 1;
  assert.strictEqual(days, 28);
});

test('same-month period: bounds can fall outside that month', () => {
  // 2026-06-01 = Monday → startSunday = 2026-05-31
  // 2026-06-30 = Tuesday → endSaturday = 2026-07-04
  const { startSunday, endSaturday } = calGridBounds('2026-06-01', '2026-06-30');
  assert.strictEqual(startSunday, '2026-05-31');
  assert.strictEqual(endSaturday, '2026-07-04');
});

// ── Event filtering ───────────────────────────────────────────────────────
// Mirrors: results.flatMap(r => r.events).filter(ev => ev.date >= from && ev.date <= to)

test('event filter: excludes events outside period boundaries', () => {
  const from = '2026-05-15', to = '2026-06-11';
  const events = [
    { date: '2026-05-14', name: 'before' },
    { date: '2026-05-15', name: 'first' },
    { date: '2026-06-11', name: 'last' },
    { date: '2026-06-12', name: 'after' },
  ];
  const filtered = events.filter(ev => ev.date >= from && ev.date <= to);
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].name, 'first');
  assert.strictEqual(filtered[1].name, 'last');
});

test('event filter: flatMap merges two months of events correctly', () => {
  const from = '2026-05-15', to = '2026-06-11';
  const results = [
    { events: [{ date: '2026-05-20', name: 'MayEv' }, { date: '2026-05-14', name: 'TooEarly' }] },
    { events: [{ date: '2026-06-05', name: 'JunEv' }, { date: '2026-06-12', name: 'TooLate' }] },
  ];
  const allEvents = results.flatMap(r => r.events).filter(ev => ev.date >= from && ev.date <= to);
  assert.strictEqual(allEvents.length, 2);
  assert.ok(allEvents.some(ev => ev.name === 'MayEv'));
  assert.ok(allEvents.some(ev => ev.name === 'JunEv'));
});

// ── safeIdx clamping ──────────────────────────────────────────────────────
// Mirrors: Math.min(Math.max(0, calPeriodIndex), periods.length - 1)

test('safeIdx: clamps negative index to 0', () => {
  const safeIdx = Math.min(Math.max(0, -1), 7);
  assert.strictEqual(safeIdx, 0);
});

test('safeIdx: clamps index beyond last period to last index', () => {
  const safeIdx = Math.min(Math.max(0, 10), 7);
  assert.strictEqual(safeIdx, 7);
});

test('safeIdx: leaves in-range index unchanged', () => {
  const safeIdx = Math.min(Math.max(0, 3), 7);
  assert.strictEqual(safeIdx, 3);
});

// ── Cross-month detection ─────────────────────────────────────────────────
// Mirrors: fromDate.getMonth() !== toDate.getMonth() || fromDate.getFullYear() !== toDate.getFullYear()

test('cross-month detection: same month → false', () => {
  const from = new Date('2026-06-01T00:00:00');
  const to   = new Date('2026-06-30T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, false);
});

test('cross-month detection: adjacent months → true', () => {
  const from = new Date('2026-05-15T00:00:00');
  const to   = new Date('2026-06-11T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, true);
});

test('cross-month detection: year boundary → true', () => {
  const from = new Date('2025-12-15T00:00:00');
  const to   = new Date('2026-01-11T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `node tests/calendar-pp.test.js`

Expected: `Error: Cannot find module '../public/calendar-utils'`

---

### Task 2: Create `calendar-utils.js` and add the script tag

**Files:**
- Create: `public/calendar-utils.js`
- Modify: `public/index.html` line 93

- [ ] **Step 1: Create `public/calendar-utils.js`**

```js
function calGridBounds(fromStr, toStr) {
  const fromDate = new Date(fromStr + 'T00:00:00');
  const toDate   = new Date(toStr   + 'T00:00:00');
  const s = new Date(fromDate);
  s.setDate(fromDate.getDate() - fromDate.getDay());
  const e = new Date(toDate);
  e.setDate(toDate.getDate() + (6 - toDate.getDay()));
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startSunday: fmt(s), endSaturday: fmt(e) };
}

if (typeof module !== 'undefined') module.exports = { calGridBounds };
```

- [ ] **Step 2: Add script tag to `public/index.html`**

Find line 93 (`<script src="period-utils.js"></script>`) and insert after it:

```html
  <script src="calendar-utils.js"></script>
```

So lines 93–95 become:
```html
  <script src="period-utils.js"></script>
  <script src="calendar-utils.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 3: Run tests to confirm they pass**

Run: `node tests/calendar-pp.test.js`

Expected:
```
  ✓ cross-month period: startSunday is the Sunday on or before period.from
  ✓ cross-month period: endSaturday is the Saturday on or after period.to
  ✓ period starting on Sunday: startSunday equals period.from
  ✓ period ending on Saturday: endSaturday equals period.to
  ✓ exact 4-week period Sun→Sat: grid is exactly 28 days
  ✓ same-month period: bounds can fall outside that month
  ✓ event filter: excludes events outside period boundaries
  ✓ event filter: flatMap merges two months of events correctly
  ✓ safeIdx: clamps negative index to 0
  ✓ safeIdx: clamps index beyond last period to last index
  ✓ safeIdx: leaves in-range index unchanged
  ✓ cross-month detection: same month → false
  ✓ cross-month detection: adjacent months → true
  ✓ cross-month detection: year boundary → true

14 passed, 0 failed
```

- [ ] **Step 4: Confirm existing tests still pass**

Run: `node tests/period.test.js`

Expected: `13 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add public/calendar-utils.js public/index.html tests/calendar-pp.test.js
git commit -m "test: calendar PP grid bounds utility and tests"
```

---

### Task 3: Add `calPeriodIndex` state

**Files:**
- Modify: `public/app.js` line 152

Current line 152:
```js
let calYear = null, calMonth = null;
```

- [ ] **Step 1: Add `calPeriodIndex` on the next line**

Replace that line with:
```js
let calYear = null, calMonth = null;
let calPeriodIndex = 0;
```

- [ ] **Step 2: Confirm the app still loads (no syntax error)**

Run: `node -e "require('./public/calendar-utils'); console.log('ok')"` — should print `ok`.

(Full app.js parse check: `node --check public/app.js` — should exit 0.)

Run: `node --check public/app.js`

Expected: no output, exit code 0.

---

### Task 4: Rewrite `renderCalendar` with PP path

**Files:**
- Modify: `public/app.js` lines 623–706 (the entire `renderCalendar` function)

The existing function starts at line 623 (`async function renderCalendar(year, month) {`) and ends at line 707 (closing `}`).

- [ ] **Step 1: Replace the entire `renderCalendar` function with the new implementation**

Replace from `async function renderCalendar(year, month) {` through the closing `}` at line 707 with:

```js
async function renderCalendar(year, month) {
  if (year !== undefined) {
    calYear = year; calMonth = month;
    calPeriodIndex = 0;
  }

  const widget = document.getElementById('calWidget');
  if (!widget) return;

  const [ppSettings, schedules] = await Promise.all([
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);

  let paySchedule = null;
  if (ppSettings.mode === 'pay_period' && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }

  if (ppSettings.mode === 'pay_period' && paySchedule) {
    const periods = computePeriods(paySchedule, 8);
    const safeIdx = Math.min(Math.max(0, calPeriodIndex), periods.length - 1);
    const period  = periods[safeIdx];

    const fromDate = new Date(period.from + 'T00:00:00');
    const toDate   = new Date(period.to   + 'T00:00:00');
    const fetches  = [api(`/calendar/${fromDate.getFullYear()}/${fromDate.getMonth() + 1}`)];
    if (fromDate.getFullYear() !== toDate.getFullYear() || fromDate.getMonth() !== toDate.getMonth()) {
      fetches.push(api(`/calendar/${toDate.getFullYear()}/${toDate.getMonth() + 1}`));
    }
    const results   = await Promise.all(fetches);
    const allEvents = results.flatMap(r => r.events).filter(ev => ev.date >= period.from && ev.date <= period.to);

    const eventsByDate = {};
    for (const ev of allEvents) {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    }

    const { startSunday, endSaturday } = calGridBounds(period.from, period.to);
    const todayStr = new Date().toISOString().split('T')[0];
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    let cells = '';
    const cur = new Date(startSunday + 'T00:00:00');
    const end = new Date(endSaturday + 'T00:00:00');
    while (cur <= end) {
      const dateStr  = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      const inPeriod = dateStr >= period.from && dateStr <= period.to;
      const isToday  = dateStr === todayStr;
      if (!inPeriod) {
        cells += `<div class="cal-day cal-other"><div class="cal-num">${cur.getDate()}</div></div>`;
      } else {
        const dayEvs = eventsByDate[dateStr] || [];
        const pills  = dayEvs.map(ev => {
          if (ev.type === 'bill') {
            const bg  = hexDarken(ev.colour);
            const opa = ev.paid ? 'opacity:0.5;' : '';
            const str = ev.paid ? 'text-decoration:line-through;' : '';
            return `<div class="event-pill" style="background:${bg};color:${ev.colour};${opa}">${esc(ev.name)} <span style="${str}">${fmt(ev.amount)}</span></div>`;
          }
          return `<div class="event-pill" style="background:#166534;color:#4ade80">${esc(ev.name)} ${fmt(ev.amount)}</div>`;
        }).join('');
        cells += `<div class="cal-day${dayEvs.length ? ' cal-has' : ''}">
          <div class="cal-num${isToday ? ' cal-today' : ''}">${cur.getDate()}</div>
          ${pills}
        </div>`;
      }
      cur.setDate(cur.getDate() + 1);
    }

    const prevDisabled = safeIdx >= periods.length - 1;
    const nextDisabled = safeIdx === 0;

    widget.style.display = 'block';
    widget.innerHTML = `
      <style>
        .cal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .cal-title{color:#fff;font-size:15px;font-weight:700}
        .cal-nav{background:#2a2a2a;border:none;color:#888;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
        .cal-nav:hover:not(:disabled){color:#fff}
        .cal-nav:disabled{opacity:0.3;cursor:default}
        .cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:1px}
        .cal-dow{color:#555;font-size:11px;text-align:center;padding:5px 0;font-weight:600}
        .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#2a2a2a;border-radius:6px;overflow:hidden}
        .cal-day{background:#111;min-height:72px;padding:4px}
        .cal-other{background:#0d0d0d}
        .cal-num{color:#888;font-size:11px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;margin-bottom:3px;border-radius:50%}
        .cal-has .cal-num{color:#fff}
        .cal-today{background:#f7a4a2!important;color:#1a1a1a!important;font-weight:700}
        .event-pill{font-size:10px;border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:1.4}
      </style>
      <div class="cal-hdr">
        <button class="cal-nav" id="calPrev"${prevDisabled ? ' disabled' : ''}>◀</button>
        <span class="cal-title">${esc(period.label)}</span>
        <button class="cal-nav" id="calNext"${nextDisabled ? ' disabled' : ''}>▶</button>
      </div>
      <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div style="margin-top:10px;display:flex;gap:16px;font-size:11px;color:#888">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#166534;margin-right:4px;vertical-align:middle"></span>Pay day / income</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#7f1d1d;margin-right:4px;vertical-align:middle"></span>Bill (category colour)</span>
      </div>
    `;

    if (!prevDisabled) {
      document.getElementById('calPrev').addEventListener('click', () => {
        calPeriodIndex++;
        renderCalendar();
      });
    }
    if (!nextDisabled) {
      document.getElementById('calNext').addEventListener('click', () => {
        calPeriodIndex--;
        renderCalendar();
      });
    }
    return;
  }

  // ── Monthly path (unchanged behaviour) ──────────────────────────────────
  const data = await api(`/calendar/${calYear}/${calMonth}`);

  const eventsByDate = {};
  for (const ev of data.events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
  const dim      = new Date(calYear, calMonth, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];
  const monthPad = String(calMonth).padStart(2, '0');
  const DOW      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day cal-other"></div>`;

  for (let d = 1; d <= dim; d++) {
    const dayPad  = String(d).padStart(2, '0');
    const dateStr = `${calYear}-${monthPad}-${dayPad}`;
    const isToday = dateStr === todayStr;
    const dayEvs  = eventsByDate[dateStr] || [];

    const pills = dayEvs.map(ev => {
      if (ev.type === 'bill') {
        const bg  = hexDarken(ev.colour);
        const opa = ev.paid ? 'opacity:0.5;' : '';
        const str = ev.paid ? 'text-decoration:line-through;' : '';
        return `<div class="event-pill" style="background:${bg};color:${ev.colour};${opa}">${esc(ev.name)} <span style="${str}">${fmt(ev.amount)}</span></div>`;
      }
      return `<div class="event-pill" style="background:#166534;color:#4ade80">${esc(ev.name)} ${fmt(ev.amount)}</div>`;
    }).join('');

    cells += `<div class="cal-day${dayEvs.length ? ' cal-has' : ''}">
      <div class="cal-num${isToday ? ' cal-today' : ''}">${d}</div>
      ${pills}
    </div>`;
  }

  const rem = (firstDow + dim) % 7;
  if (rem !== 0) for (let i = 0; i < 7 - rem; i++) cells += `<div class="cal-day cal-other"></div>`;

  widget.style.display = 'block';
  widget.innerHTML = `
    <style>
      .cal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .cal-title{color:#fff;font-size:15px;font-weight:700}
      .cal-nav{background:#2a2a2a;border:none;color:#888;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
      .cal-nav:hover{color:#fff}
      .cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:1px}
      .cal-dow{color:#555;font-size:11px;text-align:center;padding:5px 0;font-weight:600}
      .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#2a2a2a;border-radius:6px;overflow:hidden}
      .cal-day{background:#111;min-height:72px;padding:4px}
      .cal-other{background:#0d0d0d}
      .cal-num{color:#888;font-size:11px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;margin-bottom:3px;border-radius:50%}
      .cal-has .cal-num{color:#fff}
      .cal-today{background:#f7a4a2!important;color:#1a1a1a!important;font-weight:700}
      .event-pill{font-size:10px;border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:1.4}
    </style>
    <div class="cal-hdr">
      <button class="cal-nav" id="calPrev">◀</button>
      <span class="cal-title">${monthName(calMonth)} ${calYear}</span>
      <button class="cal-nav" id="calNext">▶</button>
    </div>
    <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div style="margin-top:10px;display:flex;gap:16px;font-size:11px;color:#888">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#166534;margin-right:4px;vertical-align:middle"></span>Pay day / income</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#7f1d1d;margin-right:4px;vertical-align:middle"></span>Bill (category colour)</span>
    </div>
  `;

  document.getElementById('calPrev').addEventListener('click', () => {
    const d = new Date(calYear, calMonth - 2, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    const d = new Date(calYear, calMonth, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check public/app.js`

Expected: no output, exit code 0.

- [ ] **Step 3: Run all tests**

Run: `node tests/calendar-pp.test.js && node tests/period.test.js`

Expected: `14 passed, 0 failed` then `13 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: calendar pay period mode (v2.3.0)"
```

---

## Manual testing checklist (6 scenarios from spec)

Start the dev server: `node server.js` (or `npm run dev`)

1. **Monthly mode:** Navigate to Dashboard in monthly mode. Calendar shows current month. ◀/▶ change month correctly. Events visible.

2. **PP mode, single-month period:** Switch to Pay Period mode in Settings. Configure a schedule whose current period fits in one month. Calendar title shows period label (e.g. "25 May – 24 Jun"). Only weeks overlapping the period shown. Days outside period are darker/greyed.

3. **PP mode, cross-month period (May 15 – Jun 11):** Configure a monthly schedule with pay day on the 15th (or use four-weekly with appropriate anchor). Calendar shows ~5 weeks spanning both months. Events from both May and June APIs appear on the correct days.

4. **PP nav:** ◀ shows previous period (title changes, grid changes). ▶ returns to current. ▶ is disabled (greyed/non-clickable) on current period. ◀ is disabled on the oldest available period.

5. **PP mode, no primary schedule:** Enable Pay Period mode but clear the primary schedule. Calendar falls back silently to the current month view with no error banner.

6. **Mode switch:** Set mode to PP, view calendar. Switch to Monthly in Settings → return to Dashboard. Calendar resets to current month (not a stale period).

---

## Self-review against spec

| Spec requirement | Covered by |
|-----------------|------------|
| `calPeriodIndex = 0` module-level state | Task 3 |
| Reset to 0 on `pages.dashboard()` re-render | Task 4 — reset happens when `renderCalendar(year, month)` is called with args |
| PP detection + fallback to monthly if no valid schedule | Task 4 — `if (ppSettings.mode === 'pay_period' && paySchedule)` branch |
| Fetch 1 or 2 calendar months | Task 4 — cross-month detection + `Promise.all(fetches)` |
| Filter events to period range | Task 4 — `.filter(ev => ev.date >= period.from && ev.date <= period.to)` |
| Grid from Sunday of week containing `period.from` | Task 4 — `calGridBounds` → `startSunday` |
| Grid to Saturday of week containing `period.to` | Task 4 — `calGridBounds` → `endSaturday` |
| Out-of-period days: `cal-day cal-other`, no events | Task 4 — `if (!inPeriod)` branch |
| Today highlight still applies | Task 4 — `isToday` check applies inside-period days |
| Title = `esc(period.label)` | Task 4 — `<span class="cal-title">${esc(period.label)}</span>` |
| ◀ = `calPeriodIndex++`, disabled at oldest | Task 4 — prevDisabled + click handler |
| ▶ = `calPeriodIndex--`, disabled at current | Task 4 — nextDisabled + click handler |
| Monthly path completely unchanged | Task 4 — monthly path code identical to original |
| No backend changes | ✓ — only frontend files modified |
