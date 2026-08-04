const crypto = require('crypto');
const net = require('net');

const DEFAULTS = Object.freeze({
  accountShortMax: 5,
  accountShortWindowSeconds: 5 * 60,
  accountLongMax: 10,
  accountLongWindowSeconds: 15 * 60,
  ipMax: 30,
  ipWindowSeconds: 15 * 60,
  cooldownBaseSeconds: 60,
  cooldownMaxSeconds: 60 * 60,
  claimTtlSeconds: 30,
  maxUsernameLength: 100,
  maxPasswordLength: 1024,
});
const MAX_USERNAME_LENGTH = DEFAULTS.maxUsernameLength;
const MAX_PASSWORD_LENGTH = DEFAULTS.maxPasswordLength;
const KEY_DOMAIN = 'outflow-login-rate-limit-v1\0';

function parseInteger(value, name, defaultValue, { minimum = 1, maximum = 86400 } = {}) {
  if (value === undefined || value === '') return defaultValue;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function loadLoginSecurityConfig(env = process.env) {
  const config = {
    accountShortMax: parseInteger(env.OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX,
      'OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX', DEFAULTS.accountShortMax, { maximum: 1000 }),
    accountShortWindowSeconds: parseInteger(env.OUTFLOW_LOGIN_ACCOUNT_SHORT_WINDOW_SECONDS,
      'OUTFLOW_LOGIN_ACCOUNT_SHORT_WINDOW_SECONDS', DEFAULTS.accountShortWindowSeconds),
    accountLongMax: parseInteger(env.OUTFLOW_LOGIN_ACCOUNT_LONG_MAX,
      'OUTFLOW_LOGIN_ACCOUNT_LONG_MAX', DEFAULTS.accountLongMax, { maximum: 1000 }),
    accountLongWindowSeconds: parseInteger(env.OUTFLOW_LOGIN_ACCOUNT_LONG_WINDOW_SECONDS,
      'OUTFLOW_LOGIN_ACCOUNT_LONG_WINDOW_SECONDS', DEFAULTS.accountLongWindowSeconds),
    ipMax: parseInteger(env.OUTFLOW_LOGIN_IP_MAX,
      'OUTFLOW_LOGIN_IP_MAX', DEFAULTS.ipMax, { maximum: 10000 }),
    ipWindowSeconds: parseInteger(env.OUTFLOW_LOGIN_IP_WINDOW_SECONDS,
      'OUTFLOW_LOGIN_IP_WINDOW_SECONDS', DEFAULTS.ipWindowSeconds),
    cooldownBaseSeconds: parseInteger(env.OUTFLOW_LOGIN_COOLDOWN_BASE_SECONDS,
      'OUTFLOW_LOGIN_COOLDOWN_BASE_SECONDS', DEFAULTS.cooldownBaseSeconds),
    cooldownMaxSeconds: parseInteger(env.OUTFLOW_LOGIN_COOLDOWN_MAX_SECONDS,
      'OUTFLOW_LOGIN_COOLDOWN_MAX_SECONDS', DEFAULTS.cooldownMaxSeconds, { maximum: 7 * 86400 }),
    claimTtlSeconds: parseInteger(env.OUTFLOW_LOGIN_CLAIM_TTL_SECONDS,
      'OUTFLOW_LOGIN_CLAIM_TTL_SECONDS', DEFAULTS.claimTtlSeconds, { maximum: 300 }),
    maxUsernameLength: parseInteger(env.OUTFLOW_LOGIN_MAX_USERNAME_LENGTH,
      'OUTFLOW_LOGIN_MAX_USERNAME_LENGTH', DEFAULTS.maxUsernameLength, { minimum: 16, maximum: 1024 }),
    maxPasswordLength: parseInteger(env.OUTFLOW_LOGIN_MAX_PASSWORD_LENGTH,
      'OUTFLOW_LOGIN_MAX_PASSWORD_LENGTH', DEFAULTS.maxPasswordLength, { minimum: 64, maximum: 16384 }),
  };
  if (config.accountLongMax < config.accountShortMax) {
    throw new Error('OUTFLOW_LOGIN_ACCOUNT_LONG_MAX must be no less than OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX');
  }
  if (config.accountLongWindowSeconds < config.accountShortWindowSeconds) {
    throw new Error('OUTFLOW_LOGIN_ACCOUNT_LONG_WINDOW_SECONDS must be no less than OUTFLOW_LOGIN_ACCOUNT_SHORT_WINDOW_SECONDS');
  }
  if (config.cooldownMaxSeconds < config.cooldownBaseSeconds) {
    throw new Error('OUTFLOW_LOGIN_COOLDOWN_MAX_SECONDS must be no less than OUTFLOW_LOGIN_COOLDOWN_BASE_SECONDS');
  }
  return Object.freeze(config);
}

function normalizeLoginName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function canonicalIpv6(value) {
  const withoutZone = value.split('%')[0].toLowerCase();
  const halves = withoutZone.split('::');
  if (halves.length > 2) return null;
  const parseHalf = half => half ? half.split(':').map(part => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    return Number.parseInt(part, 16);
  }) : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (left.some(group => group === null) || right.some(group => group === null)) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
  if (groups.length !== 8) return null;

  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) { index += 1; continue; }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.map(group => group.toString(16)).join(':');
  const before = groups.slice(0, bestStart).map(group => group.toString(16)).join(':');
  const after = groups.slice(bestStart + bestLength).map(group => group.toString(16)).join(':');
  return `${before}::${after}`;
}

