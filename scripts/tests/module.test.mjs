// Unit tests for the Host half's exported pure functions and the Config schema.
// These are the contracts the DSH settings page, the task protocol and the
// sidecar command line rely on.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleUrl = pathToFileURL(resolve(repoRoot, 'quickdesk.mjs')).href;

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
    console.error(`FAIL ${name}: ${error && error.message ? error.message : error}`);
  }
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'value'} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function truthy(value, message) {
  if (!value) throw new Error(message || 'expected truthy value');
}

const qd = await import(moduleUrl);

const EXPECTED_KEYS = [
  'hotkey',
  'submitKey',
  'cancelKey',
  'approveKey',
  'rejectKey',
  'language',
  'statusCorner',
  'statusEnabled',
  'statusLingerMs',
  'workspaceDirectory',
  'defaultPrompt',
  'maxSteps',
  'enforceMaxSteps',
  'approvalPopup',
  'popupTimeoutMs',
  'autoPresetNewSessions',
  'autoPresetName',
  'disableComputerUseUi',
  'diagnosticsRequest'
];

check('exports apply()', () => equal(typeof qd.apply, 'function'));
check('exports Config schema', () => truthy(qd.Config, 'Config schema export is missing'));
check('CONFIG_KEYS matches the documented 19 fields', () => {
  equal(qd.CONFIG_KEYS.length, EXPECTED_KEYS.length);
  for (const key of EXPECTED_KEYS) truthy(qd.CONFIG_KEYS.includes(key), `missing config key ${key}`);
});

// ---------------------------------------------------------------------------
// readConfig(): defaults, sanitising and type coercion
// ---------------------------------------------------------------------------
check('readConfig({}) returns documented defaults', () => {
  const config = qd.readConfig({});
  equal(config.hotkey, 'Ctrl+Alt+Space');
  equal(config.submitKey, 'Enter');
  equal(config.cancelKey, 'Escape');
  equal(config.language, 'auto');
  equal(config.statusCorner, 'top-right');
  equal(config.statusEnabled, true);
  equal(config.maxSteps, 20);
  equal(config.enforceMaxSteps, true);
  equal(config.approvalPopup, true);
  equal(config.autoPresetNewSessions, true);
  equal(config.autoPresetName, 'auto');
  equal(config.disableComputerUseUi, false);
});

check('readConfig() rejects invalid hotkeys/keys', () => {
  const config = qd.readConfig({ hotkey: '   ', submitKey: '', cancelKey: null });
  equal(config.hotkey, 'Ctrl+Alt+Space');
  equal(config.submitKey, 'Enter');
  equal(config.cancelKey, 'Escape');
});

check('readConfig() resolves conflicting shortcuts safely', () => {
  let config = qd.readConfig({ hotkey: 'Enter' });
  equal(config.hotkey, 'Ctrl+Alt+Space');
  equal(config.submitKey, 'Enter');

  config = qd.readConfig({ submitKey: 'Escape', cancelKey: 'Escape' });
  equal(config.submitKey, 'Enter');
  equal(config.cancelKey, 'Escape');

  config = qd.readConfig({ approveKey: 'Backspace', rejectKey: 'Backspace' });
  equal(config.approveKey, 'Enter');
  equal(config.rejectKey, 'Backspace');

  config = qd.readConfig({ submitKey: 'Enter', approveKey: 'Enter' });
  equal(config.submitKey, 'Enter');
  equal(config.approveKey, 'Enter');
});

check('readConfig() clamps invalid numbers and enums', () => {
  const config = qd.readConfig({
    statusCorner: 'diagonal',
    statusLingerMs: 10,
    language: 'de',
    maxSteps: 999,
    popupTimeoutMs: 10
  });
  equal(config.statusCorner, 'top-right');
  equal(config.statusLingerMs, 20000);
  equal(config.language, 'auto');
  equal(config.maxSteps, 20);
  equal(config.popupTimeoutMs, 120000);
});

check('readConfig() keeps valid overrides', () => {
  const config = qd.readConfig({
    hotkey: 'Ctrl+0',
    language: 'en',
    maxSteps: 35,
    statusCorner: 'bottom-left',
    defaultPrompt: 'custom'
  });
  equal(config.hotkey, 'Ctrl+0');
  equal(config.language, 'en');
  equal(config.maxSteps, 35);
  equal(config.statusCorner, 'bottom-left');
  equal(config.defaultPrompt, 'custom');
});

// ---------------------------------------------------------------------------
// Volatile refs: settings page / Loader hand over {get()} wrappers
// ---------------------------------------------------------------------------
check('plainVolatileConfig() unwraps {get()} refs and keeps plain values', () => {
  const raw = {
    hotkey: { get: () => 'Ctrl+0' },
    maxSteps: { get: () => 33 },
    language: 'en',
    missing: { get: () => 'ignored' }
  };
  const plain = qd.plainVolatileConfig(raw);
  equal(plain.hotkey, 'Ctrl+0');
  equal(plain.maxSteps, 33);
  equal(plain.language, 'en');
  equalityMissing(plain, 'missing');
});

