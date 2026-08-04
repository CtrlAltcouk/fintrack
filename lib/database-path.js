const fs = require('fs');
const path = require('path');

function canonicalizeCandidate(candidate) {
  const resolved = path.resolve(candidate);
  let parent = path.dirname(resolved);
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  const canonicalParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
  return path.join(canonicalParent, path.relative(parent, resolved));
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveDatabasePath(env = process.env, projectDir = path.join(__dirname, '..')) {
  const outflowPath = env.OUTFLOW_DB_PATH?.trim();
  const legacyPath = env.FINTRACK_DB_PATH?.trim();
  if (outflowPath && legacyPath
      && canonicalizeCandidate(outflowPath) !== canonicalizeCandidate(legacyPath)) {
    throw new Error('OUTFLOW_DB_PATH and FINTRACK_DB_PATH identify different databases; refusing ambiguous configuration');
  }

  const configured = outflowPath || legacyPath;
  const production = env.NODE_ENV === 'production';
  if (production && !configured) {
    throw new Error('Production requires OUTFLOW_DB_PATH (or legacy FINTRACK_DB_PATH) outside application code');
  }
  const dbPath = canonicalizeCandidate(configured || path.join(projectDir, 'data', 'fintrack.db'));

  if (production) {
    const roots = [projectDir, env.OUTFLOW_APP_DIR].filter(Boolean).map(canonicalizeCandidate);
    if (roots.some(root => isWithin(dbPath, root))) {
      throw new Error(`Production database must be outside replaceable application code: ${dbPath}`);
    }
  }
  return dbPath;
}

module.exports = { canonicalizeCandidate, isWithin, resolveDatabasePath };