function normalizeIpAddress(value) {
  if (typeof value !== 'string') return 'unknown';
  let candidate = value.trim();
  if (candidate.startsWith('[') && candidate.includes(']')) candidate = candidate.slice(1, candidate.indexOf(']'));
  const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4 && net.isIP(mappedIpv4) === 4) return mappedIpv4;
  const version = net.isIP(candidate.split('%')[0]);
  if (version === 4) return candidate;
  if (version === 6) return canonicalIpv6(candidate) ?? 'unknown';
  return 'unknown';
}

function resolveClientIp(req, trustProxyHops = 0) {
  const direct = normalizeIpAddress(req.socket?.remoteAddress);
  if (!trustProxyHops) return direct;
  const trusted = normalizeIpAddress(req.ip);
  return trusted === 'unknown' ? direct : trusted;
}

function digestBucket(type, value) {
  return crypto.createHash('sha256').update(KEY_DOMAIN).update(type).update('\0').update(value).digest('hex');
}

function clearAccountRateLimit(database, displayName) {
  const key = digestBucket('account', normalizeLoginName(displayName));
  database.prepare(`DELETE FROM login_attempt_claims
    WHERE bucket_type = 'account' AND bucket_key = ?`).run(key);
  database.prepare(`DELETE FROM login_rate_limits
    WHERE bucket_type = 'account' AND bucket_key = ?`).run(key);
}

class LoginRateLimiter {
  constructor(database, config = loadLoginSecurityConfig(), { now = () => Date.now(), randomId = () => crypto.randomUUID() } = {}) {
    this.db = database;
    this.config = config;
    this.now = now;
    this.randomId = randomId;
  }

  cleanup(now) {
    this.db.prepare(`DELETE FROM login_attempt_claims WHERE id IN (
      SELECT id FROM login_attempt_claims WHERE expires_at <= ? ORDER BY expires_at LIMIT 200
    )`).run(now);
    this.db.prepare(`DELETE FROM login_rate_limits WHERE rowid IN (
      SELECT rowid FROM login_rate_limits
      WHERE expires_at <= ? AND cooldown_until <= ? ORDER BY expires_at LIMIT 200
    )`).run(now, now);
  }

  readState(type, key, now) {
    const row = this.db.prepare(`SELECT * FROM login_rate_limits
      WHERE bucket_type = ? AND bucket_key = ?`).get(type, key);
    const shortWindowMs = (type === 'account'
      ? this.config.accountShortWindowSeconds : this.config.ipWindowSeconds) * 1000;
    const longWindowMs = (type === 'account'
      ? this.config.accountLongWindowSeconds : this.config.ipWindowSeconds) * 1000;
    const state = row ?? {
      bucket_type: type, bucket_key: key,
      short_window_started_at: now, short_failures: 0,
      long_window_started_at: now, long_failures: 0,
      cooldown_level: 0, cooldown_until: 0,
    };
    if (now - state.short_window_started_at >= shortWindowMs) {
      state.short_window_started_at = now;
      state.short_failures = 0;
    }
    if (now - state.long_window_started_at >= longWindowMs) {
      state.long_window_started_at = now;
      state.long_failures = 0;
    }
    return state;
  }

