const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { isShuttingDown, recurrenceRunner, server, shutdown } = require('../server');
const db = require('../db');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await test('liveness and readiness are distinct and ready after startup', async () => {
    let probeCatchUps = 0;
    const originalTriggerCatchUp = recurrenceRunner.triggerCatchUp;
    recurrenceRunner.triggerCatchUp = async () => { probeCatchUps += 1; };
    const health = await fetch(`${baseUrl}/api/health`);
    const ready = await fetch(`${baseUrl}/api/ready`);
    recurrenceRunner.triggerCatchUp = originalTriggerCatchUp;
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(await health.json(), { ok: true });
    assert.strictEqual(ready.status, 200);
    assert.deepStrictEqual(await ready.json(), { ok: true });
    assert.strictEqual(probeCatchUps, 0);
  });

  await test('graceful shutdown drains the listener and runner before closing SQLite', async () => {
    const termListeners = process.listenerCount('SIGTERM');
    const intListeners = process.listenerCount('SIGINT');
    await shutdown('lifecycle-test');
    assert.strictEqual(isShuttingDown(), true);
    assert.strictEqual(server.listening, false);
    assert.strictEqual(recurrenceRunner.timer, null);
    assert.strictEqual(recurrenceRunner.running, false);
    assert.strictEqual(db.open, false);
    assert.strictEqual(process.listenerCount('SIGTERM'), termListeners - 1);
    assert.strictEqual(process.listenerCount('SIGINT'), intListeners - 1);
  });

  await test('repeated shutdown requests share the completed lifecycle', async () => {
    await shutdown('repeated-test');
    assert.strictEqual(server.listening, false);
    assert.strictEqual(db.open, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
