// QuickDesk — configurable global-hotkey desktop assistant for DeepSeek Harness.
//
// Design goals:
//  * everything DSH-version-sensitive is in compat.mjs, nothing from DSH is imported;
//  * nothing from dsh-computer-use-win is imported or assumed beyond "desktop
//    tools exist with some names"; tool labels are normalized generically;
//  * all user-facing copy comes from locale/<language>.json (zh/en), including
//    the desktop task protocol; no UI string is hard-coded in this file;
//  * all shortcuts are configuration in cordis.patch.yml;
//  * the native UI (input box / status HUD / approval popup) is a standalone
//    PowerShell sidecar; it receives its localized strings from this host half.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { createDshCompat, errorText } from './compat.mjs';

export const name = 'quickdesk';

const LANGUAGES = Object.freeze(['zh', 'en']);

// ---------------------------------------------------------------------------
// Localized copy. locale/<lang>.json carries everything a user can read:
// meta title/description (read by DSH Plugin Manager), the native-UI strings,
// the approval popup strings and the default desktop task protocol.
// ---------------------------------------------------------------------------
function loadLocale(language) {
  try {
    return JSON.parse(readFileSync(new URL(`./locale/${language}.json`, import.meta.url), 'utf8'));
  } catch {
    return undefined;
  }
}

export const LOCALES = Object.freeze({
  zh: loadLocale('zh'),
  en: loadLocale('en')
});

function systemLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'en'; }
}

/** Locale bundle for one language, with a safe fallback for a stripped install. */
export function getLocale(language) {
  return LOCALES[language] || LOCALES.zh || LOCALES.en || { meta: {}, ui: {}, prompt: '' };
}

/** `language: auto` follows the OS locale; explicit zh/en always wins. */
export function resolveLanguage(config, locale = systemLocale()) {
  const explicit = config && config.language;
  if (LANGUAGES.includes(explicit)) return explicit;
  return /^zh/i.test(String(locale || '')) ? 'zh' : 'en';
}

/** Fill `{{name}}` placeholders; unknown placeholders are kept verbatim. */
export function formatTemplate(template, values) {
  return String(template === undefined || template === null ? '' : template)
    .replace(/\{\{(\w+)\}\}/g, (match, key) => values && values[key] !== undefined ? String(values[key]) : match);
}

const DEFAULTS = {
  hotkey: 'Ctrl+Alt+Space',
  submitKey: 'Enter',
  cancelKey: 'Escape',
  approveKey: 'Enter',
  rejectKey: 'Backspace',
  statusCorner: 'top-right',
  statusEnabled: true,
  statusLingerMs: 20000,
  workspaceDirectory: '',
  language: 'auto',
  // Empty = the built-in localized protocol from locale/<language>.json.
  // A non-empty value replaces it and may use the {{MAX_STEPS}} placeholder.
  defaultPrompt: '',
  // Hard budget: after this many tool calls QuickDesk cancels the turn instead
  // of letting the model keep verifying/summarizing a task that is already done.
  maxSteps: 20,
  enforceMaxSteps: true,
  approvalPopup: true,
  popupTimeoutMs: 120000,
  autoPresetNewSessions: true,
  autoPresetName: 'auto',
  // Best-effort host-side setting write; off by default so installing QuickDesk
  // never changes another plugin's UI unless the user opts in. The client half
  // was removed in 1.1.0: a client module cannot see this config and used to
  // write those fields unconditionally.
  disableComputerUseUi: false,
  // Diagnostics bridge: the settings page writes a new request token, the Host
  // runs scripts/collect-diagnostics.ps1 (native Save-As dialog) and publishes
  // progress/result through these volatile fields. No separate client-to-host
  // RPC is needed; the normal settings save path is the carrier.
  diagnosticsRequest: ''
};

