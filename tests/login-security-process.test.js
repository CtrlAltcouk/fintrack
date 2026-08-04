const assert = require('assert');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { LoginRateLimiter } = require('../lib/login-security');

const migrated = require('../db');
migrated.close();

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function runClaimChild() {
  const code = `
    const Database = require('better-sqlite3');
    const { LoginRateLimiter } = require('./lib/login-security');
    const db = new Database(process.env.FINTRACK_DB_PATH);
    db.pragma('busy_timeout = 5000');
    const limiter = new LoginRateLimiter(db);
    const result = limiter.beginAttempt('multi-process-account', '192.0.2.90');
    process.stdout.write(JSON.stringify(result));
    db.close();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: require('path').join(__dirname, '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', codeValue => {
      if (codeValue !== 0) return reject(new Error(stderr || `claim child exited ${codeValue}`));
      try { return resolve(JSON.parse(stdout)); }
      catch (error) { return reject(new Error(`invalid child output: ${stdout}\n${stderr}\n${error.message}`)); }
    });
  });
}

(async () => {
  await test('separate Node processes share atomic in-flight thresholds', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, runClaimChild));
    assert.strictEqual(results.filter(result => result.allowed).length, 5);
    assert.strictEqual(results.filter(result => !result.allowed).length, 1);
    const db = new Database(process.env.FINTRACK_DB_PATH);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_attempt_claims').get().count, 10);
    assert.strictEqual(new LoginRateLimiter(db).beginAttempt('multi-process-account', '192.0.2.91').allowed, false);
    db.exec('DELETE FROM login_attempt_claims; DELETE FROM login_rate_limits;');
    db.close();
  });

  await test('failed-attempt and cooldown state survives a database restart', async () => {
    const config = {
      accountShortMax: 2, accountShortWindowSeconds: 60,
      accountLongMax: 4, accountLongWindowSeconds: 300,
      ipMax: 20, ipWindowSeconds: 300,
      cooldownBaseSeconds: 10, cooldownMaxSeconds: 60, claimTtlSeconds: 5,
    };
    let db = new Database(process.env.FINTRACK_DB_PATH);
    db.pragma('busy_timeout = 5000');
    let limiter = new LoginRateLimiter(db, config);
    for (let index = 0; index < 2; index += 1) {
      const claim = limiter.beginAttempt('restart-account', '198.51.100.50');
      assert.strictEqual(claim.allowed, true);
      limiter.completeAttempt(claim, false);
    }
    db.close();

    db = new Database(process.env.FINTRACK_DB_PATH);
    db.pragma('busy_timeout = 5000');
    limiter = new LoginRateLimiter(db, config);
    const blocked = limiter.beginAttempt('restart-account', '198.51.100.51');
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.reason, 'account');
    db.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
