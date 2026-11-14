// Launcher runtime integration tests (Windows only).
//
// The real launcher.ps1 uses a fixed global mutex and a fixed log directory.
// These tests run patched copies with a per-test mutex/log directory so they
// can run safely while a real QuickDesk sidecar is active, and verify:
//   1. the hidden sidecar starts, prints "ready", registers the digit hotkey
//      and installs the low-level hook, and writes launcher.log
//   2. a host-style quit + immediate restart wins the mutex race
//   3. a second sidecar exits cleanly when the mutex is already held
//   4. (observation only) current behaviour when stdin closes unexpectedly
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const launcherSource = join(repoRoot, 'scripts', 'launcher.ps1');

if (process.platform !== 'win32') {
  console.log('[SKIP] launcher runtime tests require Windows');
  process.exit(0);
}

const MUTEX_NEEDLE = "'Global\\dsh-quickdesk-sidecar'";
const LOG_DIR_NEEDLE = '"dsh-quickdesk"';
const children = new Set();

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function makeCase(label) {
  const dir = mkdtempSync(join(tmpdir(), 'qd-launcher-test-'));
  const tag = `${label}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const mutexName = `Global\\dsh-quickdesk-test-${tag}`;
  const logDirName = `dsh-quickdesk-test-${tag}`;
  const source = readFileSync(launcherSource, 'utf8');

  const mutexCount = countOccurrences(source, MUTEX_NEEDLE);
  const logCount = countOccurrences(source, LOG_DIR_NEEDLE);
  assert.equal(mutexCount, 1, 'launcher.ps1 should contain exactly one mutex literal');
  assert.equal(logCount, 1, 'launcher.ps1 should contain exactly one log-dir literal');

  let patched = source.split(MUTEX_NEEDLE).join(`'${mutexName}'`);
  patched = patched.split(LOG_DIR_NEEDLE).join(`"${logDirName}"`);

  const file = join(dir, 'launcher-test.ps1');
  writeFileSync(file, patched, 'utf8');
  const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE, 'AppData', 'Local');
  const logDir = join(localAppData, logDirName);
  const logPath = join(logDir, 'launcher.log');

  return {
    dir,
    file,
    logPath,
    logDir,
    mutexName,
    cleanup() {
      for (const child of children) {
        try { child.kill(); } catch { /* ignore */ }
      }
      children.clear();
      rmSync(dir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  };
}

function startLauncher(caseInfo, hotkey) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      caseInfo.file,
      '-Hotkey',
      hotkey
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const state = { child, out: '', err: '', exited: false, code: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { state.out += chunk; });
  child.stderr.on('data', (chunk) => { state.err += chunk; });
  child.on('close', (code) => { state.exited = true; state.code = code; });
  children.add(child);
  return state;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const started = Date.now();
    const tick = () => {
      try {
        if (predicate()) return resolvePromise();
      } catch (error) {
        return rejectPromise(error);
      }
      if (Date.now() - started > timeoutMs) {
        return rejectPromise(new Error(`timeout after ${timeoutMs}ms waiting for ${label}`));
      }
      setTimeout(tick, 100);
      return undefined;
    };
    tick();
  });
}

function waitClosed(state, timeoutMs) {
  return waitFor(() => state.exited, timeoutMs, 'sidecar to exit');
}

async function stop(state) {
  if (!state || state.exited) return;
  try {
    state.child.stdin.write('quit\n');
    state.child.stdin.end();
  } catch { /* ignore */ }
  try {
    await waitClosed(state, 5000);
  } catch {
    try { state.child.kill(); } catch { /* ignore */ }
  }
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. Start, ready, digit hotkey registration, hook and launcher.log
  // -------------------------------------------------------------------------
  const case1 = makeCase('start');
  try {
    const proc = startLauncher(case1, 'Ctrl+Shift+0');
    await waitFor(() => proc.out.includes('ready'), 25000, 'sidecar ready');
    assert.equal(proc.exited, false, 'sidecar must stay alive after ready');
    const log = readFileSync(case1.logPath, 'utf8');
    assert.match(log, /RegisterHotKey registered=True spec=Ctrl\+Shift\+0/);
    assert.match(log, /start pid=\d+ hotkey=Ctrl\+Shift\+0/);
    assert.match(log, /low-level hook installed=True/);
    assert.ok(!/ParserError|TerminatorExpected|Unexpected token/i.test(proc.err), `launcher stderr: ${proc.err}`);
    await stop(proc);
    assert.ok(existsSync(case1.logPath), 'launcher.log must exist');
    console.log('PASS launcher starts, registers Ctrl+Shift+0, installs hook, writes launcher.log');
  } finally {
    case1.cleanup();
  }

  // -------------------------------------------------------------------------
  // 2. Host-style restart: quit the old sidecar and immediately start the new
  //    one with a different hotkey (the live settings update path).
  // -------------------------------------------------------------------------
  const case2 = makeCase('restart');
  try {
    const first = startLauncher(case2, 'Ctrl+Alt+F19');
    await waitFor(() => first.out.includes('ready'), 25000, 'first sidecar ready');
    try {
      first.child.stdin.write('quit\n');
      first.child.stdin.end();
    } catch { /* ignore */ }
    const second = startLauncher(case2, 'Ctrl+Alt+F20');
    await waitFor(() => second.out.includes('ready'), 25000, 'restarted sidecar ready');
    assert.equal(second.exited, false, 'restarted sidecar must stay alive');
    console.log('PASS sidecar restart after quit succeeds (mutex race)');
    await stop(second);
    await stop(first);
  } finally {
    case2.cleanup();
  }

  // -------------------------------------------------------------------------
  // 3. Second instance must exit cleanly while the first holds the mutex.
  // -------------------------------------------------------------------------
  const case3 = makeCase('mutex');
  try {
    const first = startLauncher(case3, 'Ctrl+Alt+F19');
    await waitFor(() => first.out.includes('ready'), 25000, 'first sidecar ready');
    const second = startLauncher(case3, 'Ctrl+Alt+F20');
    await waitClosed(second, 20000);
    assert.equal(second.exited, true, 'second sidecar must exit');
    assert.equal(second.out.includes('ready'), false, 'second sidecar must not become ready');
    assert.equal(second.code, 0, `second sidecar should exit with 0, got ${second.code}`);
    console.log('PASS second sidecar exits cleanly while mutex is held');
    await stop(first);
  } finally {
    case3.cleanup();
  }

  // -------------------------------------------------------------------------
  // 4. Observation: stdin EOF currently leaves the sidecar alive (orphan risk).
  // -------------------------------------------------------------------------
  const case4 = makeCase('stdin');
  try {
    const proc = startLauncher(case4, 'Ctrl+Alt+F19');
    await waitFor(() => proc.out.includes('ready'), 25000, 'sidecar ready');
    try { proc.child.stdin.end(); } catch { /* ignore */ }
    await sleep(2500);
    console.log(
      `[OBSERVE] stdin EOF leaves sidecar alive=${!proc.exited}` +
        ' (known orphan risk; a future fix should exit after a grace period)'
    );
    await stop(proc);
  } finally {
    case4.cleanup();
  }
}

main().then(
  () => {
    console.log('PASS launcher runtime integration tests');
    process.exit(0);
  },
  (error) => {
    console.error(`FAIL launcher runtime tests: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  }
);
