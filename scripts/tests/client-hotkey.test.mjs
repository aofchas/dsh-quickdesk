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
const { formatHotkeyEvent, captureHotkeyEvent, isKeySpec } = clientModule.__test;

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
  ['Ctrl+Enter', formatHotkeyEvent(event('Return', { ctrl: true }))],
  ['Shift+Win+X', formatHotkeyEvent(event('x', { shift: true, meta: true }))],
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

const cancelCapture = captureHotkeyEvent(event('Escape', { ctrl: true }));
assert.equal(cancelCapture && cancelCapture.action, 'cancel');
const captured = captureHotkeyEvent(event('k', { ctrl: true, alt: true }));
assert.equal(captured && captured.action, 'set');
assert.equal(captured && captured.value, 'Ctrl+Alt+K');
assert.equal(captureHotkeyEvent(event('Control', { ctrl: true })), null);
assert.equal(captureHotkeyEvent(event('k', { ctrl: true, repeat: true })), null);
assert.equal(captureHotkeyEvent(event('-')), null);

console.log('PASS client hotkey capture formatting');
