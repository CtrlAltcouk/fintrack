const assert = require('assert');
const Database = require('better-sqlite3');
const {
  DEFAULTS, LoginRateLimiter, loadLoginSecurityConfig,
  normalizeIpAddress, normalizeLoginName, resolveClientIp,
} = require('../lib/login-security');
const { migrateLoginSecurityV9 } = require('../db-migrations');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now'))
  ); PRAGMA user_version = 8;`);
  migrateLoginSecurityV9(db);
  return db;
}

function config(overrides = {}) {
  return Object.freeze({
    ...DEFAULTS,
    accountShortMax: 3,
    accountShortWindowSeconds: 60,
    accountLongMax: 5,
    accountLongWindowSeconds: 300,
    ipMax: 10,
    ipWindowSeconds: 300,
    cooldownBaseSeconds: 10,
    cooldownMaxSeconds: 60,
    claimTtlSeconds: 5,
    ...overrides,
  });
}

function failAttempt(limiter, name = 'Person', ip = '192.0.2.1') {
  const claim = limiter.beginAttempt(normalizeLoginName(name), ip);
  if (!claim.allowed) return claim;
  return { ...limiter.completeAttempt(claim, false), allowed: true };
}

test('configuration defaults and strict relationships are bounded', () => {
  assert.deepStrictEqual(loadLoginSecurityConfig({}), DEFAULTS);
  assert.strictEqual(loadLoginSecurityConfig({ OUTFLOW_LOGIN_IP_MAX: '40' }).ipMax, 40);
  assert.strictEqual(loadLoginSecurityConfig({ OUTFLOW_LOGIN_MAX_PASSWORD_LENGTH: '2048' }).maxPasswordLength, 2048);
  for (const env of [
    { OUTFLOW_LOGIN_IP_MAX: '0' },
    { OUTFLOW_LOGIN_IP_MAX: 'many' },
    { OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX: '20', OUTFLOW_LOGIN_ACCOUNT_LONG_MAX: '10' },
    { OUTFLOW_LOGIN_ACCOUNT_SHORT_WINDOW_SECONDS: '901', OUTFLOW_LOGIN_ACCOUNT_LONG_WINDOW_SECONDS: '900' },
    { OUTFLOW_LOGIN_COOLDOWN_BASE_SECONDS: '61', OUTFLOW_LOGIN_COOLDOWN_MAX_SECONDS: '60' },
    { OUTFLOW_LOGIN_MAX_USERNAME_LENGTH: '15' },
    { OUTFLOW_LOGIN_MAX_PASSWORD_LENGTH: '63' },
  ]) assert.throws(() => loadLoginSecurityConfig(env), /OUTFLOW_LOGIN_/);
});

test('usernames and equivalent IP forms normalize to stable limiter identities', () => {
  assert.strictEqual(normalizeLoginName('  ALIce  '), 'alice');
  assert.strictEqual(normalizeIpAddress('::ffff:192.0.2.4'), '192.0.2.4');
  assert.strictEqual(normalizeIpAddress('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.strictEqual(normalizeIpAddress('2001:db8::1'), '2001:db8::1');
  assert.strictEqual(resolveClientIp({ socket: { remoteAddress: '127.0.0.1' }, ip: '198.51.100.4' }, 0), '127.0.0.1');
  assert.strictEqual(resolveClientIp({ socket: { remoteAddress: '127.0.0.1' }, ip: '198.51.100.4' }, 1), '198.51.100.4');
});

test('account thresholds, case variants, success reset, and expiry are deterministic', () => {
  const db = database();
  let now = 1_000_000;
  const limiter = new LoginRateLimiter(db, config(), {
    now: () => now,
    randomId: (() => { let id = 0; return () => `claim-${String(++id).padStart(16, '0')}`; })(),
  });
  assert.strictEqual(failAttempt(limiter, 'Alice').throttled, false);
  assert.strictEqual(failAttempt(limiter, ' alice ').throttled, false);
  const threshold = failAttempt(limiter, 'ALICE');
  assert.strictEqual(threshold.throttled, true);
  assert.strictEqual(threshold.reason, 'account');
  assert.strictEqual(limiter.beginAttempt('alice', '192.0.2.2').allowed, false);

  now += 61_000;
  const success = limiter.beginAttempt('alice', '192.0.2.2');
  assert.strictEqual(success.allowed, true);
  limiter.completeAttempt(success, true);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM login_rate_limits
    WHERE bucket_type = 'account'`).get().count, 0);
  assert.strictEqual(limiter.beginAttempt('alice', '192.0.2.2').allowed, true);
  db.close();
});

