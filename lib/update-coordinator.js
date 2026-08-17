const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { version } = require('../package.json');

const FULL_SHA = /^[0-9a-f]{40}$/i;
const FINAL_STATES = new Set(['succeeded', 'failed', 'rolled_back']);
const ACTIVE_STATES = new Set(['requested', 'in_progress']);
const SAFE_ERRORS = new Set(['update_failed', 'update_rolled_back']);

class UpdateError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 15000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function readJson(file, fileSystem = fs) {
  try {
    return JSON.parse(fileSystem.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function safeState(value) {
  if (!value || typeof value !== 'object') return null;
  const status = String(value.status || '');
  if (![...ACTIVE_STATES, ...FINAL_STATES].includes(status)) return null;
  return {
    status,
    target: FULL_SHA.test(value.target || '') ? value.target.toLowerCase() : null,
    current: FULL_SHA.test(value.current || '') ? value.current.toLowerCase() : null,
    requested_by: Number.isInteger(value.requested_by) ? value.requested_by : null,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : null,
    error: SAFE_ERRORS.has(value.error) ? value.error : null,
  };
}

function detectLayout({ fileSystem = fs, managedMarker, legacyRoot }) {
  const managed = fileSystem.existsSync(managedMarker);
  const legacy = fileSystem.existsSync(legacyRoot);
  if (managed && legacy) return 'conflict';
  if (managed) return 'managed';
  if (legacy) return 'legacy';
  return 'unmanaged';
}

function createUpdateCoordinator({
  appDir = path.join(__dirname, '..'),
  requestFile = process.env.OUTFLOW_UPDATE_REQUEST_FILE || '/var/lib/outflow-update/request/request.json',
  stateFile = process.env.OUTFLOW_UPDATE_STATE_FILE || '/var/lib/outflow-update/state/state.json',
  managedMarker = process.env.OUTFLOW_MANAGED_MARKER || '/opt/outflow/app/.outflow-installation',
  legacyRoot = process.env.OUTFLOW_LEGACY_ROOT || '/opt/fintrack',
  repositoryApi = 'https://api.github.com/repos/CtrlAltcouk/fintrack',
  fetchImpl = global.fetch,
  fileSystem = fs,
  git = runGit,
  now = () => new Date().toISOString(),
} = {}) {
  const checkedTargets = new Map();

  async function installed() {
    try {
      const [sha, message, date] = await Promise.all([
        git(['rev-parse', 'HEAD'], appDir),
        git(['log', '-1', '--format=%s'], appDir),
        git(['log', '-1', '--format=%cI'], appDir),
      ]);
      return { version, sha: FULL_SHA.test(sha) ? sha.toLowerCase() : null, hash: sha.slice(0, 7), message, date };
    } catch (_) {
      return { version, sha: null, hash: 'unknown', message: '', date: '' };
    }
  }

  async function githubCommit(ref) {
    if (!fetchImpl) throw new UpdateError('remote_unavailable', 'Could not reach GitHub.', 503);
    let response;
    try {
      response = await fetchImpl(`${repositoryApi}/commits/${encodeURIComponent(ref)}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Outflow-Updater' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (_) {
      throw new UpdateError('remote_unavailable', 'Could not reach GitHub.', 503);
    }
    if (!response.ok) throw new UpdateError('remote_unavailable', 'Could not reach GitHub.', 503);
    const body = await response.json();
    if (!FULL_SHA.test(body?.sha || '')) {
      throw new UpdateError('invalid_remote_response', 'GitHub returned invalid update metadata.', 502);
    }
    return {
      sha: body.sha.toLowerCase(),
      message: String(body.commit?.message || '').split('\n')[0].slice(0, 200),
    };
  }

  async function check(userId) {
    const [current, target] = await Promise.all([installed(), githubCommit('main')]);
    const requester = Number(userId);
    if (Number.isInteger(requester) && requester > 0) checkedTargets.set(requester, target.sha);
    return {
      current,
      target,
      upToDate: current.sha === target.sha,
      behind: current.sha === target.sha ? 0 : null,
      deployment: detectLayout({ fileSystem, managedMarker, legacyRoot }),
    };
  }

  async function verifyTarget(target) {
    if (!FULL_SHA.test(target || '')) {
      throw new UpdateError('invalid_target', 'A full 40-character commit SHA is required.');
    }
    const verified = await githubCommit(target.toLowerCase());
    if (verified.sha !== target.toLowerCase()) {
      throw new UpdateError('target_mismatch', 'The requested update target could not be verified.', 409);
    }
    return verified;
  }

  function status() {
    const stored = safeState(readJson(stateFile, fileSystem));
    if (stored && ACTIVE_STATES.has(stored.status)) return stored;
    if (fileSystem.existsSync(requestFile)) {
      const request = readJson(requestFile, fileSystem);
      return safeState({ ...request, status: 'requested' }) || { status: 'requested' };
    }
    if (fileSystem.existsSync(`${requestFile}.lock`)) return { status: 'requested' };
    return stored || { status: 'idle' };
  }

  async function request(target, userId) {
    const layout = detectLayout({ fileSystem, managedMarker, legacyRoot });
    if (layout === 'legacy') {
      throw new UpdateError(
        'legacy_deployment',
        'One-time deployment migration required. Migrate this legacy FinTrack installation to managed Outflow before enabling one-click updates.',
        409,
      );
    }
    if (layout !== 'managed') {
      throw new UpdateError('managed_deployment_required', 'One-click updates require a managed Outflow deployment.', 409);
    }
    const existing = status();
    if (ACTIVE_STATES.has(existing.status)) {
      throw new UpdateError('update_in_progress', 'An update is already in progress.', 409);
    }
    if (!FULL_SHA.test(target || '')) {
      throw new UpdateError('invalid_target', 'A full 40-character commit SHA is required.');
    }
    const requester = Number(userId);
    if (!Number.isInteger(requester) || requester < 1) {
      throw new UpdateError('invalid_requester', 'The update requester could not be verified.', 403);
    }
    if (checkedTargets.get(requester) !== target.toLowerCase()) {
      throw new UpdateError('target_not_checked', 'Check for updates again before installing this commit.', 409);
    }
    const verified = await verifyTarget(target);
    const current = await installed();
    if (!current.sha) {
      throw new UpdateError('installed_version_unknown', 'The installed commit could not be verified.', 409);
    }
    const payload = {
      status: 'requested',
      target: verified.sha,
      current: current.sha,
      requested_by: requester,
      updated_at: now(),
    };
    const guardFile = `${requestFile}.lock`;
    const temporaryFile = `${requestFile}.pending.${process.pid}.${crypto.randomUUID()}`;
    let guardDescriptor;
    let requestDescriptor;
    let ownsGuard = false;
    let handedOff = false;
    try {
      guardDescriptor = fileSystem.openSync(guardFile, 'wx', 0o600);
      ownsGuard = true;
      fileSystem.closeSync(guardDescriptor);
      guardDescriptor = undefined;
      requestDescriptor = fileSystem.openSync(temporaryFile, 'wx', 0o600);
      fileSystem.writeFileSync(requestDescriptor, `${JSON.stringify(payload)}\n`, 'utf8');
      if (typeof fileSystem.fsyncSync === 'function') fileSystem.fsyncSync(requestDescriptor);
      fileSystem.closeSync(requestDescriptor);
      requestDescriptor = undefined;
      fileSystem.renameSync(temporaryFile, requestFile);
      handedOff = true;
      checkedTargets.delete(requester);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new UpdateError('update_in_progress', 'An update is already in progress.', 409);
      }
      throw new UpdateError('update_unavailable', 'The managed update service is not available.', 503);
    } finally {
      if (guardDescriptor !== undefined) fileSystem.closeSync(guardDescriptor);
      if (requestDescriptor !== undefined) fileSystem.closeSync(requestDescriptor);
      if (fileSystem.existsSync(temporaryFile)) fileSystem.rmSync(temporaryFile, { force: true });
      if (ownsGuard && !handedOff && fileSystem.existsSync(guardFile)) fileSystem.rmSync(guardFile, { force: true });
    }
    return payload;
  }

  return { check, detectLayout: () => detectLayout({ fileSystem, managedMarker, legacyRoot }), installed, request, status, verifyTarget };
}

module.exports = {
  FULL_SHA,
  UpdateError,
  createUpdateCoordinator,
  detectLayout,
  safeState,
};
