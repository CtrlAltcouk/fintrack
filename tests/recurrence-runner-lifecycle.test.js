const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const Database = require('better-sqlite3');

async function childProcess() {
  process.env.PORT = '0';
  const { recurrenceRunner, server } = require('../server');
  const db = require('../db');
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  while (!recurrenceRunner.started) await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.strictEqual(recurrenceRunner.started, true);
  assert.strictEqual(recurrenceRunner.timer.hasRef(), false);
  assert.strictEqual(recurrenceRunner.start(), false);
  await recurrenceRunner.inFlight;

  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(recurrenceRunner.started, false);
  assert.strictEqual(recurrenceRunner.timer, null);
  assert.strictEqual(recurrenceRunner.diagnostics().active, false);
  db.close();
  process.stdout.write('runner lifecycle child exited cleanly\n');
}

if (process.env.OUTFLOW_RUNNER_LIFECYCLE_CHILD === '1') {
  childProcess().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
} else {
  const result = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, OUTFLOW_RUNNER_LIFECYCLE_CHILD: '1' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(result.error, undefined, result.error?.message);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /runner lifecycle child exited cleanly/);

  const db = new Database(process.env.FINTRACK_DB_PATH, { readonly: true });
  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.strictEqual(db.prepare('SELECT active FROM recurrence_runner_state WHERE id = 1').get().active, 0);
  db.close();
  console.log('  \u2713 server starts the runner after migration, owns one unreferenced timer, and stops it on close');

  const invalidDbPath = `${process.env.FINTRACK_DB_PATH}.invalid-config`;
  const invalid = spawnSync(process.execPath, ['server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      FINTRACK_DB_PATH: invalidDbPath,
      RECURRENCE_RUNNER_BATCH_SIZE: 'not-a-number',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notStrictEqual(invalid.status, 0);
  assert.match(invalid.stderr, /RECURRENCE_RUNNER_BATCH_SIZE/);
  assert.strictEqual(fs.existsSync(invalidDbPath), false);
  console.log('  \u2713 invalid runner configuration fails before opening or migrating the database');
  console.log('\n2 passed, 0 failed');
}
