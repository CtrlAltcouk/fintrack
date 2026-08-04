const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

async function main() {
  const [sourceArg, destinationArg] = process.argv.slice(2);
  if (!sourceArg || !destinationArg) throw new Error('source and destination paths are required');
  const source = path.resolve(sourceArg);
  const destination = path.resolve(destinationArg);
  if (source === destination) throw new Error('backup destination must differ from source');
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('database does not exist');
  if (fs.existsSync(destination)) throw new Error('backup destination already exists');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
  if (!fs.statSync(destination).size) throw new Error('backup is empty');
  const backup = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = backup.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`backup integrity check failed: ${result}`);
  } finally { backup.close(); }
  fs.chmodSync(destination, 0o600);
  process.stdout.write(`${destination}\n`);
}

main().catch(error => {
  process.stderr.write(`[backup] ${error.message}\n`);
  process.exitCode = 1;
});
