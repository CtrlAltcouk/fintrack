const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testsDir = __dirname;
const testFiles = fs.readdirSync(testsDir)
  .filter(name => name.endsWith('.test.js'))
  .sort();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-unit-'));
let failed = false;

try {
  for (const testFile of testFiles) {
    const dbPath = path.join(tempDir, `${path.basename(testFile, '.test.js')}.db`);
    const result = spawnSync(process.execPath, [path.join(testsDir, testFile)], {
      env: { ...process.env, FINTRACK_DB_PATH: dbPath, OUTFLOW_TEST_PROCESS: '1' },
      encoding: 'utf8',
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) failed = true;
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
