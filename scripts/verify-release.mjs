// Release gate for QuickDesk: validates everything the npm package and the DSH
// plugin market require, without touching the network.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push([name, true, detail]);
  } catch (error) {
    checks.push([name, false, error && error.message ? error.message : String(error)]);
    failures.push(name);
  }
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const required = [
  'quickdesk.mjs',
  'client.js',
  'compat.mjs',
  'cordis.patch.yml',
  'scripts/launcher.ps1',
  'scripts/approval-popup.ps1',
  'locale/zh.json',
  'locale/en.json',
  'icon.svg',
  'README.md',
  'COMPATIBILITY.md',
  'LICENSE'
];

check('package name', () => {
  if (manifest.name !== 'dsh-quickdesk') throw new Error(`unexpected name ${manifest.name}`);
  return manifest.name;
});
check('version is semver', () => {
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`bad version ${manifest.version}`);
  return manifest.version;
});
check('publishable (no private flag)', () => {
  if (manifest.private === true) throw new Error('package.json still sets private:true');
  return 'ok';
});
check('license declared', () => {
  if (manifest.license !== 'MIT') throw new Error('expected MIT license');
  if (!existsSync(new URL('../LICENSE', import.meta.url))) throw new Error('LICENSE file missing');
  return 'MIT';
});
check('repository metadata', () => {
  const url = manifest.repository && (manifest.repository.url || manifest.repository);
  if (!url || !url.includes('github.com/aofchas/dsh-quickdesk')) throw new Error('repository name does not match the planned repo');
  if (!manifest.homepage || !manifest.bugs || !manifest.bugs.url) throw new Error('homepage/bugs missing');
  return url;
});
check('runtime platform', () => {
  if (!Array.isArray(manifest.os) || !manifest.os.includes('win32')) throw new Error('os must include win32');
  if (!manifest.engines || !manifest.engines.node) throw new Error('engines.node missing');
  if (!manifest.engines.dsh) throw new Error('engines.dsh missing');
  return `${manifest.engines.node} | dsh ${manifest.engines.dsh}`;
});
check('DSH bundle + client manifest', () => {
  if (!manifest.dsh || !manifest.dsh.bundle || manifest.dsh.bundle.patch !== './cordis.patch.yml') throw new Error('dsh.bundle.patch missing');
  const client = manifest.dsh.client || {};
  if (client.platform !== 'web') throw new Error('dsh.client.platform must be web');
  if (!Array.isArray(client.inject) || !client.inject.includes('@deepseek-ai/dsh-client-ui-settings')) throw new Error('dsh.client.inject is missing the settings client package');
  return 'bundle + client';
});
check('required files exist', () => {
  for (const relative of required) {
    if (!existsSync(new URL(`../${relative}`, import.meta.url))) throw new Error(`missing ${relative}`);
  }
  return `${required.length} files`;
});
check('files whitelist covers the runtime', () => {
  const files = manifest.files || [];
  for (const relative of ['quickdesk.mjs', 'client.js', 'compat.mjs', 'cordis.patch.yml', 'scripts/launcher.ps1', 'scripts/approval-popup.ps1', 'locale/*.json', 'icon.svg']) {
    if (!files.includes(relative)) throw new Error(`files is missing ${relative}`);
  }
  return `${files.length} patterns`;
});
check('locale metadata', () => {
  for (const language of ['zh', 'en']) {
    const locale = JSON.parse(read(`locale/${language}.json`));
    if (!locale.meta || !locale.meta.title || !locale.meta.description) throw new Error(`${language} meta missing`);
    if (!locale.prompt || !locale.prompt.includes('{{MAX_STEPS}}')) throw new Error(`${language} prompt missing the budget placeholder`);
  }
  return 'zh/en';
});
check('README install command for the market', () => {
  const readme = read('README.md');
  if (!readme.includes('dsh plugin --profile web add dsh-quickdesk')) throw new Error('README must show the npm install command');
  return 'ok';
});
check('bilingual README', () => {
  const zh = read('README.md');
  const en = read('README.en.md');
  if (!zh.includes('README.en.md')) throw new Error('README.md is missing the link to README.en.md');
  if (!en.includes('README.md')) throw new Error('README.en.md is missing the link to README.md');
  if (!en.includes('dsh plugin --profile web add dsh-quickdesk')) throw new Error('README.en.md is missing the npm install command');
  return 'zh/en';
});
check('README first screen states platform and backend requirement', () => {
  for (const file of ['README.md', 'README.en.md']) {
    const head = read(file).slice(0, 3000);
    if (!/Windows/i.test(head)) throw new Error(`${file}: first screen does not say Windows-only`);
    if (!head.includes('dsh-computer-use-win')) throw new Error(`${file}: first screen does not name the required backend plugin`);
  }
  return 'platform + backend';
});
check('dsh-plugin.org listing badge', () => {
  for (const file of ['README.md', 'README.en.md']) {
    const text = read(file);
    if (!text.includes('https://dsh-plugin.org/badges/listed.svg')) throw new Error(`${file}: listing badge missing`);
    if (!text.includes('https://dsh-plugin.org/plugins/aofchas/dsh-quickdesk')) throw new Error(`${file}: listing link missing`);
  }
  return 'listed';
});
check('no packed distributions are published', () => {
  const files = manifest.files || [];
  for (const pattern of files) if (pattern.endsWith('.tgz')) throw new Error(`files includes ${pattern}`);
  return 'ok';
});

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}
console.log(`\n${checks.length - failures.length}/${checks.length} release checks passed`);
if (failures.length > 0) process.exit(1);
