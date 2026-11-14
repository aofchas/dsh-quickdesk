// Bilingual GitHub Release notes gate.
//
// Every new version must ship docs/release-notes/<version>.md with both a
// Chinese and an English section. The release workflow uses that file as the
// GitHub Release body, so a missing or monolingual file blocks the release.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const notesPath = join(repoRoot, 'docs', 'release-notes', `${pkg.version}.md`);
const workflowPath = join(repoRoot, '.github', 'workflows', 'release.yml');

assert.ok(existsSync(notesPath), `missing bilingual release notes: docs/release-notes/${pkg.version}.md`);
const notes = readFileSync(notesPath, 'utf8');
assert.match(notes, /##\s*中文/, 'release notes need a Chinese section');
assert.match(notes, /##\s*English/i, 'release notes need an English section');
assert.ok(notes.length > 400, 'release notes are too short');
assert.ok(notes.includes(pkg.version), 'release notes do not mention the package version');

const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
assert.ok(changelog.includes(pkg.version), 'CHANGELOG.md does not mention the package version');

const workflow = readFileSync(workflowPath, 'utf8');
assert.ok(workflow.includes('release-notes'), 'release workflow does not reference docs/release-notes');
assert.ok(workflow.includes('body_path'), 'release workflow does not use body_path for the release notes');

console.log(`PASS bilingual release notes: docs/release-notes/${pkg.version}.md`);