  liveClaimCount(type, key, now) {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM login_attempt_claims
      WHERE bucket_type = ? AND bucket_key = ? AND expires_at > ?`).get(type, key, now).count;
  }

  threshold(state, claimCount = 0) {
    if (state.bucket_type === 'ip') {
      return state.long_failures + claimCount >= this.config.ipMax ? 'ip' : null;
    }
    if (state.long_failures + claimCount >= this.config.accountLongMax) return 'account_long';
    if (state.short_failures + claimCount >= this.config.accountShortMax) return 'account_short';
    return null;
  }

  activateCooldown(state, threshold, now) {
    if (state.cooldown_until > now) return state.cooldown_until;
    state.cooldown_level += 1;
    const progressiveMs = Math.min(
      this.config.cooldownMaxSeconds,
      this.config.cooldownBaseSeconds * (2 ** Math.max(0, state.cooldown_level - 1))
    ) * 1000;
    let windowUntil = now;
    if (threshold === 'account_short') {
      windowUntil = state.short_window_started_at + this.config.accountShortWindowSeconds * 1000;
    } else {
      const seconds = threshold === 'ip'
        ? this.config.ipWindowSeconds : this.config.accountLongWindowSeconds;
      windowUntil = state.long_window_started_at + seconds * 1000;
    }
    state.cooldown_until = Math.max(now + progressiveMs, windowUntil);
    return state.cooldown_until;
  }

  writeState(state, now) {
    const retentionMs = Math.max(
      this.config.cooldownMaxSeconds,
      this.config.accountLongWindowSeconds,
      this.config.ipWindowSeconds
    ) * 1000;
    this.db.prepare(`
      INSERT INTO login_rate_limits (
        bucket_type, bucket_key, short_window_started_at, short_failures,
        long_window_started_at, long_failures, cooldown_level, cooldown_until,
        expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_type, bucket_key) DO UPDATE SET
        short_window_started_at = excluded.short_window_started_at,
        short_failures = excluded.short_failures,
        long_window_started_at = excluded.long_window_started_at,
        long_failures = excluded.long_failures,
        cooldown_level = excluded.cooldown_level,
        cooldown_until = excluded.cooldown_until,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(
      state.bucket_type, state.bucket_key,
      state.short_window_started_at, state.short_failures,
      state.long_window_started_at, state.long_failures,
      state.cooldown_level, state.cooldown_until,
      Math.max(state.cooldown_until, now + retentionMs), now
    );
  }

  beginAttempt(normalizedName, clientIp) {
    const now = this.now();
    const accountKey = digestBucket('account', normalizedName);
    const ipKey = digestBucket('ip', clientIp);
    return this.db.transaction(() => {
      this.cleanup(now);
      const buckets = [
        this.readState('account', accountKey, now),
        this.readState('ip', ipKey, now),
      ];
      for (const state of buckets) {
        if (state.cooldown_until > now) {
          return { allowed: false, reason: state.bucket_type, retryAfter: Math.max(1, Math.ceil((state.cooldown_until - now) / 1000)) };
        }
        const claimCount = this.liveClaimCount(state.bucket_type, state.bucket_key, now);
        const threshold = this.threshold(state, claimCount);
        if (threshold) {
          if (!this.threshold(state)) {
            return { allowed: false, reason: state.bucket_type, retryAfter: this.config.claimTtlSeconds };
          }
          const until = this.activateCooldown(state, threshold, now);
          this.writeState(state, now);
          return { allowed: false, reason: state.bucket_type, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
        }
      }

      const id = this.randomId();
      const expiresAt = now + this.config.claimTtlSeconds * 1000;
      const insert = this.db.prepare(`INSERT INTO login_attempt_claims
        (id, bucket_type, bucket_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`);
      for (const state of buckets) insert.run(id, state.bucket_type, state.bucket_key, expiresAt, now);
      return { allowed: true, id, accountKey, ipKey };
    })();
  }

  completeAttempt(claim, succeeded) {
    const now = this.now();
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM login_attempt_claims WHERE id = ?').run(claim.id);
      if (succeeded) {
        this.db.prepare(`DELETE FROM login_rate_limits
          WHERE bucket_type = 'account' AND bucket_key = ?`).run(claim.accountKey);
        return { throttled: false };
      }

      let throttled = null;
      let retryAfter = 0;
      for (const [type, key] of [['account', claim.accountKey], ['ip', claim.ipKey]]) {
        const state = this.readState(type, key, now);
        state.short_failures += 1;
        state.long_failures += 1;
        const threshold = this.threshold(state);
        if (threshold && state.cooldown_until <= now) this.activateCooldown(state, threshold, now);
        this.writeState(state, now);
        if (state.cooldown_until > now && !throttled) {
          throttled = type;
          retryAfter = Math.max(1, Math.ceil((state.cooldown_until - now) / 1000));
        }
      }
      return { throttled: Boolean(throttled), reason: throttled, retryAfter };
    })();
  }

  clearAccount(displayName) {
    this.db.transaction(() => {
      clearAccountRateLimit(this.db, displayName);
    })();
  }
}

module.exports = {
  DEFAULTS,
  LoginRateLimiter,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  clearAccountRateLimit,
  digestBucket,
  loadLoginSecurityConfig,
  normalizeIpAddress,
  normalizeLoginName,
  resolveClientIp,
};
