#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [releaseDirectory, shaValue, messageValue = '', dateValue = ''] = process.argv.slice(2);
const FULL_SHA = /^[0-9a-f]{40}$/i;

function fail(message) {
  process.stderr.write(`[ERROR] ${message}\n`);
  process.exit(1);
}

if (!releaseDirectory || !FULL_SHA.test(shaValue || '')) fail('release metadata requires an exact commit SHA');

const release = fs.realpathSync(releaseDirectory);
const packagePath = path.join(release, 'package.json');
let packageMetadata;
try {
  packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
} catch (_) {
  fail('release package metadata could not be read');
}

const version = packageMetadata?.version;
if (typeof version !== 'string' || version.length < 1 || version.length > 64 || /[\x00-\x1f\x7f]/.test(version)) {
  fail('release package version is invalid');
}

const message = String(messageValue).split(/\r?\n/, 1)[0].slice(0, 200);
const date = String(dateValue).slice(0, 64);
if (date && (!Number.isFinite(Date.parse(date)) || /[\x00-\x1f\x7f]/.test(date))) {
  fail('release commit date is invalid');
}

const metadataPath = path.join(release, '.outflow-release.json');
try {
  fs.lstatSync(metadataPath);
  fail('release metadata path already exists');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const temporaryPath = path.join(release, `.outflow-release.json.pending.${process.pid}.${crypto.randomUUID()}`);
const metadata = {
  sha: shaValue.toLowerCase(),
  version,
  message,
  date,
};
let descriptor;
try {
  descriptor = fs.openSync(temporaryPath, 'wx', 0o640);
  fs.writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`, 'utf8');
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  descriptor = undefined;
  fs.chmodSync(temporaryPath, 0o640);
  fs.renameSync(temporaryPath, metadataPath);
  try {
    const directoryDescriptor = fs.openSync(release, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  } catch (_) {
    // Directory fsync is unavailable on some test platforms; the file rename is still atomic.
  }
} catch (error) {
  if (descriptor !== undefined) fs.closeSync(descriptor);
  fs.rmSync(temporaryPath, { force: true });
  fail(`release metadata could not be written: ${error.code || 'write_failed'}`);
}
