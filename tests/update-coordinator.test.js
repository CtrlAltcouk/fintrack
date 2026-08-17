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
  const currentSha = '1'.repeat(40);
  const firstTarget = '2'.repeat(40);
  const secondTarget = '3'.repeat(40);
  const releasesRoot = path.join(root, 'releases');
  const releaseDir = path.join(releasesRoot, currentSha);
  const managedMarker = path.join(releaseDir, '.outflow-installation');
  const metadataFile = path.join(releaseDir, '.outflow-release.json');
  const legacyRoot = path.join(root, 'legacy');
  const requestFile = path.join(root, 'spool', 'request.json');
  const stateFile = path.join(root, 'state', 'state.json');
  fs.mkdirSync(path.dirname(managedMarker), { recursive: true });
  fs.mkdirSync(path.dirname(requestFile), { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(managedMarker, 'managed');
  fs.chmodSync(releaseDir, 0o750);

  const writeMetadata = (overrides = {}, mode = 0o640) => {
    fs.writeFileSync(metadataFile, JSON.stringify({
      sha: currentSha,
      version: '2.3.0',
      message: 'Installed release',
      date: '2026-08-16T00:00:00Z',
      ...overrides,
    }));
    fs.chmodSync(metadataFile, mode);
  };
  writeMetadata();
  const serviceUid = 1000;
  const statView = (stat, mode, uid) => new Proxy(stat, {
    get(target, property) {
      if (property === 'mode') return (target.mode & ~0o777) | mode;
      if (property === 'uid') return uid;
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const trustFileSystem = ({ releaseMode = 0o750, metadataMode = 0o640, metadataUid = 0 } = {}) => {
    const view = Object.create(fs);
    view.lstatSync = candidate => {
      const stat = fs.lstatSync(candidate);
      if (path.resolve(candidate) === path.resolve(releaseDir)) return statView(stat, releaseMode, 0);
      if (path.resolve(candidate) === path.resolve(metadataFile)) return statView(stat, metadataMode, metadataUid);
      return statView(stat, 0o640, 0);
    };
    view.fstatSync = descriptor => statView(fs.fstatSync(descriptor), metadataMode, metadataUid);
    return view;
  };
  let mainTarget = firstTarget;
  const requestedRefs = [];
  const gitCalls = [];
  const fetchImpl = async url => {
    const ref = decodeURIComponent(url.split('/').pop());
    requestedRefs.push(ref);
    const sha = ref === 'main' ? mainTarget : ref;
    return { ok: true, json: async () => ({ sha, commit: { message: `Commit ${sha.slice(0, 7)}\nbody` } }) };
  };
  const git = async (args, cwd) => {
    gitCalls.push({ args: [...args], cwd });
    if (args.includes('rev-parse')) return currentSha;
    if (args.includes('--format=%s')) return 'Current release';
    return '2026-08-16T00:00:00Z';
  };
  const make = overrides => createUpdateCoordinator({
    appDir: releaseDir, requestFile, stateFile, managedMarker, releasesRoot, legacyRoot,
    fetchImpl, git, fileSystem: trustFileSystem(), serviceUid,
    now: () => '2026-08-16T12:00:00.000Z', ...overrides,
  });

  try {
    await test('root-owned release metadata is the primary exact installed identity', async () => {
      gitCalls.length = 0;
      const installed = await make().installed();
      assert.deepStrictEqual(installed, {
        version: '2.3.0', sha: currentSha, hash: currentSha.slice(0, 7),
        message: 'Installed release', date: '2026-08-16T00:00:00Z',
      });
      assert.deepStrictEqual(gitCalls, []);
    });

    await test('check displays the exact current SHA and reports an available update', async () => {
      const result = await make().check(7);
      assert.strictEqual(result.current.sha, currentSha);
      assert.strictEqual(result.current.version, '2.3.0');
      assert.strictEqual(result.current.message, 'Installed release');
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

    await test('malformed, truncated, writable, and service-owned metadata are rejected without Git fallback', async () => {
      const invalidValues = [
        '{',
        JSON.stringify({ sha: 'a'.repeat(39), version: '2.3.0', message: '', date: '' }),
        JSON.stringify({ sha: currentSha, version: '2.3.0', message: 'line one\nline two', date: '' }),
      ];
      for (const value of invalidValues) {
        fs.writeFileSync(metadataFile, value);
        fs.chmodSync(metadataFile, 0o640);
        gitCalls.length = 0;
        assert.strictEqual((await make().installed()).sha, null);
        assert.deepStrictEqual(gitCalls, []);
      }
      writeMetadata();
      gitCalls.length = 0;
      assert.strictEqual((await make({ fileSystem: trustFileSystem({ metadataMode: 0o660 }) }).installed()).sha, null);
      assert.deepStrictEqual(gitCalls, []);
      writeMetadata();
      assert.strictEqual((await make({ fileSystem: trustFileSystem({ metadataUid: serviceUid }) }).installed()).sha, null);
      writeMetadata();
      const hardlink = path.join(releaseDir, 'linked-release-metadata.json');
      fs.linkSync(metadataFile, hardlink);
      assert.strictEqual((await make().installed()).sha, null);
      fs.rmSync(hardlink);
    });

    await test('a symlink metadata attack is rejected before the file is opened', async () => {
      const symlinkFs = trustFileSystem();
      const trustedLstat = symlinkFs.lstatSync;
      symlinkFs.lstatSync = candidate => {
        const stat = trustedLstat(candidate);
        if (path.resolve(candidate) !== path.resolve(metadataFile)) return stat;
        return new Proxy(stat, {
          get(target, property) {
            if (property === 'isSymbolicLink') return () => true;
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      gitCalls.length = 0;
      assert.strictEqual((await make({ fileSystem: symlinkFs }).installed()).sha, null);
      assert.deepStrictEqual(gitCalls, []);
    });

    await test('missing metadata uses only process-local safe.directory for the exact resolved release', async () => {
      fs.rmSync(metadataFile);
      gitCalls.length = 0;
      const installed = await make().installed();
      assert.strictEqual(installed.sha, currentSha);
      assert.strictEqual(gitCalls.length, 3);
      const exactRelease = fs.realpathSync(releaseDir);
      for (const call of gitCalls) {
        assert.strictEqual(call.cwd, exactRelease);
        assert.deepStrictEqual(call.args.slice(0, 2), ['-c', `safe.directory=${exactRelease}`]);
        assert.strictEqual(call.args.includes('--global'), false);
        assert.strictEqual(call.args.some(value => String(value).includes('safe.directory=*')), false);
      }
      writeMetadata();
    });

    await test('legacy fallback rejects a writable or out-of-root active release before invoking Git', async () => {
      fs.rmSync(metadataFile);
      gitCalls.length = 0;
      assert.strictEqual((await make({ fileSystem: trustFileSystem({ releaseMode: 0o770 }) }).installed()).sha, null);
      assert.deepStrictEqual(gitCalls, []);
      const otherRoot = path.join(root, 'other-releases');
      fs.mkdirSync(otherRoot);
      gitCalls.length = 0;
      assert.strictEqual((await make({ releasesRoot: otherRoot }).installed()).sha, null);
      assert.deepStrictEqual(gitCalls, []);
      writeMetadata();
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

    await test('new metadata reports the new SHA and rollback reports the previous SHA', async () => {
      writeMetadata({ sha: secondTarget, version: '2.3.1', message: 'New release', date: '2026-08-17T00:00:00Z' });
      assert.deepStrictEqual(await make().installed(), {
        version: '2.3.1', sha: secondTarget, hash: secondTarget.slice(0, 7),
        message: 'New release', date: '2026-08-17T00:00:00Z',
      });
      writeMetadata();
      assert.strictEqual((await make().installed()).sha, currentSha);
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
