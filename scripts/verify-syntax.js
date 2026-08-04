const { readdirSync } = require('fs');
const { join, relative } = require('path');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');
const ignoredDirectories = new Set([
  '.git',
  '.tmp',
  'backups',
  'coverage',
  'data',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function findJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : findJavaScriptFiles(join(directory, entry.name));
    }
    return entry.isFile() && entry.name.endsWith('.js')
      ? [join(directory, entry.name)]
      : [];
  });
}

const files = findJavaScriptFiles(root).sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax check failed: ${relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