// DSH Settings → Plugins reads this Config schema and serves the values as the
// `quickdesk` settings namespace; saving a field writes it back to the profile
// patch through the config editor, so users no longer edit YAML by hand. The
// companion client.js renders the QuickDesk page from that namespace.
const ConfigFields = {
  hotkey: z.string().default(DEFAULTS.hotkey)
    .description('呼出输入框的快捷键 / Hotkey to summon the input box'),
  submitKey: z.string().default(DEFAULTS.submitKey)
    .description('提交任务的按键 / Key to submit the task'),
  cancelKey: z.string().default(DEFAULTS.cancelKey)
    .description('关闭输入框的按键 / Key to close the input box'),
  approveKey: z.string().default(DEFAULTS.approveKey)
    .description('审批通过的按键 / Key to approve'),
  rejectKey: z.string().default(DEFAULTS.rejectKey)
    .description('审批拒绝的按键 / Key to reject'),
  language: z.union([z.const('auto'), z.const('zh'), z.const('en')]).default(DEFAULTS.language)
    .description('界面与任务协议语言：auto 跟随系统 / UI and task-protocol language: auto follows the system'),
  statusCorner: z.union([
    z.const('top-right'), z.const('top-left'), z.const('bottom-right'), z.const('bottom-left')
  ]).default(DEFAULTS.statusCorner)
    .description('状态浮窗位置 / Status HUD corner'),
  statusEnabled: z.boolean().default(DEFAULTS.statusEnabled)
    .description('显示单行状态浮窗 / Show the one-line status HUD'),
  statusLingerMs: z.number().min(1000).max(3600000).default(DEFAULTS.statusLingerMs)
    .description('任务结束后状态保留时长（毫秒）/ How long the final status stays (ms)'),
  workspaceDirectory: z.string().default(DEFAULTS.workspaceDirectory)
    .description('新会话工作目录；空 = DSH 默认工作区 / Workspace for new sessions; empty = DSH default'),
  defaultPrompt: z.string().default(DEFAULTS.defaultPrompt)
    .description('自定义任务协议；空 = 内置本地化协议，可用 {{MAX_STEPS}} / Custom protocol; empty = built-in localized protocol'),
  maxSteps: z.number().min(5).max(200).default(DEFAULTS.maxSteps)
    .description('单个任务的工具调用步数上限，超限取消本轮 / Tool-call step budget per task; the turn is cancelled beyond it'),
  enforceMaxSteps: z.boolean().default(DEFAULTS.enforceMaxSteps)
    .description('强制执行步数上限 / Enforce the step budget'),
  approvalPopup: z.boolean().default(DEFAULTS.approvalPopup)
    .description('用 QuickDesk 弹窗接管审批 / Handle approvals with the QuickDesk popup'),
  popupTimeoutMs: z.number().min(5000).max(600000).default(DEFAULTS.popupTimeoutMs)
    .description('审批超时自动拒绝（毫秒）/ Auto-reject an approval after this timeout (ms)'),
  autoPresetNewSessions: z.boolean().default(DEFAULTS.autoPresetNewSessions)
    .description('新会话自动套用 Auto review 预设 / Apply the Auto review preset to new sessions'),
  autoPresetName: z.string().default(DEFAULTS.autoPresetName)
    .description('自动套用的权限预设名 / Permission preset name to apply'),
  disableComputerUseUi: z.boolean().default(DEFAULTS.disableComputerUseUi)
    .description('可选：让 DSH 设置服务尝试关闭 computer-use 的浮窗/接管提示 / Optional: ask DSH settings to turn off the computer-use overlay'),
  diagnosticsRequest: z.string().default(DEFAULTS.diagnosticsRequest)
    .description('诊断请求令牌（由设置页按钮写入，请勿手改）/ Diagnostics request token written by the settings-page button')
};

/** DSH settings forms only project `volatile` fields; some loaders' schemastery
 * lacks the `.volatile()` convenience, so fall back to the metadata flag. */
function volatileField(field) {
  return typeof field.volatile === 'function' ? field.volatile() : field.extra('volatile', true);
}

/** DSH Settings page schema (also validates the row config on activation).
 * Every field is volatile so the settings service serves the whole form and the
 * Host can apply edits live; the values are the Loader's volatile references. */
export const Config = z.object(Object.fromEntries(
  Object.entries(ConfigFields).map(([key, field]) => [key, volatileField(field)])
));

/** Keys of the editable settings page, in form order. */
export const CONFIG_KEYS = Object.freeze(Object.keys(ConfigFields));

