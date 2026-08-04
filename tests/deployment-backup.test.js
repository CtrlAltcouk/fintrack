const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.stack}`); process.exitCode = 1; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-deploy-backup-'));
const source = path.join(root, 'outflow.db');
const destination = path.join(root, 'backups', 'before-update.db');
const helper = path.join(__dirname, '..', 'scripts', 'sqlite-backup.js');
try {
  const db = new Database(source);
  db.exec('CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES (\'preserved\')');
  db.close();

  const first = spawnSync(process.execPath, [helper, source, destination], { encoding: 'utf8' });
  test('deployment backup helper creates a non-empty snapshot', () => {
    assert.equal(first.status, 0, first.stderr);
    assert.ok(fs.statSync(destination).size > 0);
  });
  test('deployment backup contains the committed database data', () => {
    const backup = new Database(destination, { readonly: true });
    try { assert.equal(backup.prepare('SELECT value FROM sentinel').get().value, 'preserved'); }
    finally { backup.close(); }
  });
  test('deployment backup passes SQLite integrity validation', () => {
    const backup = new Database(destination, { readonly: true });
    try { assert.equal(backup.pragma('quick_check', { simple: true }), 'ok'); }
    finally { backup.close(); }
  });
  test('deployment backup never overwrites an existing destination', () => {
    const before = fs.readFileSync(destination);
    const second = spawnSync(process.execPath, [helper, source, destination], { encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.deepEqual(fs.readFileSync(destination), before);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${process.exitCode ? 1 : 0} failed`);
