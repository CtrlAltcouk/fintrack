# Bills Page: Pay Period Mode + Total

## Goal

Bring the Bills page in line with the rest of the app's Pay Period mode (Dashboard, Daily Spending, Calendar): when Settings → Pay Period is active, the Bills page shows only the bills due in the currently viewed pay period instead of a calendar month, navigated with the same ◀ Period ▶ pattern as Daily Spending. Separately, add a running total of the bills shown (whichever mode is active) to the Active Bills card.

## Background

- Bills recur once per calendar month via a clamped `due_day` (1–31) and the `bill_months` table (one row per `(bill_id, year, month)`, tracking `paid`/`amount_paid`/`paid_date`). There is no per-row date column — the due date is always computed as `Math.min(due_day, daysInMonth(year, month))`.
- Pay periods (`computePeriods()` in `public/period-utils.js`) are at most ~31 days long, so a period can span parts of at most **two** calendar months (e.g. a monthly schedule with pay day on the 25th produces periods like `2026-06-25` → `2026-07-24`).
- Daily Spending (`pages.spending` in `public/app.js`) already implements the established UI pattern for period-aware pages: fetch `ppSettings` + `schedules`, compute `periods = computePeriods(paySchedule, 8)`, clamp a `periodIndex` into range, disable ◀/▶ at the boundaries, and show a "Pay Period mode is active but no primary schedule is set" banner (with a "Configure in Settings →" button) when the mode is on but no valid schedule is selected.
- Transactions/income have real `date` columns, so `routes/summary-range.js` can filter with a plain `WHERE date BETWEEN ? AND ?`. Bills have no such column, so an equivalent range query has to resolve occurrences per touched calendar month first.

## Backend: `GET /api/bills/by-range`

Added to `routes/bills.js`, alongside the existing `GET /` (year/month) route — that route is unchanged.

**Request:** `GET /api/bills/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD`

**Validation:** reuse `_parseDateRange(from, to)`, already exported from `routes/summary-range.js` (`module.exports._parseDateRange`), instead of duplicating the regex/ordering check.

**Algorithm:**
1. Enumerate every `{year, month}` pair the `[from, to]` range touches (inclusive of both endpoints' months — in practice 1 or 2 pairs, since periods are ≤31 days, but the loop is written generally rather than hard-coded to "at most 2").
2. For each touched month, call the existing `ensureBillMonths(year, month, userId)` so `bill_months` rows exist.
3. Query active bills joined to `bill_months`/`categories` for each touched month (same shape as the existing `GET /` query), compute each bill's clamped due date for that month, and build `due_date = YYYY-MM-DD`.
4. Keep only rows whose `due_date` falls within `[from, to]` inclusive.
5. Separately, unconditionally include **every cancelled bill** for the user (no date filtering — Cancelled Bills stays full-history regardless of period, matching current behavior and the decision below).
6. Merge active (in-range) + cancelled (full-history) into one flat array, same field shape as `GET /`, with `due_date` present (non-null) only on the active in-range rows.

**Response:** flat array of bill rows — no `total` field. Total is a frontend-only concern (see below), computed identically in both monthly and period mode.

## Frontend: `public/app.js`

### `pages.bills(year, month, periodIndex = 0)`

- Fetch `cats`, `accounts` (unchanged) plus `ppSettings = api('/settings/pay-period')` and `schedules = api('/income/schedules')`.
- `isPP = ppSettings.mode === 'pay_period'`.
- If `isPP`: resolve `paySchedule` from `ppSettings.primary_schedule_id` (must be `active`), then `periods = computePeriods(paySchedule, 8)` (8 periods of back-navigation — matches Daily Spending/Calendar, not the dashboard's 6).
- **No valid schedule** (`isPP && periods.length === 0`): render only the page header + the same no-schedule banner used on Daily Spending (verbatim copy: message + "Configure in Settings →" button that calls `pages.settings('personalisation')`). No bill list, no add-bill form. Return early.
- **Period mode** (`isPP && periods.length > 0`): `safeIndex = clamp(periodIndex, 0, periods.length - 1)`, `period = periods[safeIndex]`, fetch `GET /bills/by-range?from={period.from}&to={period.to}`, `navLabel = period.label`. ◀ disabled when `safeIndex >= periods.length - 1` (oldest), ▶ disabled when `safeIndex === 0` (current/newest) — identical convention to Daily Spending.
- **Monthly mode** (`!isPP`, unchanged): `year`/`month` default to today, fetch `GET /bills?year&month`.
- `active`/`cancelled` split stays exactly as today: `bills.filter(b => b.active)` / `!b.active`.

### Bill row rendering — two mode-specific differences

- **Due label:** monthly mode unchanged (`clampDueDay(b.due_day, year, month)` → "DUE 25th"). Period mode uses the row's `due_date` through the existing `formatDate()` helper → "DUE Fri 25 Jul" (a bare ordinal day would be ambiguous once a row could belong to either touched month).
- **Overdue flag:** monthly mode unchanged. Period mode: `!b.paid && b.due_date < todayStr && safeIndex === 0` — only flags overdue when viewing the current period, mirroring how monthly mode only flags overdue when viewing the actual current month.

### Total

Added to the "Active Bills" card header (mirrors Daily Spending's day-header total pattern): `active.reduce((sum, b) => sum + b.amount, 0)`, formatted with the existing `fmt()` helper. Computed identically in both modes — always reflects whatever's in the `active` array, paid or not (per earlier decision: total = all active bills in view, not just unpaid).

### Nav wiring & refresh-state fix

`billPrev`/`billNext` click handlers branch the same way Daily Spending's do: period mode steps `safeIndex ± 1` and calls `pages.bills(null, null, safeIndex ± 1)`; monthly mode steps the month and calls `pages.bills(year, month)`.

`payBill()` and `cancelBill()` currently call `pages.bills()` with no arguments after completing, which resets the view to the current month even today. Both are updated to pass through the current `year`, `month`, and `safeIndex` so the page stays on whatever period/month the user was viewing — necessary so paying/cancelling a bill mid-period doesn't silently yank the user back to "now".

## Decisions locked in during brainstorming

1. **Total scope:** sum of all active bills in the shown period/month, paid or unpaid (not just remaining).
2. **Trigger:** Bills page follows the global Settings → Pay Period toggle automatically — no separate per-page toggle.
3. **Cancelled Bills:** stays unscoped/full-history regardless of period mode — only Active Bills + the total become period-aware.

## Testing

- Unit tests for the new backend logic (new `tests/bills-range.test.js`, mirroring `tests/summary-range.test.js`): month-enumeration for a range within one month, a range spanning two months, a range spanning a year boundary (Dec → Jan), and confirming cancelled bills are always included regardless of `due_date`.
- Manual browser verification (per this project's `verify` skill): toggle Pay Period mode on with a monthly schedule, confirm the Bills page switches to period nav and shows the correct subset + total; navigate back/forward across a period that spans two calendar months and confirm a bill due near the boundary appears exactly once, in the correct period; pay/cancel a bill while viewing a non-current period and confirm the view doesn't reset to "now"; turn Pay Period mode off and confirm the page reverts to the existing monthly behavior unchanged.

## Out of scope

- Any change to how bills are created, categorized, or paid.
- Any change to the Cancelled Bills section beyond leaving it as-is under period mode.
- Weekly/four-weekly schedules are supported by the same mechanism (periods just happen to be shorter, often containing zero bill occurrences) — no special-casing needed beyond what's described above.