function equalityMissing(object, key) {
  if (key in object) throw new Error(`expected ${key} to be ignored`);
}

// ---------------------------------------------------------------------------
// Language resolution
// ---------------------------------------------------------------------------
check('resolveLanguage() honours explicit zh/en', () => {
  equal(qd.resolveLanguage({ language: 'zh' }), 'zh');
  equal(qd.resolveLanguage({ language: 'en' }), 'en');
});

check('resolveLanguage() falls back to the OS locale for auto', () => {
  equal(qd.resolveLanguage({ language: 'auto' }, 'zh-CN'), 'zh');
  equal(qd.resolveLanguage({ language: 'auto' }, 'zh-TW'), 'zh');
  equal(qd.resolveLanguage({ language: 'auto' }, 'en-US'), 'en');
  equal(qd.resolveLanguage({ language: 'auto' }, 'fr-FR'), 'en');
});

// ---------------------------------------------------------------------------
// Prompt rendering and key labels
// ---------------------------------------------------------------------------
check('formatTemplate() replaces known placeholders and keeps unknown ones', () => {
  equal(qd.formatTemplate('a {{x}} b {{y}}', { x: '1' }), 'a 1 b {{y}}');
  equal(qd.formatTemplate(undefined, {}), '');
});

check('displayKey() normalizes escape/return labels', () => {
  equal(qd.displayKey('escape'), 'Esc');
  equal(qd.displayKey('Return'), 'Enter');
  equal(qd.displayKey('Ctrl+Escape'), 'Ctrl+Esc');
  equal(qd.displayKey(null), '');
});

check('renderPrompt() uses the localized built-in protocol', () => {
  const prompt = qd.renderPrompt({ defaultPrompt: '', maxSteps: 20, language: 'en' }, 'en');
  truthy(prompt.length > 100, 'localized English prompt should be non-trivial');
  truthy(prompt.includes('20'), 'prompt should contain the step budget');
});

check('renderPrompt() replaces {{MAX_STEPS}} in a custom protocol', () => {
  const prompt = qd.renderPrompt(
    { defaultPrompt: 'Do the task in at most {{MAX_STEPS}} steps.', maxSteps: 12 },
    'zh'
  );
  equal(prompt, 'Do the task in at most 12 steps.');
});

// ---------------------------------------------------------------------------
// Step budget
// ---------------------------------------------------------------------------
check('budgetExceeded() enforces the hard budget', () => {
  equal(qd.budgetExceeded(21, { enforceMaxSteps: true, maxSteps: 20 }), true);
  equal(qd.budgetExceeded(20, { enforceMaxSteps: true, maxSteps: 20 }), false);
  equal(qd.budgetExceeded(999, { enforceMaxSteps: false, maxSteps: 20 }), false);
  equal(qd.budgetExceeded(1.5, { enforceMaxSteps: true, maxSteps: 20 }), false);
});

// ---------------------------------------------------------------------------
// Locale bundles
// ---------------------------------------------------------------------------
check('LOCALES zh/en are present and structurally identical', () => {
  const zh = qd.LOCALES.zh;
  const en = qd.LOCALES.en;
  truthy(zh && en, 'both locales must load');
  equal(typeof zh.prompt, 'string');
  equal(typeof en.prompt, 'string');
  truthy(zh.prompt.length > 0 && en.prompt.length > 0, 'prompts must be non-empty');
  for (const lang of ['zh', 'en']) {
    const meta = qd.LOCALES[lang].meta || {};
    truthy(meta.title && meta.description, `${lang} meta title/description missing`);
    const ui = qd.LOCALES[lang].ui || {};
    for (const key of ['brand', 'placeholder', 'submitHint', 'starting', 'running', 'done', 'stopped', 'error', 'backendMissing']) {
      truthy(typeof ui[key] === 'string' && ui[key].length > 0, `${lang} ui.${key} missing`);
    }
  }
  const zhKeys = Object.keys(qd.LOCALES.zh.ui).sort();
  const enKeys = Object.keys(qd.LOCALES.en.ui).sort();
  equal(zhKeys.join(','), enKeys.join(','));
});

// ---------------------------------------------------------------------------
// Sidecar command line contract (what startSidecar passes to launcher.ps1)
// ---------------------------------------------------------------------------
check('sidecar hotkey values remain representable as CLI arguments', () => {
  const config = qd.readConfig({ hotkey: 'Ctrl+0', submitKey: 'Enter', cancelKey: 'Escape' });
  // launcher.ps1 receives these as -Hotkey/-SubmitKey/-CancelKey. No spaces or
  // quotes may leak into the value itself.
  for (const value of [config.hotkey, config.submitKey, config.cancelKey]) {
    truthy(/^[A-Za-z0-9+]+$/.test(value), `key spec ${JSON.stringify(value)} contains unsupported characters`);
  }
});

if (failures.length > 0) {
  console.error(`FAIL module tests: ${failures.length} failure(s)`);
  process.exit(1);
}

console.log(`PASS module tests: ${passed} checks`);
