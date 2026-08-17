const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createUpdateCoordinator, detectLayout, safeState,
} = require('../lib/update-coordinator');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.message}`); failed++; }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-update-coordinator-'));
  const managedMarker = path.join(root, 'managed', '.outflow-installation');
  const legacyRoot = path.join(root, 'legacy');
  const requestFile = path.join(root, 'spool', 'request.json');
  const stateFile = path.join(root, 'state', 'state.json');
  fs.mkdirSync(path.dirname(managedMarker), { recursive: true });
  fs.mkdirSync(path.dirname(requestFile), { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(managedMarker, 'managed');

  const currentSha = '1'.repeat(40);
  const firstTarget = '2'.repeat(40);
  const secondTarget = '3'.repeat(40);
  let mainTarget = firstTarget;
  const requestedRefs = [];
  const fetchImpl = async url => {
    const ref = decodeURIComponent(url.split('/').pop());
    requestedRefs.push(ref);
    const sha = ref === 'main' ? mainTarget : ref;
    return { ok: true, json: async () => ({ sha, commit: { message: `Commit ${sha.slice(0, 7)}\nbody` } }) };
  };
  const git = async args => {
    if (args[0] === 'rev-parse') return currentSha;
    if (args.includes('--format=%s')) return 'Current release';
    return '2026-08-16T00:00:00Z';
  };
  const make = overrides => createUpdateCoordinator({
    appDir: root, requestFile, stateFile, managedMarker, legacyRoot,
    fetchImpl, git, now: () => '2026-08-16T12:00:00.000Z', ...overrides,
  });

  try {
    await test('check returns an exact immutable SHA and reports an available update', async () => {
      const result = await make().check(7);
      assert.strictEqual(result.current.sha, currentSha);
      assert.strictEqual(result.target.sha, firstTarget);
      assert.strictEqual(result.upToDate, false);
      assert.strictEqual(result.behind, null);
      assert.strictEqual(result.deployment, 'managed');
    });

    await test('up-to-date and GitHub-unavailable checks are explicit', async () => {
      mainTarget = currentSha;
      assert.strictEqual((await make().check(7)).upToDate, true);
      const unavailable = make({ fetchImpl: async () => { throw new Error('offline'); } });
      await assert.rejects(unavailable.check(), error => error.code === 'remote_unavailable' && error.status === 503);
      mainTarget = firstTarget;
    });

    await test('the requested target stays pinned if remote main changes after Check', async () => {
      const coordinator = make();
      const checked = await coordinator.check(7);
      mainTarget = secondTarget;
      const result = await coordinator.request(checked.target.sha, 7);
      assert.strictEqual(result.target, firstTarget);
      assert.strictEqual(JSON.parse(fs.readFileSync(requestFile)).target, firstTarget);
      assert.deepStrictEqual(requestedRefs.slice(-2), ['main', firstTarget]);
    });

    await test('duplicate, malformed, and shell-injection update requests are rejected', async () => {
      await assert.rejects(make().request(secondTarget, 8), error => error.code === 'update_in_progress');
      fs.rmSync(requestFile);
      fs.rmSync(`${requestFile}.lock`);
      for (const value of ['main', 'a'.repeat(39), `${'a'.repeat(40)};id`, '$(touch /tmp/pwned)']) {
        await assert.rejects(make().request(value, 8), error => error.code === 'invalid_target');
      }
      await assert.rejects(make().request(secondTarget, 8), error => error.code === 'target_not_checked');
    });

    await test('simultaneous administrators can publish only one complete request', async () => {
      const first = make();
      const second = make();
      const [firstCheck, secondCheck] = await Promise.all([first.check(11), second.check(12)]);
      const results = await Promise.allSettled([
        first.request(firstCheck.target.sha, 11),
        second.request(secondCheck.target.sha, 12),
      ]);
      assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.strictEqual(results.filter(result => result.reason?.code === 'update_in_progress').length, 1);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(requestFile, 'utf8')));
      fs.rmSync(requestFile);
      fs.rmSync(`${requestFile}.lock`);
    });

    await test('legacy, conflicting, and unmanaged deployments never create an update request', async () => {
      fs.mkdirSync(legacyRoot);
      assert.strictEqual(detectLayout({ managedMarker, legacyRoot }), 'conflict');
      await assert.rejects(make().request(firstTarget, 7), error => error.code === 'managed_deployment_required');
      fs.rmSync(legacyRoot, { recursive: true });
      fs.rmSync(managedMarker);
      fs.mkdirSync(legacyRoot);
      assert.strictEqual(detectLayout({ managedMarker, legacyRoot }), 'legacy');
      await assert.rejects(make().request(firstTarget, 7), error => error.code === 'legacy_deployment');
      fs.rmSync(legacyRoot, { recursive: true });
      await assert.rejects(make().request(firstTarget, 7), error => error.code === 'managed_deployment_required');
      assert.strictEqual(fs.existsSync(requestFile), false);
    });

    await test('persistent status exposes only normalized reconnect state', () => {
      fs.writeFileSync(stateFile, JSON.stringify({
        status: 'rolled_back', target: firstTarget, current: currentSha,
        requested_by: 7, updated_at: '2026-08-16T12:01:00Z', error: 'update_rolled_back',
        shell_output: 'secret path',
      }));
      const state = make().status();
      assert.deepStrictEqual(state, safeState(JSON.parse(fs.readFileSync(stateFile))));
      assert.strictEqual('shell_output' in state, false);
      fs.writeFileSync(stateFile, JSON.stringify({
        status: 'failed', target: firstTarget, current: currentSha,
        requested_by: 7, updated_at: '2026-08-16T12:02:00Z', error: '/secret/path: command output',
      }));
      assert.strictEqual(make().status().error, null);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
