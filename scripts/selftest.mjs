// QuickDesk offline self-test: imports the plugin modules only — no DSH, no
// sidecar, no UI. Guards the parts that can be checked without a running
// harness: localized copy parity, language resolution, protocol rendering,
// config budget, budget decision, turn-cancel and desktop-backend detection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getLocale, resolveLanguage, formatTemplate, renderPrompt, readConfig,
  budgetExceeded, displayKey, LOCALES, Config, CONFIG_KEYS, plainVolatileConfig
} from '../quickdesk.mjs';
import { createDshCompat, friendlyTool, isDesktopToolName } from '../compat.mjs';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
  } catch (error) {
    results.push([name, false, error && error.message ? error.message : String(error)]);
  }
}

// --- localized copy --------------------------------------------------------
check('locale: zh and en are loaded', () => {
  assert.ok(LOCALES.zh && LOCALES.en, 'locale files missing');
});
check('locale: both have display metadata', () => {
  for (const lang of ['zh', 'en']) {
    const meta = getLocale(lang).meta;
    assert.ok(meta.title && meta.title.trim(), `${lang} meta.title missing`);
    assert.ok(meta.description && meta.description.trim(), `${lang} meta.description missing`);
  }
});
check('locale: ui key sets match', () => {
  const zh = Object.keys(getLocale('zh').ui).sort();
  const en = Object.keys(getLocale('en').ui).sort();
  assert.deepEqual(en, zh);
});
check('locale: both prompts carry the step placeholder', () => {
  for (const lang of ['zh', 'en']) assert.match(getLocale(lang).prompt, /\{\{MAX_STEPS\}\}/);
});
check('locale: zh prompt keeps the completion-first rules', () => {
  assert.match(getLocale('zh').prompt, /完成即停/);
  assert.match(getLocale('zh').prompt, /禁止复述页面内容/);
  assert.match(getLocale('zh').prompt, /最多 2 张/);
});
check('locale: en prompt keeps the completion-first rules', () => {
  assert.match(getLocale('en').prompt, /Stop when done/);
  assert.match(getLocale('en').prompt, /never restate page content/);
  assert.match(getLocale('en').prompt, /at most 2 per task/);
  assert.match(getLocale('en').prompt, /Google Chrome/);
});

// --- language resolution ---------------------------------------------------
check('language: auto follows a Chinese system locale', () => assert.equal(resolveLanguage({ language: 'auto' }, 'zh-CN'), 'zh'));
check('language: auto falls back to English elsewhere', () => assert.equal(resolveLanguage({ language: 'auto' }, 'de-DE'), 'en'));
check('language: explicit zh wins over an English system', () => assert.equal(resolveLanguage({ language: 'zh' }, 'en-US'), 'zh'));
check('language: explicit en wins over a Chinese system', () => assert.equal(resolveLanguage({ language: 'en' }, 'zh-CN'), 'en'));
check('language: invalid value behaves like auto', () => assert.equal(resolveLanguage({ language: 'fr' }, 'zh-CN'), 'zh'));
check('config: language defaults to auto', () => assert.equal(readConfig({}).language, 'auto'));
check('config: invalid language falls back', () => assert.equal(readConfig({ language: 'fr' }).language, 'auto'));

// --- prompt rendering ------------------------------------------------------
check('render: zh built-in prompt has the budget filled in', () => {
  const prompt = renderPrompt(readConfig({ language: 'zh', maxSteps: 25 }));
  assert.match(prompt, /最多允许 25 步/);
  assert.ok(!prompt.includes('{{MAX_STEPS}}'), 'placeholder left in prompt');
});
check('render: en built-in prompt has the budget filled in', () => {
  const prompt = renderPrompt(readConfig({ language: 'en', maxSteps: 25 }), 'en');
  assert.match(prompt, /at most 25 steps/);
  assert.ok(!prompt.includes('{{MAX_STEPS}}'), 'placeholder left in prompt');
});
check('render: custom defaultPrompt overrides the localized protocol', () => {
  const prompt = renderPrompt(readConfig({ language: 'zh', defaultPrompt: 'budget={{MAX_STEPS}}', maxSteps: 12 }));
  assert.equal(prompt, 'budget=12');
});
check('config: defaultPrompt defaults to empty (built-in protocol)', () => assert.equal(readConfig({}).defaultPrompt, ''));

// --- formatting helpers ----------------------------------------------------
check('format: placeholders replaced', () => assert.equal(formatTemplate('step {{step}}/{{max}}', { step: 3, max: 20 }), 'step 3/20'));
check('format: unknown placeholders kept', () => assert.equal(formatTemplate('a {{x}} b', {}), 'a {{x}} b'));
check('displayKey: Escape shown as Esc', () => assert.equal(displayKey('Escape'), 'Esc'));
check('displayKey: combinations keep their parts', () => assert.equal(displayKey('Ctrl+Return'), 'Ctrl+Enter'));

