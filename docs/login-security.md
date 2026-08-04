# Login brute-force protection

Outflow protects `POST /api/auth/login` with two persisted SQLite limits. The account bucket uses the trimmed, lower-case display name and allows 5 failures in 5 minutes or 10 failures in 15 minutes. The client-IP bucket allows 30 failures in 15 minutes. Reaching a limit starts a progressively longer cooldown, capped at one hour. A successful login clears that account's failure state; successful logins do not erase shared IP history.

The limiter stores only domain-separated SHA-256 bucket digests, counters, expiry timestamps, and short-lived in-flight claim IDs. It never stores passwords, raw display names, session tokens, request bodies, or financial data. Claims make the threshold atomic across concurrent requests and separate Node processes using the same SQLite database. Expired state is removed in bounded batches during login requests; no background timer is created.

Limiter tables are operational security state, not user data. They are excluded from JSON backup exports. Replace restore and administrator clear-all remove the state transactionally. Clear-my-data deliberately preserves it so that clearing financial data cannot bypass a login cooldown. Deleting an account or changing its password clears that account bucket. Process shutdown requires no limiter-specific work because there are no held connections, timers, workers, or file handles beyond the application database.

Display names are limited to 100 characters and passwords to 1,024 characters before password hashing or comparison. Unknown accounts use one fixed cost-10 bcrypt dummy hash, and both known and unknown credential failures return the same `401` body. Throttled requests return `429`, stable code `AUTH_RATE_LIMITED`, and `Retry-After` seconds without running bcrypt.

## Configuration

Defaults are appropriate for normal installations. Every value must be a positive integer within its documented bound; invalid values stop startup before the database is opened. The long account maximum/window cannot be below the short maximum/window, and the cooldown maximum cannot be below its base.

| Environment variable | Default | Maximum | Purpose |
| --- | ---: | ---: | --- |
| `OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX` | 5 | 1,000 | Account failures in the short window |
| `OUTFLOW_LOGIN_ACCOUNT_SHORT_WINDOW_SECONDS` | 300 | 86,400 | Short account window |
| `OUTFLOW_LOGIN_ACCOUNT_LONG_MAX` | 10 | 1,000 | Account failures in the broad window |
| `OUTFLOW_LOGIN_ACCOUNT_LONG_WINDOW_SECONDS` | 900 | 86,400 | Broad account window |
| `OUTFLOW_LOGIN_IP_MAX` | 30 | 10,000 | Failures allowed per client IP |
| `OUTFLOW_LOGIN_IP_WINDOW_SECONDS` | 900 | 86,400 | Client-IP window |
| `OUTFLOW_LOGIN_COOLDOWN_BASE_SECONDS` | 60 | 86,400 | Initial progressive cooldown |
| `OUTFLOW_LOGIN_COOLDOWN_MAX_SECONDS` | 3,600 | 604,800 | Progressive cooldown cap |
| `OUTFLOW_LOGIN_CLAIM_TTL_SECONDS` | 30 | 300 | Crash recovery time for in-flight claims |
| `OUTFLOW_LOGIN_MAX_USERNAME_LENGTH` | 100 | 1,024 | Maximum display-name characters accepted by authentication |
| `OUTFLOW_LOGIN_MAX_PASSWORD_LENGTH` | 1,024 | 16,384 | Maximum password characters accepted by authentication |

Client identity comes from the direct socket by default. `X-Forwarded-For` is considered only when `OUTFLOW_TRUST_PROXY_HOPS` is set to the exact bounded proxy-hop count. IPv4, IPv4-mapped IPv6, and equivalent IPv6 text forms are canonicalized before bucketing. Do not set broad proxy trust.
