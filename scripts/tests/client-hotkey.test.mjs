// Pure client-side hotkey capture tests. client.js is a browser module loaded
// through window.__ModuleLoader__; evaluate it with a tiny fake React module so
// the exported pure helpers can be tested without a DOM or DSH runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(resolve(repoRoot, 'client.js'), 'utf8');

let definition;
const fakeReact = { createElement: () => ({}) };
const context = {
  window: { __ModuleLoader__: { load: (loaded) => { definition = loaded; } } },
  console,
  setTimeout,
  clearTimeout
};
vm.runInNewContext(source, context, { filename: 'client.js' });

assert.ok(definition && typeof definition.factory === 'function', 'client module should register a factory');
const clientModule = definition.factory((id) => {
  if (id === 'react') return fakeReact;
  throw new Error(`unexpected client dependency: ${id}`);
});

assert.ok(clientModule.__test, 'client module should expose hotkey capture helpers for tests');
const { formatHotkeyEvent, captureHotkeyEvent, isKeySpec, shortcutWarning, shortcutConflict, canSwapShortcutConflict, swapShortcutValue } = clientModule.__test;

const event = (key, flags = {}) => ({
  key,
  ctrlKey: Boolean(flags.ctrl),
  altKey: Boolean(flags.alt),
  shiftKey: Boolean(flags.shift),
  metaKey: Boolean(flags.meta),
  repeat: Boolean(flags.repeat)
});

const checks = [
  ['Ctrl+Alt+K', formatHotkeyEvent(event('k', { ctrl: true, alt: true }))],
  ['Ctrl+Shift+Space', formatHotkeyEvent(event(' ', { ctrl: true, shift: true }))],
  ['Alt+PageDown', formatHotkeyEvent(event('PageDown', { alt: true }))],
  ['Ctrl+Escape', formatHotkeyEvent(event('Escape', { ctrl: true }))],
  ['Escape', formatHotkeyEvent(event('Escape'))],
  ['Ctrl+Enter', formatHotkeyEvent(event('Return', { ctrl: true }))],
  ['Alt+Shift+PageUp', formatHotkeyEvent(event('PageUp', { shift: true, alt: true }))],
  ['F24', formatHotkeyEvent(event('F24'))],
  ['Ctrl+1', formatHotkeyEvent(event('1', { ctrl: true }))]
];

for (const [expected, actual] of checks) {
  assert.equal(actual, expected);
  assert.equal(isKeySpec(actual), true, `${actual} should pass client validation`);
}

for (const modifier of ['Control', 'Shift', 'Alt', 'Meta', 'OS']) {
  assert.equal(formatHotkeyEvent(event(modifier, { ctrl: true, alt: true, shift: true, meta: true })), null, `${modifier} alone is not a shortcut`);
}
for (const key of ['', 'Dead', 'Unidentified', 'F25', '-']) {
  assert.equal(formatHotkeyEvent(event(key)), null, `${JSON.stringify(key)} should not be captured`);
}

assert.equal(formatHotkeyEvent(event(' ', { ctrl: true, alt: true })), 'Ctrl+Alt+Space');
assert.equal(formatHotkeyEvent(event('Esc', { ctrl: true })), 'Ctrl+Escape');
assert.equal(formatHotkeyEvent(event('a', { ctrl: true })), 'Ctrl+A');
assert.equal(formatHotkeyEvent(event('A', { ctrl: true })), 'Ctrl+A');
assert.equal(formatHotkeyEvent(event('x', { meta: true })), null, 'Win/meta combinations are not supported');
assert.equal(isKeySpec('Win+X'), false, 'Win is no longer an accepted modifier');

