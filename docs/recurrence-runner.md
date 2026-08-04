# Recurrence runner operations

The recurrence runner provides bounded, lifecycle-managed due-date execution for recurrence adapters that explicitly declare the `automatic-execution` capability. The Bill and Income adapters remain `projection-only`. Transaction and Transfer adapters opt into runner-managed occurrence scheduling and automatic execution.

## Lifecycle and scheduling

The HTTP server creates the runner only after runner configuration has been validated and database migrations have completed. Server startup performs one bounded batch. A single unreferenced interval performs later batches, and API requests may trigger a throttled batch. Server close stops the timer and waits for an in-flight batch through the runner's `stop()` method.

Only one batch can run within a process. SQLite occurrence uniqueness and short-lived claims prevent cooperating processes from executing the same occurrence concurrently. Work is selected by scheduled date and occurrence ID, oldest first, up to the configured batch size. Later runs continue the queue.

## Configuration

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `RECURRENCE_RUNNER_ENABLED` | `true` | Enables startup, timer, and request-triggered runs. |
| `RECURRENCE_RUNNER_INTERVAL_MS` | `60000` | Interval between scheduled batches. |
| `RECURRENCE_RUNNER_BATCH_SIZE` | `50` | Maximum occurrences considered per batch. |
| `RECURRENCE_RUNNER_REQUEST_THROTTLE_MS` | `15000` | Minimum delay between request-triggered attempts. |
| `RECURRENCE_RUNNER_RETRY_BASE_MS` | `60000` | First retry delay after an execution failure. |
| `RECURRENCE_RUNNER_RETRY_MAX_MS` | `3600000` | Maximum exponential retry delay. |
| `RECURRENCE_RUNNER_MAX_ATTEMPTS` | `5` | Automatic attempts allowed before manual retry is required. |

Invalid values stop startup before the database is opened. Tests should prefer `runOnce()` with a deterministic clock rather than real delays.

## Diagnostics and recovery

Authenticated administrators can inspect non-sensitive state with `GET /api/recurring/runner` and request a bounded run with `POST /api/recurring/runner/run`. The diagnostic response contains lifecycle state, last-run counts, and the next scheduled time; it contains no occurrence payloads or financial data.

Failures store only attempt timestamps, retry timing, and a sanitized error code. `POST /api/recurring/occurrences/:id/retry` resets an owned failed occurrence for another bounded attempt. Adapter implementations must keep destination insertion and occurrence completion inside the transaction supplied by the runner and must enforce a unique link to the occurrence.