test('shared IP failures cannot be evaded by rotating account names', () => {
  const db = database();
  let now = 2_000_000;
  const limiter = new LoginRateLimiter(db, config({ ipMax: 4 }), {
    now: () => now,
    randomId: (() => { let id = 0; return () => `claim-${String(++id).padStart(16, '0')}`; })(),
  });
  for (let index = 0; index < 3; index += 1) {
    assert.strictEqual(failAttempt(limiter, `person-${index}`, '203.0.113.8').throttled, false);
  }
  const threshold = failAttempt(limiter, 'another-person', '203.0.113.8');
  assert.strictEqual(threshold.throttled, true);
  assert.strictEqual(threshold.reason, 'ip');
  assert.strictEqual(limiter.beginAttempt('fresh-account', '203.0.113.8').allowed, false);
  now += 301_000;
  assert.strictEqual(limiter.beginAttempt('fresh-account', '203.0.113.8').allowed, true);
  db.close();
});

test('in-flight claims enforce the threshold before password work and expire after crashes', () => {
  const db = database();
  let now = 3_000_000;
  const limiter = new LoginRateLimiter(db, config(), {
    now: () => now,
    randomId: (() => { let id = 0; return () => `claim-${String(++id).padStart(16, '0')}`; })(),
  });
  const claims = Array.from({ length: 3 }, () => limiter.beginAttempt('concurrent', '198.51.100.7'));
  assert.ok(claims.every(claim => claim.allowed));
  assert.strictEqual(limiter.beginAttempt('concurrent', '198.51.100.9').allowed, false);
  now += 6_000;
  assert.strictEqual(limiter.beginAttempt('concurrent', '198.51.100.9').allowed, true);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_attempt_claims WHERE expires_at <= ?').get(now).count, 0);
  db.close();
});

test('failure accounting is atomic across account and IP buckets', () => {
  const db = database();
  const limiter = new LoginRateLimiter(db, config());
  const claim = limiter.beginAttempt('atomic-account', '203.0.113.44');
  db.exec(`CREATE TRIGGER fail_ip_limiter_insert BEFORE INSERT ON login_rate_limits
    WHEN NEW.bucket_type = 'ip' BEGIN SELECT RAISE(ABORT, 'injected limiter failure'); END;`);
  assert.throws(() => limiter.completeAttempt(claim, false), /injected limiter failure/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_rate_limits').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_attempt_claims').get().count, 2);
  db.close();
});

test('repeated account thresholds increase cooldowns up to the configured cap', () => {
  const db = database();
  let now = 4_000_000;
  const limiter = new LoginRateLimiter(db, config({
    accountShortMax: 2, accountShortWindowSeconds: 10,
    accountLongMax: 4, accountLongWindowSeconds: 30,
    cooldownBaseSeconds: 20, cooldownMaxSeconds: 60,
  }), { now: () => now });
  assert.strictEqual(failAttempt(limiter, 'progressive').throttled, false);
  const first = failAttempt(limiter, 'progressive');
  assert.strictEqual(first.throttled, true);
  assert.strictEqual(first.retryAfter, 20);
  now += 21_000;
  assert.strictEqual(failAttempt(limiter, 'progressive').throttled, false);
  const second = failAttempt(limiter, 'progressive');
  assert.strictEqual(second.throttled, true);
  assert.strictEqual(second.retryAfter, 40);
  const state = db.prepare(`SELECT cooldown_level FROM login_rate_limits
    WHERE bucket_type = 'account'`).get();
  assert.strictEqual(state.cooldown_level, 2);
  db.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