/** Read one plain value from a possibly-volatile Loader value. */
function volatileValue(value) {
  try {
    if (value && typeof value.get === 'function' && !Array.isArray(value)) return value.get();
  } catch { /* fall through to the plain value */ }
  return value;
}

/** Unwrap the volatile references the Loader hands to `apply(ctx, config)`. */
export function plainVolatileConfig(raw) {
  const result = {};
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULTS)) result[key] = volatileValue(raw[key]);
  }
  return result;
}

export function readConfig(raw) {
  const config = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      if (raw[key] !== undefined && raw[key] !== null) config[key] = raw[key];
    }
  }
  for (const key of ['hotkey', 'submitKey', 'cancelKey', 'approveKey', 'rejectKey']) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') config[key] = DEFAULTS[key];
  }
  if (!['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(config.statusCorner)) config.statusCorner = DEFAULTS.statusCorner;
  if (typeof config.statusEnabled !== 'boolean') config.statusEnabled = DEFAULTS.statusEnabled;
  if (!Number.isFinite(config.statusLingerMs) || config.statusLingerMs < 1000) config.statusLingerMs = DEFAULTS.statusLingerMs;
  if (!LANGUAGES.includes(config.language) && config.language !== 'auto') config.language = DEFAULTS.language;
  if (typeof config.defaultPrompt !== 'string') config.defaultPrompt = DEFAULTS.defaultPrompt;
  if (!Number.isInteger(config.maxSteps) || config.maxSteps < 5 || config.maxSteps > 200) config.maxSteps = DEFAULTS.maxSteps;
  if (typeof config.enforceMaxSteps !== 'boolean') config.enforceMaxSteps = DEFAULTS.enforceMaxSteps;
  if (typeof config.approvalPopup !== 'boolean') config.approvalPopup = DEFAULTS.approvalPopup;
  if (!Number.isFinite(config.popupTimeoutMs) || config.popupTimeoutMs < 5000) config.popupTimeoutMs = DEFAULTS.popupTimeoutMs;
  if (typeof config.autoPresetNewSessions !== 'boolean') config.autoPresetNewSessions = DEFAULTS.autoPresetNewSessions;
  if (typeof config.disableComputerUseUi !== 'boolean') config.disableComputerUseUi = DEFAULTS.disableComputerUseUi;
  if (typeof config.autoPresetName !== 'string' || config.autoPresetName === '') config.autoPresetName = DEFAULTS.autoPresetName;
  if (typeof config.workspaceDirectory !== 'string') config.workspaceDirectory = DEFAULTS.workspaceDirectory;
  if (typeof config.diagnosticsRequest !== 'string') config.diagnosticsRequest = DEFAULTS.diagnosticsRequest;
  return config;
}

/** The task protocol actually prepended to a task (localized by default). */
export function renderPrompt(config, language) {
  const lang = language || resolveLanguage(config);
  const locale = getLocale(lang);
  const custom = typeof config.defaultPrompt === 'string' ? config.defaultPrompt : '';
  const template = custom.trim() === '' ? (locale.prompt || '') : custom;
  return String(template).replace(/\{\{MAX_STEPS\}\}/g, String(config.maxSteps));
}

/** Whether the tracked tool-call count has passed the configured budget. */
export function budgetExceeded(steps, config) {
  return config.enforceMaxSteps === true && Number.isInteger(steps) && steps > config.maxSteps;
}

/** Keyboard label shown inside localized copy (`Escape` → `Esc`). */
export function displayKey(value) {
  return String(value === undefined || value === null ? '' : value)
    .split('+')
    .map((part) => {
      const piece = part.trim();
      if (/^escape$/i.test(piece)) return 'Esc';
      if (/^return$/i.test(piece)) return 'Enter';
      return piece;
    })
    .join('+');
}

function b64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

export function apply(ctx, rawConfig) {
  const config = readConfig(plainVolatileConfig(rawConfig));
  let language = resolveLanguage(config);
  let locale = getLocale(language);
  const log = ctx.logger('quickdesk');
  const compat = createDshCompat(ctx, log);
  const launcherPath = fileURLToPath(new URL('./scripts/launcher.ps1', import.meta.url));
  const approvalPath = fileURLToPath(new URL('./scripts/approval-popup.ps1', import.meta.url));

  // Announce the settings page: auto:false tells DSH not to generate a second
  // generic page for this Config; client.js registers the QuickDesk page and
  // reads/writes this `quickdesk` namespace.
  try {
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
  } catch (error) {
    log.warn('QuickDesk: settings presentation not registered (%s)', errorText(error));
  }

  function text(key, values) {
    const template = locale && locale.ui ? locale.ui[key] : undefined;
    return formatTemplate(template === undefined ? key : template, values || {});
  }

  // ---------------------------------------------------------------------
  // Native sidecar: hotkey + translucent input box + one-line status HUD.
  // All visible copy is passed in already localized.
  // ---------------------------------------------------------------------
  let sidecar = null;
  let sidecarBuffer = '';
  const tracked = new Map();

  function sendStatus(message, hideMs) {
    if (!config.statusEnabled || !sidecar || sidecar.killed || !sidecar.stdin.writable) return;
    try { sidecar.stdin.write(`status|${b64(message)}|${Math.max(0, hideMs | 0)}\n`); } catch { /* sidecar gone */ }
  }

  function startSidecar() {
    try {
      sidecar = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
        '-File', launcherPath,
        '-Hotkey', config.hotkey,
        '-StatusCorner', config.statusCorner,
        '-SubmitKey', config.submitKey,
        '-CancelKey', config.cancelKey,
        '-UiBrand', b64(text('brand')),
        '-UiPlaceholder', b64(text('placeholder')),
        '-UiHint', b64(text('submitHint', { submit: displayKey(config.submitKey), cancel: displayKey(config.cancelKey) }))
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      log.warn('QuickDesk: launcher sidecar could not start (%s)', errorText(error));
      return;
    }
    const child = sidecar;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      sidecarBuffer += chunk;
      for (;;) {
        const at = sidecarBuffer.indexOf('\n');
        if (at < 0) break;
        const line = sidecarBuffer.slice(0, at).trim();
        sidecarBuffer = sidecarBuffer.slice(at + 1);
        if (!line) continue;
        if (line === 'ready') {
          log.info('QuickDesk ready (hotkey %s, language %s)', config.hotkey, language);
        } else if (line.startsWith('submit|')) {
          let raw = '';
          try { raw = Buffer.from(line.slice('submit|'.length), 'base64').toString('utf8'); } catch { /* ignore */ }
          raw = raw.trim();
          if (raw) launchTask(raw).catch((error) => {
            log.warn('QuickDesk: launch failed (%s)', errorText(error));
            sendStatus(text('launchFailed', { error: errorText(error) }), 15000);
          });
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) log.warn('QuickDesk sidecar: %s', message);
    });
    child.once('close', (code) => {
      log.warn('QuickDesk sidecar exited with %s', String(code));
      if (sidecar === child) sidecar = null;
    });
  }

  /** Stop the launcher sidecar (used by disposal and live hotkey/HUD changes). */
  function stopSidecar() {
    const child = sidecar;
    sidecar = null;
    sidecarBuffer = '';
    if (!child) return;
    try { child.stdin.write('quit\n'); } catch { /* ignore */ }
    try { child.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { try { if (!child.killed) child.kill(); } catch { /* ignore */ } }, 1500);
  }

  /**
   * Refuse to start a task when no computer-use provider is installed: the
   * task would load, call no desktop tools and fail after spending tokens.
   * The check retries briefly because MCP servers can finish connecting after
   * the profile becomes ready.
   */
  async function ensureDesktopBackend() {
    if (compat.hasDesktopTools()) return { ok: true };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (compat.hasDesktopTools()) return { ok: true };
    }
    return { ok: false };
  }

  async function launchTask(raw) {
    const backend = await ensureDesktopBackend();
    if (!backend.ok) {
      sendStatus(text('backendMissing'), config.statusLingerMs);
      log.warn('QuickDesk: no desktop computer-use tools are registered; task not submitted (install dsh-computer-use-win or another desktop MCP provider)');
      return;
    }
    sendStatus(text('starting'), 6000);
    const { sessionId } = await compat.submitTask({ ...config, defaultPrompt: renderPrompt(config, language) }, raw);
    tracked.set(String(sessionId), { startedAt: Date.now(), steps: 0, done: false });
    sendStatus(text('running', { step: 0, max: config.maxSteps, action: text('bootAction') }), 8000);
    log.info('QuickDesk: task submitted to session %s (language %s, budget %d steps)', String(sessionId), language, config.maxSteps);
  }

  function markDone(sessionId, outcome) {
    const state = tracked.get(String(sessionId));
    if (!state || state.done) return;
    state.done = true;
    const seconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
    const values = { steps: state.steps, seconds };
    if (outcome === 'error') sendStatus(text('error', values), config.statusLingerMs);
    else if (outcome === 'stopped') sendStatus(text('stopped', values), config.statusLingerMs);
    else sendStatus(text('done', values), config.statusLingerMs);
  }

  startSidecar();

  // DSH projects only volatile Config fields into the settings page and commits
  // edits to the Loader entry options without remounting this plugin. Poll that
  // committed config (same pattern as dsh-computer-use-win) and apply changes
  // live: most fields are read on demand, hotkey/HUD changes restart the sidecar.
  let lastConfigKey = JSON.stringify(config);
  const readCommittedConfig = () => {
    try {
      const entry = ctx.fiber && ctx.fiber.entry;
      const options = entry && entry.options;
      const committed = options && options.config;
      if (!committed || typeof committed !== 'object') return undefined;
      return readConfig({ ...plainVolatileConfig(rawConfig), ...plainVolatileConfig(committed) });
    } catch (error) {
      log.debug && log.debug('QuickDesk: cannot read committed config (%s)', errorText(error));
      return undefined;
    }
  };
  // -----------------------------------------------------------------
  // Diagnostics bridge (settings page button -> Host -> collector script).
  // The client cannot call arbitrary Host methods, so it writes a request
  // token through the normal settings save path; the watcher below runs the
  // collector. Progress and completion are surfaced through the HUD and by
  // opening the report folder; no additional config state is persisted.
  // -----------------------------------------------------------------
  let diagnosticsBusy = false;

  function revealReport(reportPath) {
    if (!reportPath) return;
    try {
      const child = spawn('explorer.exe', ['/select,' + reportPath], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch { /* revealing the report is best effort */ }
  }

  async function runDiagnostics() {
    if (diagnosticsBusy) return;
    diagnosticsBusy = true;
    try {
      sendStatus(text('diagnosticsRunning'), 10000);
      log.info('QuickDesk: diagnostics collector started');

      const collectorPath = fileURLToPath(new URL('./scripts/collect-diagnostics.ps1', import.meta.url));
      if (!existsSync(collectorPath)) throw new Error('collect-diagnostics.ps1 is missing from the installed package');
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
        '-File', collectorPath
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const exitCode = await new Promise((resolve) => {
        child.once('error', (error) => {
          stderr += '\n' + errorText(error);
          resolve(-1);
        });
        child.once('close', (code) => resolve(code === null ? -1 : code));
      });

      const marker = 'QUICKDESK_DIAGNOSTICS_JSON: ';
      const markerLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith(marker))
        .pop();
      let result = null;
      if (markerLine) {
        try { result = JSON.parse(markerLine.slice(marker.length)); } catch { result = null; }
      }
      const ok = Boolean(result && result.ok === true);
      const canceled = Boolean(result && result.canceled === true);
      let status;
      if (ok) {
        status = text('diagnosticsDone', { path: (result && result.zip) || '' });
        sendStatus(status, config.statusLingerMs);
        log.info('QuickDesk: diagnostics report saved to %s', (result && result.zip) || '(unknown)');
        revealReport(result && result.zip);
      } else if (canceled) {
        status = text('diagnosticsCanceled');
        sendStatus(status, 8000);
        log.info('QuickDesk: diagnostics canceled by the user');
      } else {
        const stderrTail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
        const reason = (result && result.error) || stderrTail || ('collector exit code ' + exitCode);
        status = text('diagnosticsFailed', { error: reason });
        sendStatus(status, 15000);
        log.warn('QuickDesk: diagnostics failed (%s)', reason);
      }
    } catch (error) {
      const message = errorText(error);
      log.warn('QuickDesk: diagnostics could not start (%s)', message);
      sendStatus(text('diagnosticsFailed', { error: message }), 15000);
    } finally {
      diagnosticsBusy = false;
    }
  }

  const applyLiveConfig = (next) => {
    const previous = { ...config };
    Object.assign(config, next);
    const nextLanguage = resolveLanguage(config);
    const languageChanged = nextLanguage !== language;
    if (languageChanged) {
      language = nextLanguage;
      locale = getLocale(language);
    }
    const restart = languageChanged || ['hotkey', 'submitKey', 'cancelKey', 'statusCorner']
      .some((key) => previous[key] !== config[key]);
    if (restart) {
      stopSidecar();
      startSidecar();
    }
    const diagnosticsRequested = String(previous.diagnosticsRequest || '') !== String(config.diagnosticsRequest || '') &&
      String(config.diagnosticsRequest || '').trim() !== '';
    if (diagnosticsRequested) {
      runDiagnostics().catch((error) => log.warn('QuickDesk: diagnostics task failed (%s)', errorText(error)));
    }
    log.info('QuickDesk: settings updated live%s', restart ? ' (hotkey/HUD sidecar restarted)' : '');
  };
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        const next = readCommittedConfig();
        if (!next) return;
        const key = JSON.stringify(next);
        if (key === lastConfigKey) return;
        lastConfigKey = key;
        applyLiveConfig(next);
      } catch (error) {
        log.warn('QuickDesk: live settings update failed (%s)', errorText(error));
      }
    }, 500);
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'QuickDesk settings watcher');

  // Optional best-effort: turn off computer-use-win's own overlay / takeover
  // indicator / mouse tag through DSH's settings service. Off by default so a
  // fresh install never mutates another plugin's configuration silently; the
  // current DSH HMR may reject this write inside activation, which is only a
  // warning (the computer-use settings page can do the same manually).
  if (config.disableComputerUseUi) {
    const overlayFields = ['progressOverlayEnabled', 'indicatorEnabled', 'cursorIndicatorEnabled'];
    setTimeout(() => {
      compat.disableComputerUseUi(overlayFields).then((result) => {
        if (result && result.ok) {
          log.info('QuickDesk: computer-use overlay/indicator UI disabled (%s)', result.already ? 'already off' : (result.fields || []).join(', '));
        } else {
          log.warn('QuickDesk: could not disable computer-use overlay/indicator UI (%s)', result && result.reason ? result.reason : 'unknown');
          sendStatus(text('overlayHint'), 8000);
        }
      }).catch((error) => log.warn('QuickDesk: overlay guard failed (%s)', errorText(error)));
    }, 1500);
  }

  ctx.effect(() => stopSidecar, 'QuickDesk sidecar');

  const offPre = compat.on('tools/pre-execute', async (exec, next) => {
    try {
      const agentId = exec && exec.agent && exec.agent.id;
      const state = agentId === undefined ? undefined : tracked.get(String(agentId));
      if (state && !state.done) {
        state.steps += 1;
        if (budgetExceeded(state.steps, config)) {
          // Stop the whole turn instead of the tool only: without this the
          // model keeps calling tools after a finished task just to summarize.
          state.done = true;
          const cancelled = compat.cancelAgent(exec.agent);
          sendStatus(text('budgetStop', { max: config.maxSteps, cancel: cancelled ? 'cancelled' : 'not-cancelled' }), config.statusLingerMs);
          log.warn('QuickDesk: step budget exceeded for session %s (limit %d); cancelling turn (%s)', String(agentId), config.maxSteps, cancelled ? 'ok' : 'no api');
        } else {
          sendStatus(text('running', { step: state.steps, max: config.maxSteps, action: compat.friendlyTool(exec.name) }), 8000);
        }
      }
    } catch { /* never affect the tool pipeline */ }
    return next();
  });
  ctx.effect(() => offPre, 'QuickDesk tool status');

  const offStatus = compat.on('agent/status', ({ agent, status }) => {
    try {
      const id = agent && agent.id;
      if (id === undefined) return;
      const state = tracked.get(String(id));
      if (!state || state.done) return;
      if (status === 'running') sendStatus(text('runningPlain', { step: state.steps, max: config.maxSteps }), 8000);
      else if (status === 'idle') markDone(id, 'done');
    } catch { /* ignore */ }
  });
  ctx.effect(() => offStatus, 'QuickDesk agent status');

  const offError = compat.on('agent/error', ({ agent }) => {
    try {
      const id = agent && agent.id;
      if (id !== undefined) markDone(id, 'error');
    } catch { /* ignore */ }
  });
  ctx.effect(() => offError, 'QuickDesk agent error');

  // ---------------------------------------------------------------------
  // Approval popup; optional when the approval service or event is absent.
  // ---------------------------------------------------------------------
  function chooseDisplay(request) {
    const display = request.displayReason;
    if (display && typeof display === 'object') {
      const preferred = display[language] || display.zh || display.en;
      if (typeof preferred === 'string' && preferred.trim()) return preferred;
    }
    if (typeof request.reason === 'string' && request.reason.trim()) return request.reason;
    return text('approvalDefaultReason');
  }

  function askPopup(request) {
    return new Promise((resolve) => {
      let settled = false;
      let child;
      const settle = (decision) => {
        if (settled) return;
        settled = true;
        if (child && child.exitCode === null) { try { child.kill(); } catch { /* ignore */ } }
        resolve(decision);
      };
      const payload = Buffer.from(JSON.stringify({
        toolName: request.toolName,
        display: chooseDisplay(request),
        timeoutMs: config.popupTimeoutMs,
        approveKey: config.approveKey,
        rejectKey: config.rejectKey,
        strings: {
          formTitle: text('approvalFormTitle'),
          title: text('approvalTitle'),
          hint: text('approvalHint', { approve: displayKey(config.approveKey), reject: displayKey(config.rejectKey) }),
          approve: text('approvalApprove', { key: displayKey(config.approveKey) }),
          reject: text('approvalReject', { key: displayKey(config.rejectKey) })
        }
      }), 'utf8').toString('base64');
      try {
        child = spawn('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
          '-File', approvalPath, '-Payload', payload
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        log.warn('QuickDesk: approval popup could not start (%s)', errorText(error));
        settle('rejected');
        return;
      }
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      const fallbackTimer = setTimeout(() => { log.warn('QuickDesk: approval popup timed out'); settle('rejected'); }, config.popupTimeoutMs + 15000);
      child.once('error', (error) => {
        clearTimeout(fallbackTimer);
        log.warn('QuickDesk: approval popup failed (%s)', errorText(error));
        settle('rejected');
      });
      child.once('close', (code) => {
        clearTimeout(fallbackTimer);
        if (settled) return;
        let decision = 'rejected';
        try {
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          if (last && last.decision === 'allow') decision = 'allowed-once';
        } catch {
          if (stderr.trim()) log.warn('QuickDesk: approval popup exited with %s (%s)', String(code), stderr.trim());
        }
        settle(decision);
      });
      if (request.signal && typeof request.signal.addEventListener === 'function') {
        if (request.signal.aborted) { settle('cancelled'); return; }
        request.signal.addEventListener('abort', () => settle('cancelled'), { once: true });
      }
    });
  }

  if (config.approvalPopup && compat.hasService('approval')) {
    const offAnswerer = compat.on('approval/request', async (request) => {
      const decision = await askPopup(request);
      log.info('QuickDesk: approval %s for %s', decision, request.toolName);
      return decision;
    }, { prepend: true });
    ctx.effect(() => offAnswerer, 'QuickDesk approval popup');
  }

  // ---------------------------------------------------------------------
  // Optional Auto review preset for new root sessions.
  // ---------------------------------------------------------------------
  if (config.autoPresetNewSessions && compat.hasService('permissionPresets')) {
    const offCreated = compat.on('agent/created', ({ agent }) => {
      setTimeout(() => compat.applyAutoPreset(agent, config), 0).unref?.();
    });
    ctx.effect(() => offCreated, 'QuickDesk Auto review default');
  }

  // One informational line, not a failure: the plugin outside DSH stays usable.
  if (!compat.hasService('sessionController')) {
    log.warn('QuickDesk: sessionController is missing in this DSH profile; the hotkey UI runs, but submitting a task will report a compatibility error. See COMPATIBILITY.md.');
  }
}
