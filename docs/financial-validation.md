# Financial validation

Outflow stores money as SQLite `REAL` values for compatibility with existing databases. Version 8 does not round, clamp, or convert valid stored values to minor units.

## Accepted values

Money endpoints accept finite JSON numbers and undecorated decimal strings such as `12`, `12.50`, `-25.75`, and `.5`. They reject partial or decorated strings (`12junk`, `£10`, `10 GBP`), whitespace, booleans, arrays, objects, `null` when required, `NaN`, and infinities. Negative zero is stored and returned as zero.

The maximum absolute monetary value is **1,000,000,000,000** in the configured currency. Values are rejected rather than clamped. Outflow preserves the precision of accepted values; the normal UI continues to use a `0.01` step.

- Spending, income, bills, bill payments, transfers, and their recurrence templates require an amount greater than zero.
- Account opening balances may be positive, zero, or negative. Negative values continue to represent an account that starts overdrawn or owing money.
- A bill payment may be less than the bill amount (partial payment) or greater than it (overpayment). This preserves the existing ledger behaviour: the entered paid amount is the amount applied to the account balance. Zero and negative payments are invalid.
- Identifiers are positive safe integers.
- Recurrence intervals and occurrence counts are positive integers no greater than 10,000.

## Dates

Financial and recurrence dates use real date-only ISO calendar values in `YYYY-MM-DD` form. Timestamps, locale-formatted dates, and impossible dates such as `2026-02-30` are rejected. Date-only validation uses UTC calendar components and does not change recurrence timezone, leap-year, month-end, or daylight-saving behaviour. An end date must be on or after the first occurrence.

Bill payment dates remain server generated on the day payment is recorded. Clients cannot override them.

## API errors

Validation failures use the existing JSON response shape and do not include SQL or stack details:

```json
{
  "error": "amount must be greater than zero"
}
```

The backend is authoritative. Finance forms also apply compatible `min`, `max`, and `step` attributes, prevent a second submission while the first is pending, and show the normalized backend message when a request is rejected.

## Restore and migration behaviour

Backup restore validates finance values, identifiers, dates, recurrence bounds, ownership, occurrence destinations, transfer account relationships, foreign keys, and calculated balances before replacement can commit. Restore is transactional; any failure preserves the original database. Version 1 through Version 7 JSON backups remain supported, and session fields remain stripped.

Migration 8 audits existing rows before installing database validation triggers. It never rewrites questionable values. If an audit fails, startup stops before schema mutation and reports only the affected table, row identifier, and field, for example:

```text
Financial validation blocked by malformed legacy rows: transactions:42(amount)
```

Operator recovery:

1. Keep the original database and any existing migration backups unchanged.
2. Make a separate verified SQLite backup.
3. Inspect only the reported table and row IDs.
4. Correct the invalid value deliberately using its real financial meaning; do not delete history merely to pass migration.
5. Run `PRAGMA foreign_key_check` and restart Outflow.

For populated file-backed Version 7 databases, the migration creates a non-overwriting `pre-financial-constraints-v8` backup before installing triggers. A failed transaction leaves schema version 7 and all original rows intact.
