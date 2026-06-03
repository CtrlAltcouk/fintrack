# Pay Period Toggle — Design Spec

**Date:** 2026-06-03  
**Status:** Approved  
**Version target:** 1.6.0

---

## Overview

Add a toggle that lets users switch the entire dashboard between **Monthly** view (current behaviour — calendar month) and **Pay Period** view (date range driven by the user's chosen primary income schedule). When in Pay Period mode, the headline stats, bar chart trend, spending-by-category donut, and calendar period label all recalculate for the pay period rather than the calendar month.

---

## Data Model

No schema migration required. Two new keys are stored in the existing `settings` table using the existing `(user_id, key)` composite PK and `stmtUpsert` pattern.

| Key | Type | Values | Default |
|-----|------|--------|---------|
| `dashboard_mode` | string | `"monthly"` \| `"pay_period"` | `"monthly"` |
| `primary_schedule_id` | string | stringified integer (schedule row ID) | absent = none set |

Absence of either key is treated as the default (monthly, no primary schedule). No migration needed.

---

## Backend Changes

### 1. New routes in `routes/settings.js`

**`GET /api/settings/pay-period`**  
Returns the user's current pay period preferences.

```json
{ "mode": "monthly", "primary_schedule_id": null }
```

- Reads `dashboard_mode` and `primary_schedule_id` from the `settings` table for `req.userId`.
- Returns defaults if keys are absent.

**`POST /api/settings/pay-period`**  
Accepts `{ mode?, primary_schedule_id? }` — either or both fields may be present.

- Validates `mode` is `"monthly"` or `"pay_period"` if provided.
- Validates `primary_schedule_id` is a positive integer (or `null`) if provided.
- Upserts whichever keys are present; ignores absent fields.

### 2. New file: `routes/summary-range.js`

**`GET /api/summary/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD`**

Returns income, spending, and category breakdown for any arbitrary date range for the authenticated user.

Response shape (intentionally matches the existing `/api/summary/:year/:month` shape minus `monthlyTrend`):

```json
{
  "income": 2400.00,
  "spent": 1120.50,
  "remaining": 1279.50,
  "byCategory": [
    { "name": "Groceries", "colour": "#4ade80", "total": 340.00 }
  ]
}
```

- `from` and `to` are required; returns 400 if absent or malformed.
- Queries use `WHERE date >= ? AND date <= ?` against `income` and `transactions`, both filtered by `user_id`.
- No `periodLabel` field — the frontend uses the `label` from `computePeriods` directly, avoiding duplication.

### 3. `server.js` mount order

`/api/summary/by-range` must be mounted **before** the existing `/:year/:month` route so Express matches it first:

```js
app.use('/api/summary', require('./routes/summary-range'));
app.use('/api/summary', require('./routes/summary'));
```

---

## Frontend Changes (`public/app.js`)

### Period boundary calculation

New helper function `computePeriods(schedule, count = 6)` added near the top of the dashboard section. Returns an array of `count` period objects, newest first:

```js
[{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: 'D Mon – D Mon' }, ...]
```

**Per-frequency logic (all using today's date):**

| Frequency | Current period start | Period length | Step back |
|-----------|---------------------|---------------|-----------|
| `monthly` | Most recent `day_of_month` on or before today | Day before same day next month | −1 month |
| `four_weekly` | Walk anchor_date forward in 28-day steps until next step exceeds today | 27 days after start | −28 days |
| `weekly` | Most recent occurrence of anchor_date's weekday on or before today | 6 days after start | −7 days |

Edge case: if today is exactly the pay day, the new period starts today (inclusive).

### Module-level state

```js
let _payPeriodSettings = null; // { mode, primary_schedule_id, schedule? }
```

Loaded once on `pages.dashboard` alongside the existing summary/accounts/layout fetches. Cached for the session; cleared on logout alongside `invalidateAccounts()`.

### `pages.dashboard` changes

1. Fetch `GET /api/settings/pay-period` and `GET /api/income/schedules` in the initial `Promise.all` (alongside the existing summary, accounts, and layout fetches).
2. If `mode === 'pay_period'` and a valid `primary_schedule_id` is set:
   - Find the matching schedule in the fetched schedules list by ID.
   - Call `computePeriods(schedule, 6)` to get 6 period objects.
   - Fire 6 parallel `GET /api/summary/by-range` calls.
   - Use period[0] (current) for stat cards and donut.
   - Use all 6 for the bar chart (x-axis labels = period `label`, e.g. `"25 May"`).
3. If `mode === 'monthly'` or no primary schedule is set: existing monthly path unchanged.
4. If `mode === 'pay_period'` but no primary schedule is configured: render the dashboard in monthly mode with a prompt card: `"No primary schedule set — configure in Settings →"` (links to `pages.settings('personalisation')`).

### Header toggle

The dashboard header row gains a pill toggle:

```
Dashboard                    [Monthly] [Pay Period]   ← existing date label moves to stat sub-label
```

- Clicking a pill calls `POST /api/settings/pay-period` with the new mode, then re-renders the dashboard.
- The active pill is highlighted in the accent colour.
- The date context (previously a static month label) moves into the stat card sub-label when in pay period mode (e.g. "25 May – 24 Jun" under Remaining).

### Stat widget sub-labels

| Mode | Income sub-label | Spent sub-label | Remaining sub-label |
|------|-----------------|-----------------|---------------------|
| Monthly | "This month" | "X% of income" | "X% left" |
| Pay Period | "D Mon – D Mon" | "X% of income" | "X% left · D Mon – D Mon" |

### Bar chart

- Monthly mode: existing behaviour — 6 calendar months, x-axis = `"Jan"`, `"Feb"`, etc.
- Pay Period mode: 6 pay periods, x-axis = start date of each period formatted as `"25 May"`, `"25 Apr"`, etc.
- Chart title changes from `"Income vs Spending (6 months)"` to `"Income vs Spending (6 pay periods)"`.

### Donut chart

No structural change — already consumes `byCategory` from the summary response. In pay period mode it receives `byCategory` from the range endpoint instead.

### Calendar widget

- Monthly mode: existing `renderCalendar(year, month)` — no change.
- Pay Period mode: `renderCalendar` is called with the start year/month of the current period. The calendar header label updates to show the period range (`"25 May – 24 Jun"`) rather than just a month name.

### Settings → Personalisation tab

New "DASHBOARD VIEW" section added below the existing "APPEARANCE" divider:

1. **View mode toggle** — pill toggle: `Monthly` | `Pay Period`. Calls `POST /api/settings/pay-period` on change.
2. **Primary schedule picker** — `<select>` populated from `GET /api/income/schedules` (active schedules only), formatted as `"Name · frequency · anchor · £amount"`. Calls `POST /api/settings/pay-period` with `primary_schedule_id` on change.
   - If no active schedules exist, shows: `"No recurring income schedules set up yet. Set them up in Income →"`.
3. Both controls read their initial state from `GET /api/settings/pay-period` on tab load.

---

## Fallback Behaviour

| Situation | Behaviour |
|-----------|-----------|
| `dashboard_mode` absent | Treat as `"monthly"` |
| `primary_schedule_id` absent or null | Dashboard stays in monthly mode; prompt shown if mode is `pay_period` |
| Primary schedule deactivated | Same as absent — prompt shown |
| Schedule has no anchor / day_of_month | `computePeriods` returns null; dashboard falls back to monthly with prompt |

---

## What Does Not Change

- The Income page (one-off / recurring toggle, schedule list) — untouched.
- The Bills, Spending, Accounts, Transfers, Reports pages — untouched.
- The existing `GET /api/summary/:year/:month` endpoint — untouched.
- The calendar widget's bill/income pill rendering — untouched.
- The `monthlyTrend` field in the existing summary response — kept as-is for any future use.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `routes/settings.js` | Add `GET` + `POST /api/settings/pay-period` |
| Create | `routes/summary-range.js` | `GET /api/summary/by-range` |
| Modify | `server.js` | Mount `summary-range` before `summary` |
| Modify | `public/app.js` | `computePeriods()`, `_payPeriodSettings`, dashboard fetch + render, header toggle, stat labels, bar chart, Personalisation tab section |
| Modify | `package.json` | Bump version to `1.6.0` |

---

## Out of Scope

- Navigating to previous/future pay periods on the dashboard (only current period shown, same as monthly mode today).
- Pay period view on the Income, Bills, or Spending pages.
- Multiple simultaneous pay period views (one primary schedule at a time).
