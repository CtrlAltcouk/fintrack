const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveDatabasePath } = require('../lib/database-path');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.stack}`); process.exitCode = 1; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-db-path-'));
try {
  const app = path.join(root, 'opt', 'outflow', 'release');
  const data = path.join(root, 'var', 'lib', 'outflow', 'outflow.db');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(path.dirname(data), { recursive: true });

  test('development retains the repository-local default', () => {
    assert.equal(resolveDatabasePath({}, app), path.join(app, 'data', 'fintrack.db'));
  });
  test('production requires an explicit persistent path', () => {
    assert.throws(() => resolveDatabasePath({ NODE_ENV: 'production' }, app), /requires OUTFLOW_DB_PATH/);
  });
  test('production accepts OUTFLOW_DB_PATH outside application code', () => {
    assert.equal(resolveDatabasePath({ NODE_ENV: 'production', OUTFLOW_DB_PATH: data }, app), data);
  });
  test('FINTRACK_DB_PATH remains a backwards-compatible alias', () => {
    assert.equal(resolveDatabasePath({ NODE_ENV: 'production', FINTRACK_DB_PATH: data }, app), data);
  });
  test('conflicting database aliases fail safely', () => {
    assert.throws(() => resolveDatabasePath({
      NODE_ENV: 'production', OUTFLOW_DB_PATH: data, FINTRACK_DB_PATH: `${data}.other`,
    }, app), /ambiguous configuration/);
  });
  test('production rejects a database inside the release checkout', () => {
    assert.throws(() => resolveDatabasePath({
      NODE_ENV: 'production', OUTFLOW_DB_PATH: path.join(app, 'data', 'outflow.db'),
    }, app), /outside replaceable application code/);
  });
  test('OUTFLOW_APP_DIR also protects the stable application link', () => {
    const linkedApp = path.join(root, 'opt', 'outflow', 'app');
    fs.mkdirSync(linkedApp, { recursive: true });
    assert.throws(() => resolveDatabasePath({
      NODE_ENV: 'production', OUTFLOW_DB_PATH: path.join(linkedApp, 'outflow.db'),
      OUTFLOW_APP_DIR: linkedApp,
    }, app), /outside replaceable application code/);
  });
  test('test processes refuse repository-local database paths before opening them', () => {
    const repositoryDatabase = path.join(__dirname, '..', 'data', 'test-guard.db');
    assert.strictEqual(fs.existsSync(repositoryDatabase), false);
    const result = spawnSync(process.execPath, ['-e', "require('./db')"], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        OUTFLOW_TEST_PROCESS: '1',
        FINTRACK_DB_PATH: repositoryDatabase,
        OUTFLOW_DB_PATH: '',
      },
      encoding: 'utf8',
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Tests require an isolated temporary database/);
    assert.strictEqual(fs.existsSync(repositoryDatabase), false);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${process.exitCode ? 1 : 0} failed`);
