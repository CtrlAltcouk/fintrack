const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-e2e-'));
process.env.FINTRACK_DB_PATH = path.join(tempDir, 'fintrack-e2e.db');
process.env.PORT = process.env.PORT || '3100';

const cleanup = () => {
  try {
    require('../../../db').close();
  } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
};

process.once('exit', cleanup);
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));

require('../../../server');
