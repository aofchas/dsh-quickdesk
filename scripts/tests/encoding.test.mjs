// Encoding guard: PowerShell scripts must be pure ASCII.
//
// Windows PowerShell 5.1 reads a .ps1 file without a UTF-8 BOM using the
// system ANSI code page. QuickDesk 1.2.0 shipped UTF-8 (no BOM) launcher.ps1
// and approval-popup.ps1 with Chinese fallback strings; on a Chinese Windows
// (GB2312 / code page 936) the scripts failed to parse, so the sidecar exited
// before writing launcher.log and the global hotkey never worked.
//
// Keeping every .ps1 and .cmd file ASCII-only makes parse behavior identical
// on every Windows code page. User-visible localized copy is passed to the
// sidecar by the Node host as base64, so ASCII fallbacks in these files are
// only a last resort and can be English.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptsDir = join(repoRoot, 'scripts');

function lineOf(bytes, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (bytes[i] === 0x0a) line += 1;
  }
  return line;
}

function decodeOrNull(bytes, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    return null;
  }
}

const targets = readdirSync(scriptsDir)
  .filter((name) => /\.(ps1|cmd)$/i.test(name))
  .sort();
const failures = [];

if (targets.length === 0) {
  failures.push('no PowerShell/CMD scripts found under scripts/');
}

for (const name of targets) {
  const file = join(scriptsDir, name);
  const bytes = readFileSync(file);
  const badIndices = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] > 0x7f) badIndices.push(i);
  }
  if (badIndices.length > 0) {
    const preview = badIndices
      .slice(0, 5)
      .map((i) => `byte ${i} (line ${lineOf(bytes, i)})`)
      .join(', ');
    failures.push(
      `${name}: ${badIndices.length} non-ASCII byte(s): ${preview}. ` +
        'Windows PowerShell 5.1 reads BOM-less scripts using the system ANSI ' +
        'code page; GB2312/936 systems misparse Chinese text. Use ASCII-only ' +
        'fallback strings.'
    );
    continue;
  }

  const utf8 = decodeOrNull(bytes, 'utf-8');
  if (utf8 === null) {
    failures.push(`${name}: not valid UTF-8`);
    continue;
  }

  // A pure ASCII file decodes identically under every ANSI code page. If the
  // GB2312 decoding differs, a Chinese Windows machine would read other bytes.
  const gbk = decodeOrNull(bytes, 'gbk');
  if (gbk === null) {
    // Older Node builds may ship without the GBK decoder; the ASCII byte check
    // above already guarantees codepage independence.
    continue;
  }
  if (gbk !== utf8) {
    failures.push(`${name}: decodes differently under GB2312 than under UTF-8`);
  }
}

if (failures.length > 0) {
  console.error('FAIL encoding guard');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nFix: replace non-ASCII fallback text in .ps1/.cmd files with English ' +
      'ASCII strings. The host still passes localized text to the native UI.'
  );
  process.exit(1);
}

console.log(
  `PASS encoding guard: ${targets.length} PowerShell/CMD file(s) are ASCII-only ` +
    'and codepage-independent'
);
