// Static PowerShell checks:
//  * both native scripts parse with the Windows PowerShell 5.1 parser
//  * they still parse when their bytes are read through a GB2312 (936) reader,
//    which simulates a Chinese Windows machine reading the files as ANSI text
//  * the launcher still exposes the contract the Node host relies on
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const launcherPath = join(repoRoot, 'scripts', 'launcher.ps1');
const approvalPath = join(repoRoot, 'scripts', 'approval-popup.ps1');
const collectorPath = join(repoRoot, 'scripts', 'collect-diagnostics.ps1');

if (process.platform !== 'win32') {
  console.log('[SKIP] PowerShell syntax checks require Windows');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Contract checks on the source text
// ---------------------------------------------------------------------------
const launcher = readFileSync(launcherPath, 'utf8');
const approval = readFileSync(approvalPath, 'utf8');
const failures = [];

function requireContains(name, text, needle) {
  if (!text.includes(needle)) failures.push(`${name}: missing ${needle}`);
}

requireContains('launcher.ps1', launcher, 'param(');
requireContains('launcher.ps1', launcher, '[string]$Hotkey');
requireContains('launcher.ps1', launcher, 'RegisterHotKey');
requireContains('launcher.ps1', launcher, 'SetWindowsHookEx');
requireContains('launcher.ps1', launcher, "'Global\\dsh-quickdesk-sidecar'");
requireContains('launcher.ps1', launcher, 'hotkey-unavailable');
requireContains('launcher.ps1', launcher, 'Console.Out.WriteLine("ready")');
requireContains('approval.ps1', approval, 'param(');
requireContains('approval.ps1', approval, '$request');
const collector = readFileSync(collectorPath, 'utf8');
requireContains('collect-diagnostics.ps1', collector, '[string]$OutputZip');
requireContains('collect-diagnostics.ps1', collector, 'SaveFileDialog');
requireContains('collect-diagnostics.ps1', collector, 'QUICKDESK_DIAGNOSTICS_JSON');
requireContains('collect-diagnostics.ps1', collector, 'Remove-Item -LiteralPath $tempRoot -Recurse -Force');
requireContains('collect-diagnostics.ps1', collector, 'tempRemoved');

// ---------------------------------------------------------------------------
// 2. Parse with the real Windows PowerShell 5.1 parser, then repeat with a
//    GB2312-reader simulation (this is the exact 1.2.0 regression).
// ---------------------------------------------------------------------------
const command = String.raw`
$ErrorActionPreference = 'Stop'
$files = @('scripts/launcher.ps1', 'scripts/approval-popup.ps1', 'scripts/collect-diagnostics.ps1')
$fail = 0
$out = New-Object System.Collections.Generic.List[string]
foreach ($file in $files) {
  $resolved = (Resolve-Path -LiteralPath $file).Path
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($resolved, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    $fail = 1
    foreach ($e in $errors) {
      $out.Add("PARSE_FAIL $file $($e.Extent.StartLineNumber): $($e.Message)")
    }
  } else {
    $out.Add("PARSE_OK $file")
  }

  $bytes = [System.IO.File]::ReadAllBytes($resolved)
  $gbk = [System.Text.Encoding]::GetEncoding(936)
  $textAsGbk = $gbk.GetString($bytes)
  $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.Guid]::NewGuid().ToString('N') + '.ps1')
  [System.IO.File]::WriteAllBytes($tmp, $gbk.GetBytes($textAsGbk))
  $tokens2 = $null
  $errors2 = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($tmp, [ref]$tokens2, [ref]$errors2)
  if ($errors2.Count -gt 0) {
    $fail = 1
    $first = $errors2[0]
    $out.Add("GBK_SIM_FAIL $file $($first.Extent.StartLineNumber): $($first.Message)")
  } else {
    $out.Add("GBK_SIM_OK $file")
  }
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
$out | ForEach-Object { Write-Output $_ }
if ($fail -ne 0) { exit 2 }
exit 0
`;

// Write the helper to a real .ps1 file and run it with -File. Passing a long
// multi-line -Command string is fragile through Windows process arguments.
const helperPath = join(tmpdir(), `quickdesk-parse-helper-${process.pid}-${Date.now()}.ps1`);
writeFileSync(helperPath, command, 'utf8');
let result;
try {
  result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath],
    { cwd: repoRoot, encoding: 'utf8', timeout: 120000 }
  );
} finally {
  try { rmSync(helperPath, { force: true }); } catch { /* ignore */ }
}

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
if (output) console.log(output);

if (result.error) {
  failures.push(`could not run powershell.exe: ${result.error.message}`);
} else if (result.status !== 0) {
  const failedLines = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('PARSE_FAIL') || line.startsWith('GBK_SIM_FAIL'));
  if (failedLines.length > 0) failures.push(...failedLines);
  else failures.push(`powershell parser exited with code ${result.status}`);
}

if (failures.length > 0) {
  console.error('FAIL PowerShell static checks');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('PASS PowerShell static checks: parse + GB2312 simulation + host contract');