const escapeCapture = captureHotkeyEvent(event('Escape', { ctrl: true }));
assert.equal(escapeCapture && escapeCapture.action, 'set');
assert.equal(escapeCapture && escapeCapture.value, 'Ctrl+Escape');
const bareEscapeCapture = captureHotkeyEvent(event('Escape'));
assert.equal(bareEscapeCapture && bareEscapeCapture.action, 'set');
assert.equal(bareEscapeCapture && bareEscapeCapture.value, 'Escape');
const captured = captureHotkeyEvent(event('k', { ctrl: true, alt: true }));
assert.equal(captured && captured.action, 'set');
assert.equal(captured && captured.value, 'Ctrl+Alt+K');
assert.equal(captureHotkeyEvent(event('Control', { ctrl: true })), null);
assert.equal(captureHotkeyEvent(event('k', { ctrl: true, repeat: true })), null);
assert.equal(captureHotkeyEvent(event('-')), null);

const defaults = {
  hotkey: 'Ctrl+Alt+Space',
  submitKey: 'Enter',
  cancelKey: 'Escape',
  approveKey: 'Enter',
  rejectKey: 'Backspace'
};
assert.equal(shortcutConflict(defaults), null, 'defaults, including submit=approve, must not conflict');
assert.equal(canSwapShortcutConflict(shortcutConflict(defaults)), false);

const hotkeyConflict = shortcutConflict({ ...defaults, hotkey: 'Enter', submitKey: 'Enter' });
assert.equal(hotkeyConflict && hotkeyConflict.field, 'hotkey');
assert.equal(hotkeyConflict && hotkeyConflict.otherField, 'submitKey');
assert.equal(canSwapShortcutConflict(hotkeyConflict), false, 'hotkey conflicts cannot be auto-swapped');

const inputConflict = shortcutConflict({ ...defaults, submitKey: 'Ctrl+Shift+K', cancelKey: 'Shift+Ctrl+K' });
assert.equal(inputConflict && inputConflict.field, 'submitKey');
assert.equal(inputConflict && inputConflict.otherField, 'cancelKey');
assert.equal(canSwapShortcutConflict(inputConflict), true);

const approvalConflict = shortcutConflict({ ...defaults, approveKey: 'F9', rejectKey: 'f9' });
assert.equal(approvalConflict && approvalConflict.field, 'approveKey');
assert.equal(approvalConflict && approvalConflict.otherField, 'rejectKey');
assert.equal(canSwapShortcutConflict(approvalConflict), true);

const beforeSwap = { ...defaults, submitKey: 'Ctrl+K', cancelKey: 'Ctrl+K' };
const inputSwap = shortcutConflict(beforeSwap);
const swapped = swapShortcutValue(beforeSwap, inputSwap, 'cancelKey', 'Escape');
assert.equal(swapped.submitKey, 'Escape');
assert.equal(swapped.cancelKey, 'Ctrl+K');
assert.equal(shortcutConflict(swapped), null);
const hotkeyDraft = { ...defaults, hotkey: 'Enter', submitKey: 'Enter' };
assert.equal(swapShortcutValue(hotkeyDraft, hotkeyConflict, 'hotkey', 'Ctrl+Alt+Space'), hotkeyDraft);
assert.equal(swapShortcutValue(beforeSwap, inputSwap, 'cancelKey', 'not a key'), beforeSwap);

assert.equal(shortcutConflict({ ...defaults, cancelKey: 'Backspace' }), null, 'cross-group duplicates are allowed');
assert.equal(shortcutConflict({ ...defaults, submitKey: 'Ctrl+Enter', approveKey: 'Enter' }), null);

assert.equal(shortcutWarning('hotkey', 'A'), 'hotkeySingleKeyWarning');
assert.equal(shortcutWarning('hotkey', '7'), 'hotkeySingleKeyWarning');
assert.equal(shortcutWarning('hotkey', 'F9'), '');
assert.equal(shortcutWarning('hotkey', 'Ctrl+A'), '');
assert.equal(shortcutWarning('submitKey', 'A'), 'actionTypingWarning');
assert.equal(shortcutWarning('submitKey', 'Space'), 'actionTypingWarning');
assert.equal(shortcutWarning('submitKey', 'Enter'), '');
assert.equal(shortcutWarning('cancelKey', 'Escape'), '');
assert.equal(shortcutWarning('approveKey', 'A'), '');
assert.equal(shortcutWarning('rejectKey', 'Backspace'), '');

console.log('PASS client hotkey capture formatting');
