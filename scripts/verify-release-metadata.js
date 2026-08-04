const fs = require('fs');
const path = require('path');
const {
  LOGIN_SECURITY_SCHEMA_VERSION,
} = require('../db-migrations');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const errors = [];
const requiredFiles = [
  'CHANGELOG.md', 'README.md', 'RELEASE.md', 'server.js',
  'db-migrations.js', 'package-lock.json', 'package.json',
];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  errors.push(`package version is not semantic: ${packageJson.version}`);
}
if (packageLock.version !== packageJson.version
    || packageLock.packages?.['']?.version !== packageJson.version) {
  errors.push('package.json and package-lock.json versions do not match');
}
if (packageLock.lockfileVersion !== 3) {
  errors.push(`package-lock.json must use lockfileVersion 3, found ${packageLock.lockfileVersion}`);
}
if (packageJson.engines?.node !== '>=20') {
  errors.push('package.json must declare the supported Node.js runtime (>=20)');
}
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`required release file is missing: ${file}`);
}

const migrationDocs = fs.readFileSync(path.join(root, 'docs', 'migrations.md'), 'utf8');
if (!migrationDocs.includes(`Version ${LOGIN_SECURITY_SCHEMA_VERSION}`)
    || !new RegExp(`migration ${LOGIN_SECURITY_SCHEMA_VERSION} is`, 'i').test(migrationDocs)) {
  errors.push(`migration documentation does not identify schema ${LOGIN_SECURITY_SCHEMA_VERSION}`);
}

if (process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `v${packageJson.version}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    errors.push(`release tag ${process.env.GITHUB_REF_NAME} does not match package version ${expectedTag}`);
  }
}

if (errors.length) {
  errors.forEach(error => console.error(`Release metadata error: ${error}`));
  process.exit(1);
}
console.log(`Release metadata is consistent: package ${packageJson.version}, schema ${LOGIN_SECURITY_SCHEMA_VERSION}.`);
