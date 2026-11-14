// Package manifest, version consistency and npm pack contents.
// These checks run before every publish and in CI; a broken manifest must never
// reach npm.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const lock = existsSync(join(repoRoot, 'package-lock.json'))
  ? JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'))
  : null;
const changelog = existsSync(join(repoRoot, 'CHANGELOG.md'))
  ? readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  : '';
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
    console.error(`FAIL ${name}: ${error && error.message ? error.message : error}`);
  }
}

function coveredByFiles(relativePath) {
  const patterns = pkg.files || [];
  return patterns.some((pattern) => {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '§§')
          .replace(/\*/g, '[^/]*')
          .replace(/§§/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    );
    return regex.test(relativePath);
  });
}

const requiredFiles = [
  'quickdesk.mjs',
  'client.js',
  'compat.mjs',
  'cordis.patch.yml',
  'scripts/launcher.ps1',
  'scripts/approval-popup.ps1',
  'scripts/collect-diagnostics.ps1',
  'locale/zh.json',
  'locale/en.json',
  'icon.svg',
  'LICENSE',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'COMPATIBILITY.md',
  'docs/assets/icon.png',
  'docs/assets/settings-page.png',
  'docs/assets/settings-page-diagnostics.png',
  'docs/assets/settings-page-approvals.png',
  'docs/assets/social-preview.png'
];

check('package identity and publish metadata', () => {
  assert.equal(pkg.name, 'dsh-quickdesk');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.license, 'MIT');
  assert.deepEqual(pkg.os, ['win32']);
  assert.ok(pkg.engines && pkg.engines.node === '>=22');
  assert.ok(pkg.engines.dsh, 'engines.dsh must be declared');
  assert.equal(pkg.private, undefined, 'package must not be private');
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, 'public');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.repository && pkg.repository.url.includes('github.com/aofchas/dsh-quickdesk'));
});

check('DSH bundle and client declarations are present', () => {
  assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'dsh.bundle.patch missing');
  assert.ok(existsSync(join(repoRoot, pkg.dsh.bundle.patch)), 'bundle patch file missing');
  assert.ok(pkg.dsh.client && pkg.dsh.client.platform === 'web');
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0);
});

check('all required package files exist', () => {
  for (const relativePath of requiredFiles) {
    assert.ok(existsSync(join(repoRoot, relativePath)), `missing ${relativePath}`);
  }
});

check('package files whitelist covers every required file', () => {
  for (const relativePath of requiredFiles) {
    assert.ok(coveredByFiles(relativePath), `files[] does not cover ${relativePath}`);
  }
});

check('development-only files are not shipped in the package', () => {
  const forbidden = [
    'scripts/tests/encoding.test.mjs',
    'scripts/collect-diagnostics.cmd',
    'scripts/QuickDesk-Diagnostics.zip',
    'package-lock.json',
    'docs/PUBLISHING.md',
    'docs/TESTING.md',
    'docs/market-copy.md',
    'docs/release-notes/1.2.1.md'
  ];
  for (const relativePath of forbidden) {
    assert.equal(coveredByFiles(relativePath), false, `files[] must not include ${relativePath}`);
  }
});

check('version is consistent across package.json, package-lock and CHANGELOG', () => {
  if (lock && lock.packages && lock.packages['']) {
    assert.equal(lock.packages[''].version, pkg.version, 'package-lock root version is stale; run npm install --package-lock-only');
  }
  assert.ok(changelog.includes(pkg.version), `CHANGELOG.md does not mention version ${pkg.version}`);
});

check('test suite is the publish gate', () => {
  assert.match(pkg.scripts.test || '', /scripts\/test-all\.mjs/);
  assert.match(pkg.scripts.prepublishOnly || '', /scripts\/test-all\.mjs/);
});

check('npm pack contains the runtime files and no dev/test files', () => {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' }
  );
  assert.equal(result.error, undefined, `npm pack failed to start: ${result.error && result.error.message}`);
  assert.equal(result.status, 0, `npm pack failed: ${result.stderr || result.stdout}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm pack --json output is not JSON: ${result.stdout.slice(0, 500)}`);
  }
  const files = new Set((parsed[0].files || []).map((entry) => entry.path));
  for (const relativePath of requiredFiles) {
    assert.ok(files.has(relativePath), `npm tarball missing ${relativePath}`);
  }
  for (const relativePath of files) {
    assert.equal(
      relativePath.startsWith('scripts/tests/'),
      false,
      `test file ${relativePath} must not be packed`
    );
    assert.equal(relativePath.endsWith('.tgz'), false, `tarball ${relativePath} must not be packed`);
    assert.equal(
      /^docs\/.*\.md$/.test(relativePath),
      false,
      `internal documentation ${relativePath} must not be published`
    );
  }
});

// Also verify that the shipped scripts/ directory does not accidentally contain
// test artifacts (the files[] whitelist is the first line of defence).
check('scripts/ directory has no stray .tgz/zip artifacts', () => {
  for (const name of readdirSync(join(repoRoot, 'scripts'))) {
    const file = join(repoRoot, 'scripts', name);
    if (!statSync(file).isFile()) continue;
    assert.equal(/\.(tgz|zip)$/i.test(name), false, `stray artifact in scripts/: ${name}`);
  }
});

if (failures.length > 0) {
  console.error(`FAIL package tests: ${failures.length} failure(s)`);
  process.exit(1);
}

console.log('PASS package tests: manifest, version sync and npm pack contents');
