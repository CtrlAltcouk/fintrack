# Daily Spending — Pay Period Mode

**Date:** 2026-06-04  
**Status:** Approved  
**Version target:** 1.7.0

---

## Goal

When a user has Pay Period mode enabled in Settings → Personalisation, the Daily Spending page should show transactions scoped to the current pay period rather than the calendar month, with ◀ Period ▶ navigation to step through past and future periods.

---

## Behaviour

### Monthly mode (unchanged)
- `pages.spending(year, month, categoryId, accountId)` — existing signature, existing behaviour.
- Month navigation, transactions fetched via `/api/transactions?year=Y&month=M`.

### Pay Period mode (new)
- Activated automatically when `dashboard_mode === 'pay_period'` in the user's settings.
- `pages.spending` reads pay period settings (`GET /api/settings/pay-period`) at load time alongside categories, accounts, and schedules.
- Calls `computePeriods(schedule, 8)` to produce a window of periods (newest-first).
- A `periodIndex` param (default `0` = current/newest period, `1` = one period back, etc.) controls which period is displayed.
- Transactions fetched via `/api/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Navigation buttons call `pages.spending(null, null, categoryId, accountId, periodIndex ± 1)`.
- Period nav is capped: cannot go below index 0 (current) or beyond the last computed period.
- The month label is replaced with the period's `label` from `computePeriods` (e.g. `"14 May – 10 Jun"`).

### No primary schedule banner
- If `dashboard_mode === 'pay_period'` but no valid `primary_schedule_id` is set, the page renders a banner (same style as the dashboard's `noPrimaryBanner`) prompting the user to set a primary schedule in Settings → Personalisation.
- The transaction list and nav are not rendered in this state.

---

## Backend change — `routes/transactions.js`

Add `from` / `to` query params as an alternative filter to `year` + `month`:

```
GET /api/transactions?from=2026-05-14&to=2026-06-10
```

SQL clause (when `from` and `to` are present):
```sql
AND t.date >= ? AND t.date <= ?
```

- `year`/`month` filtering is untouched.
- `from`/`to` and `year`/`month` are mutually exclusive; `from`/`to` takes precedence if all four are supplied.
- Export a `_parseTransactionQuery(query)` helper for testability (mirrors pattern in `summary-range.js`).

---

## Frontend change — `pages.spending` in `public/app.js`

### Signature change
```js
pages.spending = async function (year, month, categoryId = null, accountId = null, periodIndex = 0)
```

`year` and `month` are `null` in pay period mode (period boundaries come from `computePeriods`).

### Load sequence (pay period mode)
1. Fetch in parallel: `GET /api/settings/pay-period`, categories, accounts, schedules.
2. If `dashboard_mode !== 'pay_period'` → fall through to existing monthly render.
3. If no valid `primary_schedule_id` → render banner only.
4. Find schedule in schedules list by `primary_schedule_id`.
5. Call `computePeriods(schedule, 8)` → periods array (newest-first, index 0 = current).
6. Selected period = `periods[periodIndex]`.
7. Fetch `/api/transactions?from=period.from&to=period.to&...`.
8. Render grouped list with period label nav.

### Navigation
```
◀  14 May – 10 Jun  ▶
```
- ◀ disabled when `periodIndex >= periods.length - 1`
- ▶ disabled when `periodIndex === 0`

---

## Testing — `tests/transactions-query.test.js`

Export `_parseTransactionQuery(query)` from `routes/transactions.js`.  
~6 unit tests:

| # | Input | Expected |
|---|-------|----------|
| 1 | `{ from: '2026-05-14', to: '2026-06-10' }` | `{ mode: 'range', from: '2026-05-14', to: '2026-06-10' }` |
| 2 | `{ year: '2026', month: '5' }` | `{ mode: 'month', year: '2026', month: '05' }` |
| 3 | `{ from: '2026-05-14' }` (missing `to`) | falls back to no date filter |
| 4 | `{ to: '2026-06-10' }` (missing `from`) | falls back to no date filter |
| 5 | `{ from: '2026-05-14', to: '2026-06-10', year: '2026', month: '5' }` | range wins |
| 6 | `{}` (no params) | no date filter |

---

## Files changed

| File | Change |
|------|--------|
| `routes/transactions.js` | Add `from`/`to` query support + export `_parseTransactionQuery` |
| `public/app.js` | Update `pages.spending` signature + pay period render path |
| `tests/transactions-query.test.js` | New — 6 unit tests |

No schema changes. No new routes. No new settings keys.
