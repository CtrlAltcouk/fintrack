#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHA = /^[0-9a-f]{40}$/i;
const STATUSES = new Set(['in_progress', 'succeeded', 'failed', 'rolled_back']);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readRequest(file, expectedUid = '', maxAgeSeconds = '900') {
  let value;
  let descriptor;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(file, flags);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 4096
        || (expectedUid !== '' && (stat.mode & 0o077) !== 0)
        || (expectedUid !== '' && stat.uid !== Number(expectedUid))) {
      fail('Invalid update request');
    }
    value = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch (_) { fail('Invalid update request'); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  const timestamp = Date.parse(value?.updated_at || '');
  const ageLimit = Number(maxAgeSeconds);
  const age = Date.now() - timestamp;
  if (value?.status !== 'requested' || !SHA.test(value.target || '')
      || !SHA.test(value.current || '')
      || !Number.isInteger(value.requested_by) || value.requested_by < 1
      || !Number.isFinite(timestamp) || !Number.isFinite(ageLimit) || ageLimit < 1
      || age > ageLimit * 1000 || age < -300000) {
    fail('Invalid update request');
  }
  process.stdout.write(`${[
    value.target.toLowerCase(),
    value.current.toLowerCase(),
    String(value.requested_by),
  ].join('\t')}\n`);
}

function writeRejection(file) {
  const value = {
    status: 'failed', target: null, current: null, requested_by: null,
    updated_at: new Date().toISOString(), error: 'update_failed',
  };
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o640, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function writeState(file, status, target, current, requestedBy, error = '') {
  if (!STATUSES.has(status) || !SHA.test(target || '')
      || !SHA.test(current || '')
      || !/^\d+$/.test(requestedBy || '')) fail('Invalid update state');
  const value = {
    status,
    target: target.toLowerCase(),
    current: current ? current.toLowerCase() : null,
    requested_by: Number(requestedBy),
    updated_at: new Date().toISOString(),
    error: error || null,
  };
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o640, flag: 'wx' });
  fs.renameSync(temporary, file);
}

const [command, file, ...args] = process.argv.slice(2);
if (!path.isAbsolute(file || '')) fail('State path must be absolute');
if (command === 'read-request') readRequest(file, ...args);
else if (command === 'write-state') writeState(file, ...args);
else if (command === 'write-rejection') writeRejection(file);
else fail('Usage: update-state.js <read-request|write-state|write-rejection> <absolute-path> ...');
