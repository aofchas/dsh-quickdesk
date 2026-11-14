// Diagnostics collector integration test.
//
// Runs the real scripts/collect-diagnostics.ps1 with an explicit -OutputZip so
// the Save-As dialog is skipped, then verifies:
//   * the JSON result marker exists and reports success
//   * the report zip exists and contains the expected files
//   * the temporary collection folder is removed after zipping
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const collectorPath = join(repoRoot, 'scripts', 'collect-diagnostics.ps1');
const collectorCmd = join(repoRoot, 'scripts', 'collect-diagnostics.cmd');

// Static checks run everywhere.
assert.ok(existsSync(collectorPath), 'collect-diagnostics.ps1 is missing');
assert.ok(existsSync(collectorCmd), 'collect-diagnostics.cmd is missing');
const source = readFileSync(collectorPath, 'utf8');
for (const needle of ['[string]$OutputZip', 'SaveFileDialog', 'QUICKDESK_DIAGNOSTICS_JSON', 'tempRemoved']) {
  assert.ok(source.includes(needle), `collector is missing ${needle}`);
}

if (process.platform !== 'win32') {
  console.log('[SKIP] diagnostics runtime test requires Windows');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'qd-diagnostics-test-'));
const zipPath = join(work, 'QuickDesk-Diagnostics-test.zip');
const unzipDir = join(work, 'unzipped');

function runPowerShell(script, cwd) {
  return spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { cwd, encoding: 'utf8', timeout: 180000 }
  );
}

try {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', collectorPath,
      '-OutputZip', zipPath,
      '-NoSmokeTest'
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 180000 }
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.error, undefined, `collector failed to start: ${result.error && result.error.message}`);
  assert.equal(result.status, 0, `collector failed: ${output.slice(-2000)}`);

  const marker = 'QUICKDESK_DIAGNOSTICS_JSON: ';
  const markerLine = `${result.stdout || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(marker))
    .pop();
  assert.ok(markerLine, 'collector did not print a JSON result marker');
  const payload = JSON.parse(markerLine.slice(marker.length));
  assert.equal(payload.ok, true, `collector reported failure: ${JSON.stringify(payload)}`);
  assert.equal(payload.canceled, false);
  // CI runners expose TEMP as an 8.3 short path (RUNNER~1), while the
  // collector returns the long form (runneradmin). Compare the file and
  // folder names instead of the full path so the test is path-form agnostic.
  assert.equal(basename(payload.zip).toLowerCase(), basename(zipPath).toLowerCase());
  assert.equal(basename(dirname(payload.zip)).toLowerCase(), basename(dirname(zipPath)).toLowerCase());
  assert.equal(payload.tempRemoved, true, 'temporary collection folder must be removed after zipping');
  assert.equal(existsSync(payload.temp), false, `temporary folder still exists: ${payload.temp}`);
  assert.ok(existsSync(zipPath), 'report zip was not written');
  assert.ok(statSync(zipPath).size > 5000, 'report zip looks too small');

  // Inspect the zip contents with PowerShell's Expand-Archive.
  const expand = runPowerShell(
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${unzipDir.replace(/'/g, "''")}' -Force`,
    work
  );
  assert.equal(expand.status, 0, `Expand-Archive failed: ${expand.stderr || expand.stdout}`);
  const names = new Set(readdirSync(unzipDir));
  for (const required of ['summary.txt', 'environment.txt', 'dsh-version.txt', 'quickdesk-install.txt', 'plugin-import.txt', 'README.txt']) {
    assert.ok(names.has(required), `report zip is missing ${required}`);
  }
  const summary = readFileSync(join(unzipDir, 'summary.txt'), 'utf8');
  assert.match(summary, /QuickDesk diagnostics summary/);
  assert.match(summary, /VERDICT:/);

  console.log('PASS diagnostics collector: zip, contents, JSON marker, temporary folder cleanup');
} finally {
  rmSync(work, { recursive: true, force: true });
}
