# Calendar Pay Period Mode Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Version target:** 2.3.0

---

## Goal

When Pay Period mode is active, the calendar dashboard widget navigates by pay period instead of by calendar month. The grid shows all weeks that overlap the current period, with days outside the period greyed out. The title shows the period label (e.g. "15 May – 11 Jun") instead of the month name.

---

## Scope

- **One file changed:** `public/app.js` — only the `renderCalendar` function and the `calPeriodIndex` module-level variable.
- **No backend changes.** Events are fetched using the existing `/calendar/:year/:month` endpoint — at most two calls when a period spans two calendar months.
- **Monthly mode:** completely unchanged.

---

## Module-level state

Add alongside existing `calYear`/`calMonth`:

```js
let calPeriodIndex = 0;
```

0 = current period, 1 = one period back, etc. Reset to 0 when `pages.dashboard()` re-renders.

---

## `renderCalendar` — Pay Period path

### Activation

At the start of `renderCalendar`, fetch pay period settings and schedules (parallel with or before the calendar data). If `ppSettings.mode !== 'pay_period'` → fall through to the existing monthly path (no change).

If PP mode is active but no valid primary schedule → fall back silently to the monthly view (show current `calYear`/`calMonth`). No banner in this widget.

### Period boundary calculation

```js
const periods = computePeriods(paySchedule, 8);  // already-available global
const safeIdx = Math.min(Math.max(0, calPeriodIndex), periods.length - 1);
const period  = periods[safeIdx];  // { from: "2026-05-15", to: "2026-06-11", label: "15 May – 11 Jun" }
```

### Event fetching

Fetch events for every calendar month the period touches (1 or 2):

```js
const fromDate = new Date(period.from + 'T00:00:00');
const toDate   = new Date(period.to   + 'T00:00:00');
const fetches  = [api(`/calendar/${fromDate.getFullYear()}/${fromDate.getMonth() + 1}`)];
if (fromDate.getFullYear() !== toDate.getFullYear() || fromDate.getMonth() !== toDate.getMonth()) {
  fetches.push(api(`/calendar/${toDate.getFullYear()}/${toDate.getMonth() + 1}`));
}
const results   = await Promise.all(fetches);
const allEvents = results.flatMap(r => r.events).filter(ev => ev.date >= period.from && ev.date <= period.to);
```

### Grid construction

The grid spans from the **Sunday of the week containing `period.from`** to the **Saturday of the week containing `period.to`**:

```js
const startSunday = new Date(fromDate);
startSunday.setDate(fromDate.getDate() - fromDate.getDay());

const endSaturday = new Date(toDate);
endSaturday.setDate(toDate.getDate() + (6 - toDate.getDay()));
```

Iterate day by day from `startSunday` to `endSaturday`. For each day:
- If `dateStr < period.from` or `dateStr > period.to` → `cal-day cal-other` (greyed), show day number, no events
- Otherwise → normal `cal-day` with events (same pill rendering as monthly mode)
- Today highlight (`cal-today`) still applies if today falls within the grid

### Title and navigation

- Title: `esc(period.label)` instead of `monthName(month) year`
- ◀ button: `calPeriodIndex++; renderCalendar()` — disabled when `safeIdx >= periods.length - 1`
- ▶ button: `calPeriodIndex--; renderCalendar()` — disabled when `safeIdx === 0`

---

## Monthly path (unchanged)

If `ppSettings.mode !== 'pay_period'` (or PP mode but no valid schedule), the function behaves exactly as today:
- Title: `monthName(calMonth) calYear`
- ◀/▶ navigate by month, updating `calYear`/`calMonth`
- Events fetched from single `/calendar/${calYear}/${calMonth}`

---

## Integration with `pages.dashboard`

`renderCalendar` is called from the dashboard widget initialisation as `renderCalendar(calYear, calMonth)`. The updated function:
- When called **with** `(year, month)` args: updates `calYear`/`calMonth`, resets `calPeriodIndex = 0`. This is the dashboard init call.
- When called **without** args (from PP nav buttons): uses current `calPeriodIndex` without resetting.

This means every time the dashboard re-renders (e.g. after switching modes in Settings and returning), the calendar resets to the current period — consistent with Daily Spending behaviour.

---

## Files changed

| File | Change |
|------|--------|
| `public/app.js` | Add `calPeriodIndex`; update `renderCalendar` with PP mode path |

No new routes. No schema changes. No new settings keys.

---

## Testing

1. Monthly mode: calendar unchanged — navigate month by month, correct events shown
2. PP mode, period within one month: grid shows only the weeks of that period; out-of-period days greyed
3. PP mode, period spanning two months (May 15 – Jun 11): grid shows ~4 weeks across both months; events from both months appear correctly
4. ◀ navigates to previous period; ▶ navigates forward; ▶ disabled on current period; ◀ disabled at oldest period
5. PP mode with no primary schedule: falls back to current month view, no error
6. Switch from PP to Monthly in Settings → calendar resets to current month
