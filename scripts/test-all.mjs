// Run every QuickDesk test suite. This is the single publish gate:
//   npm test              -> all suites, non-zero exit on any failure
//   npm publish           -> prepublishOnly runs this file first
//
// Keep suite order from fast/static to slow/runtime so failures are cheap.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const suites = [
  ['unit: selftest (44 checks)', 'scripts/selftest.mjs'],
  ['release: metadata gate', 'scripts/verify-release.mjs'],
  ['guard: ASCII-only PowerShell scripts', 'scripts/tests/encoding.test.mjs'],
  ['static: PowerShell parse + GB2312 simulation', 'scripts/tests/powershell-syntax.test.mjs'],
  ['unit: module API, config and locales', 'scripts/tests/module.test.mjs'],
  ['release: bilingual release notes', 'scripts/tests/release-notes.test.mjs'],
  ['diagnostics: collector zip + temp cleanup', 'scripts/tests/diagnostics.test.mjs'],
  ['package: manifest, version sync and pack contents', 'scripts/tests/package.test.mjs'],
  ['runtime: launcher start/hotkey/restart/mutex', 'scripts/tests/launcher-runtime.test.mjs']
];

let failed = 0;
for (const [name, relativePath] of suites) {
  const file = resolve(repoRoot, relativePath);
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [file], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    failed += 1;
    console.error(`FAIL ${name}: ${result.error.message}`);
  } else if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL ${name}: exit code ${result.status}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

if (failed > 0) {
  console.error(`\nTEST SUITE FAILED: ${failed} of ${suites.length} suite(s) failed.`);
  console.error('Publishing is blocked until every suite passes.');
  process.exit(1);
}

console.log(`\nAll ${suites.length} test suites passed. Publishing gate is open.`);