// --- budget ----------------------------------------------------------------
check('budget: default budget is 20', () => assert.equal(readConfig({}).maxSteps, 20));
check('budget: custom budget is kept', () => assert.equal(readConfig({ maxSteps: 35 }).maxSteps, 35));
check('budget: too small budget falls back', () => assert.equal(readConfig({ maxSteps: 2 }).maxSteps, 20));
check('budget: within budget is not exceeded', () => assert.equal(budgetExceeded(20, readConfig({})), false));
check('budget: first call over budget is exceeded', () => assert.equal(budgetExceeded(21, readConfig({})), true));
check('budget: disabled flag never exceeds', () => assert.equal(budgetExceeded(999, readConfig({ enforceMaxSteps: false })), false));

// --- desktop backend detection --------------------------------------------
check('desktop: long provider names are recognized', () => {
  assert.equal(isDesktopToolName('mcp__wincu__windows_computer_use_list_windows'), true);
  assert.equal(isDesktopToolName('windows_computer_use_screenshot'), true);
});
check('desktop: short names are recognized', () => assert.equal(isDesktopToolName('mcp__wincu__click'), true));
check('desktop: non-desktop tools are ignored', () => {
  assert.equal(isDesktopToolName('pwsh'), false);
  assert.equal(isDesktopToolName('mcp__other__fetch'), false);
});
check('labels: provider prefixes normalize to the short label', () => {
  assert.equal(friendlyTool('mcp__wincu__windows_computer_use_list_windows'), '查找窗口');
  assert.equal(friendlyTool('mcp__wincu__windows_computer_use_screenshot'), '截图');
});
check('compat: hasDesktopTools reads the tools service view', () => {
  const tools = { view: () => ({ visible: new Map([['mcp__wincu__windows_computer_use_list_windows', {}]]) }) };
  const compat = createDshCompat({ get: (name) => name === 'tools' ? tools : undefined }, null);
  assert.equal(compat.hasDesktopTools(), true);
  const empty = createDshCompat({ get: () => undefined }, null);
  assert.equal(empty.hasDesktopTools(), false);
});

// --- cancel path -----------------------------------------------------------
check('cancel: prefers the public agent.cancel with keepInbox', () => {
  const compat = createDshCompat({ get: () => undefined }, null);
  let cancelArgs;
  const agent = { cancel(...args) { cancelArgs = args; } };
  assert.equal(compat.cancelAgent(agent), true);
  assert.deepEqual(cancelArgs[0], { kind: 'user' });
  assert.deepEqual(cancelArgs[1], { keepInbox: true });
});
check('cancel: falls back to sessionController.cancel({ sessionId })', () => {
  let cancelled;
  const compat = createDshCompat({ get: (name) => name === 'sessionController' ? { cancel: (request) => { cancelled = request; } } : undefined }, null);
  assert.equal(compat.cancelAgent({ id: 'agent-1', session: { id: 'session-1' } }), true);
  assert.deepEqual(cancelled, { sessionId: 'session-1' });
});
check('cancel: reports failure when no API exists', () => {
  const compat = createDshCompat({ get: () => undefined }, null);
  assert.equal(compat.cancelAgent({ id: 'agent-2' }), false);
});

// --- settings page schema --------------------------------------------------
check('settings: schema keys match runtime config keys', () => {
  assert.deepEqual([...CONFIG_KEYS].sort(), Object.keys(readConfig({})).sort());
});
check('settings: schema defaults match runtime defaults', () => {
  const base = readConfig({});
  const resolved = plainVolatileConfig(Config({}));
  for (const key of Object.keys(base)) assert.deepEqual(resolved[key], base[key], `default ${key}`);
});
check('settings: every Config field is volatile (DSH form projection)', () => {
  const json = Config.toJSON();
  const root = json.refs[String(json.uid)];
  assert.ok(root && root.dict, 'schema root is not an object');
  for (const [key, ref] of Object.entries(root.dict)) {
    const node = json.refs[String(ref)];
    assert.equal(node && node.meta && node.meta.volatile, true, `field ${key} is not volatile`);
  }
});
check('settings: volatile references unwrap to plain values', () => {
  const wrapped = Config({});
  assert.equal(typeof wrapped.hotkey.get, 'function');
  const plain = plainVolatileConfig(wrapped);
  assert.equal(plain.hotkey, 'Ctrl+Alt+Space');
  assert.equal(plain.maxSteps, 20);
});
check('settings: schema accepts user overrides', () => {
  const resolved = plainVolatileConfig(Config({ hotkey: 'Ctrl+Alt+K', language: 'en', maxSteps: 12, statusEnabled: false }));
  assert.equal(resolved.hotkey, 'Ctrl+Alt+K');
  assert.equal(resolved.language, 'en');
  assert.equal(resolved.maxSteps, 12);
  assert.equal(resolved.statusEnabled, false);
});
check('settings: schema rejects an unknown language', () => assert.throws(() => Config({ language: 'fr' })));
check('settings: schema rejects out-of-range steps', () => assert.throws(() => Config({ maxSteps: 1 })));
check('settings: schema rejects an unknown corner', () => assert.throws(() => Config({ statusCorner: 'center' })));
check('client: settings page registers the quickdesk namespace', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /dsh-quickdesk/);
  assert.match(source, /configForms\.get\('quickdesk'\)/);
  assert.match(source, /settings\.section/);
  assert.match(source, /configForms/);
});

const failed = results.filter(([, ok]) => !ok);
for (const [name, ok, message] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
