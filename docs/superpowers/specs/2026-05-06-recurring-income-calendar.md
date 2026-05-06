# FinTrack — Recurring Income & Dashboard Calendar

**Date:** 2026-05-06
**Version target:** 1.1.1
**Status:** Approved

---

## Overview

Two new features:

1. **Recurring income schedules** — users define weekly, 4-weekly, or monthly income sources (e.g. salary). Entries auto-generate and count toward monthly totals immediately. A toggle on the Add Income form switches between one-off and recurring.

2. **Dashboard calendar** — a full-month 7-column grid widget showing bill due dates (in category colour) and pay days (in green) as coloured pill events on each day cell.

---

## Feature 1: Recurring Income

### Database

New table `income_schedules`:

```sql
CREATE TABLE IF NOT EXISTS income_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  amount       REAL    NOT NULL,
  frequency    TEXT    NOT NULL CHECK(frequency IN ('weekly','four_weekly','monthly')),
  day_of_month INTEGER,          -- used when frequency = 'monthly' (1–31)
  anchor_date  TEXT,             -- used when frequency = 'weekly' or 'four_weekly' (YYYY-MM-DD)
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Existing `income` table is unchanged. Auto-generated entries land in `income` with `description` set to the schedule name and `source_schedule_id` set to the schedule's id (new nullable column on `income`):

```sql
ALTER TABLE income ADD COLUMN source_schedule_id INTEGER REFERENCES income_schedules(id);
```

This allows distinguishing auto-generated entries from manual ones (for display purposes) without changing any existing queries.

### Auto-generation logic

A helper function `ensureIncomeEntries(year, month)` runs on every `GET /api/income` and `GET /api/summary` request — same pattern as `ensureBillMonths()`.

For each active `income_schedules` row:

- **monthly**: insert one income entry on `day_of_month` of the requested month if none exists with that `source_schedule_id` for that month (clamped to last day of month if day_of_month > days in month).
- **weekly**: calculate all Fridays (or the weekday of `anchor_date`) in the requested month. Insert one entry per occurrence if none exists.
- **four_weekly**: from `anchor_date`, step forward in 28-day increments. Insert one entry for each occurrence that falls within the requested month if none exists.

Duplicate prevention uses: `SELECT COUNT(*) WHERE source_schedule_id = ? AND strftime('%Y-%m', date) = ?` for monthly, and `WHERE source_schedule_id = ? AND date = ?` for weekly/four_weekly.

### API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/income/schedules` | List all income schedules |
| POST | `/api/income/schedules` | Create a new schedule |
| PATCH | `/api/income/schedules/:id/deactivate` | Deactivate a schedule |

Existing `/api/income` GET route calls `ensureIncomeEntries` before querying.

### Income page UI

The "Add Income" form gains a **One-off / Recurring** toggle (radio buttons styled as a pill toggle).

**One-off mode** (default): unchanged — amount, description, date.

**Recurring mode**: shows:
- Name input (replaces description)
- Amount input
- Frequency select: `Weekly` | `Every 4 weeks` | `Specific day each month`
- If Weekly or Every 4 weeks: date picker labelled "First pay date" (sets `anchor_date`)
- If Monthly: number input labelled "Day of month" (1–31)

On submit in recurring mode: POST to `/api/income/schedules`.

Below the form, a **"Recurring Sources"** card lists active schedules:
- Name, amount, frequency summary (e.g. "Every 4 weeks from 2 May")
- Deactivate button (with confirmation)

---

## Feature 2: Dashboard Calendar

### API

New endpoint: `GET /api/calendar/:year/:month`

Returns a single object:

```json
{
  "events": [
    { "date": "2026-05-01", "type": "bill", "name": "Rent", "amount": 750, "colour": "#f7a4a2", "paid": 0 },
    { "date": "2026-05-06", "type": "income", "name": "Salary", "amount": 2400 },
    { "date": "2026-05-06", "type": "income_oneoff", "name": "Freelance", "amount": 150 }
  ]
}
```

Server-side logic:
- Calls `ensureBillMonths(year, month)` and `ensureIncomeEntries(year, month)` first so all entries exist
- Queries `bill_months JOIN bills JOIN categories` for the month — returns due day, name, amount, colour, paid status
- Queries `income` for the month — `source_schedule_id IS NOT NULL` entries become pay-day pills, `source_schedule_id IS NULL` entries become one-off income pills

### Dashboard widget

A new card below the charts in the Dashboard page. Replaces the existing bills panel (bill info is now visible in the calendar).

**Layout:**
- Header row: prev `◀` button, `Month Year` label, next `▶` button
- Day-of-week header row: Sun Mon Tue Wed Thu Fri Sat
- Day cells in a CSS `display:grid; grid-template-columns: repeat(7, 1fr)` grid
- Each day cell: date number, then stacked event pills

**Event pills:**
- Bill: background is a dark tint of the category colour, text is the category colour. Shows bill name + `£amount`. Paid bills shown at 50% opacity with a strikethrough on the amount.
- Pay day (schedule): green dark background, green text. Shows schedule name + `£amount`.
- One-off income: same green style, labelled differently.

**Day cell states:**
- Today: date number has a pink circle background
- Days from previous/next month: muted, greyed out, no events shown
- Days with no events: date number only, no pill rows

**Navigation:** Clicking ◀/▶ re-fetches `/api/calendar/:year/:month` and re-renders the widget. Defaults to current month.

---

## Version

`package.json` version bumped to `1.1.1` as part of this release.

---

## Out of Scope

- Editing auto-generated income entries (users can delete and re-add manually)
- Multiple income schedules of the same frequency on the same day
- Calendar click-through to add transactions
- Exporting calendar data
