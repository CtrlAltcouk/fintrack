const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const candidates = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
  : ['/bin/bash', '/usr/bin/bash'];
const bash = candidates.find(candidate => fs.existsSync(candidate));
if (!bash) {
  console.error('  ✗ deployment safety harness requires bash');
  process.exit(1);
}
const script = path.join(__dirname, 'deployment-safety.sh');
const args = process.platform === 'win32'
  ? ['-lc', 'bash "$1"', 'outflow-deployment-test', script]
  : [script];
const result = spawnSync(bash, args, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exitCode = 1;
