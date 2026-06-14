# Spec: Schedule Edit (going forward) + dom ≥ 29 period fix

**Date:** 2026-06-14  
**Version bump:** 2.4.0

---

## 1. dom ≥ 29 clamped payday fix

### Problem

`computePeriods` (monthly frequency) compared `todayDate.getUTCDate() < dom` to decide whether today is before or after the pay day. When `dom` is 29–31 and the current month is shorter (e.g. dom=31, April → clamped to 30), April 30 read as "before day 31" and fell into the previous period instead of starting the new one.

### Fix

`public/period-utils.js` — before the period-start check, compute `daysInCurrentMonth` and compare against `Math.min(dom, daysInCurrentMonth)` instead of raw `dom`.

### Tests added (`tests/period.test.js`)

- dom=31, today=Apr 30 → period starts Apr 30 (new period, not previous)
- dom=31, today=Apr 29 → period starts Mar 31 (previous period, day before clamped pay day)

---

## 2. Edit going forward — income schedules

### Problem

To change a recurring income schedule (e.g. a pay rise), users had to deactivate the old schedule and create a new one. This left duplicate auto-generated entries for the current month: one from the old schedule and one from the new.

### Solution

An **Edit** button on each Recurring Source row. Clicking it expands an inline form pre-filled with the schedule's current values. On save, the schedule is updated and all income entries from today onwards linked to it are deleted — they regenerate with the new values the next time that month is viewed. Past entries (before today) are never touched.

### Scope of "going forward"

Entries where `date >= today` (today inclusive). This covers the current month's not-yet-occurred pay day as well as all future months.

---

## Architecture

### Backend — `routes/income-schedules.js`

New route: `PATCH /api/income/schedules/:id`

- Validates fields identically to `POST /api/income/schedules`
- Updates the schedule row (name, amount, frequency, day_of_month, anchor_date, account_id)
- Deletes `income` rows where `source_schedule_id = id AND date >= today`
- Returns the updated schedule object

Ordering note: this route is registered before `PATCH /:id/deactivate` — Express path segments are non-overlapping (`/5` vs `/5/deactivate`) so no conflict.

### Frontend — `public/app.js`

**Module-level:** `_scheduleEditData` — populated in `pages.income` with `{ schedules, accounts }` at render time so the edit handler has data without an extra API call.

**`window.editSchedule(id)`** — looks up the schedule from `_scheduleEditData`, inserts an inline `<div>` immediately after the row (`insertAdjacentElement('afterend', ...)`). Calling Edit on an already-open row toggles it closed.

**`window._seditFreqChange(id)`** — swaps the day-of-month / anchor-date field when the frequency select changes (mirrors the existing `renderFreqFields` pattern for the add form).

**`window.saveScheduleEdit(id)`** — calls `PATCH /api/income/schedules/:id`, then re-renders `pages.income(currentYear, currentMonth, 'recurring')`.

---

## Files changed

| File | Change |
|------|--------|
| `public/period-utils.js` | `daysInCurrentMonth` + `Math.min(dom, daysInCurrentMonth)` |
| `tests/period.test.js` | 2 new edge-case tests (15 total) |
| `routes/income-schedules.js` | New `PATCH /:id` route |
| `public/app.js` | `_scheduleEditData` var; Edit button on schedule rows; `editSchedule`, `_seditFreqChange`, `saveScheduleEdit` window functions |
