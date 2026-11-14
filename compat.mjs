// QuickDesk compatibility layer.
//
// Every DSH-version-sensitive call lives in this file. QuickDesk deliberately
// imports nothing from DSH and nothing from dsh-computer-use-win:
//
//  * DSH services are looked up dynamically (`ctx.get`), never injected, so a
//    profile that renames or drops one keeps the plugin loaded.
//  * Missing services degrade to a status message instead of a failed plugin.
//  * Only one DSH core entry point creates a task: `sessionController.create`
//    plus `sessionController.prompt`. If a DSH upgrade changes that API, this
//    file is the only place to adapt (see COMPATIBILITY.md).
//  * Tool names from any computer-use provider are normalized generically by
//    stripping an `mcp__<server>__` prefix; no plugin-specific import exists.
import { randomUUID } from 'node:crypto';

export const TESTED_WITH = Object.freeze({
  dsh: '0.2.2-rc.3',
  quickdesk: '1.2.3',
  computerUsePlugin: 'dsh-computer-use-win 0.5.6 (optional; not imported)'
});

const MESSAGE_LIMIT = 400;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorText(error) {
  const text = error && error.message ? String(error.message) : String(error);
  return text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) + '…' : text;
}

const TOOL_LABELS = Object.freeze({
  snapshot: '观察屏幕', accessibility_tree: '读取界面', find: '查找控件', list_windows: '查找窗口',
  click: '点击', double_click: '双击', type_text: '输入文字', keypress: '按键', scroll: '滚动',
  screenshot: '截图', ocr: '识别文字', wait: '等待', wait_for: '等待', launch_app: '启动程序',
  activate_window: '切换窗口', set_value: '填写控件', invoke: '操作控件', focus: '聚焦', move: '移动鼠标',
  drag: '拖动', element_info: '读取控件', close_window: '关闭窗口', move_window: '移动窗口',
  batch: '执行一组操作', tools: '查看工具'
});

/** Strip an `mcp__<server>__` prefix and any provider prefix before a known tool name. */
function knownToolKey(raw) {
  const short = String(raw === undefined || raw === null ? '' : raw).replace(/^mcp__[^_]+__/, '');
  if (short in TOOL_LABELS) return short;
  for (const key of Object.keys(TOOL_LABELS)) {
    if (short.endsWith('_' + key)) return key;
  }
  return short;
}

/** Turn any provider's tool name into a short one-line label. */
export function friendlyTool(toolName) {
  const raw = String(toolName || '工具');
  const short = knownToolKey(raw);
  return TOOL_LABELS[short] || short;
}

// Tool names a Windows computer-use provider exposes. QuickDesk checks these
// names only to avoid starting a task that has no desktop backend at all; the
// plugin still works with any provider that registers a recognizable subset.
const DESKTOP_TOOL_NAMES = Object.freeze(new Set([
  'health', 'snapshot', 'accessibility_tree', 'list_windows', 'find', 'element_info',
  'click', 'double_click', 'move', 'drag', 'scroll', 'type_text', 'keypress', 'focus',
  'invoke', 'set_value', 'activate_window', 'wait', 'ocr', 'screenshot', 'wait_for',
  'close_window', 'move_window', 'launch_app', 'batch'
]));

/** Whether an MCP/exposed tool name looks like a desktop-automation tool. */
export function isDesktopToolName(name) {
  const short = String(name === undefined || name === null ? '' : name).replace(/^mcp__[^_]+__/, '');
  if (DESKTOP_TOOL_NAMES.has(short)) return true;
  return [...DESKTOP_TOOL_NAMES].some((key) => short.endsWith('_' + key));
}

export function createDshCompat(ctx, log) {
  const get = (name) => {
    try { return ctx.get(name); } catch { return undefined; }
  };

  /** Subscribe to a Cordis event without letting an absent/renamed event fail the plugin. */
  function on(event, handler, options) {
    try {
      const dispose = options === undefined ? ctx.on(event, handler) : ctx.on(event, handler, options);
      return typeof dispose === 'function' ? dispose : () => {};
    } catch (error) {
      log && log.warn && log.warn('QuickDesk: cannot subscribe to %s (%s); this DSH version may have renamed the event', event, errorText(error));
      return () => {};
    }
  }

  function listWorkspaces() {
    const registry = get('workspaceRegistry');
    try {
      return registry && typeof registry.list === 'function' ? registry.list() : [];
    } catch { return []; }
  }

  function resolveTarget(config) {
    if (config.workspaceDirectory && config.workspaceDirectory.trim()) {
      return { cwd: config.workspaceDirectory.trim() };
    }
    const workspaces = listWorkspaces();
    if (workspaces.length > 0) {
      return { workspaceId: workspaces[0].id, path: workspaces[0].path, registry: get('workspaceRegistry') };
    }
    const workingDirectory = get('workingDirectory');
    let cwd;
    try { cwd = workingDirectory && workingDirectory.defaultDirectory; } catch { cwd = undefined; }
    return { cwd: cwd || process.cwd() };
  }

  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
  }

  function buildPrompt(config, text) {
    const prefix = typeof config.defaultPrompt === 'string' ? config.defaultPrompt.replace(/\s*$/, '') : '';
    return prefix ? prefix + '\n' + text : text;
  }

  /**
   * Create a new session and deliver the task. The only DSH-core hard
   * dependency of QuickDesk; adapt here if `sessionController` changes.
   */
  async function submitTask(config, text) {
    const controller = get('sessionController');
    if (!controller || typeof controller.create !== 'function' || typeof controller.prompt !== 'function') {
      throw new Error('当前 DSH 缺少 sessionController.create/prompt。QuickDesk 的其他部分仍在运行；请在 COMPATIBILITY.md 指示的位置适配这一处 DSH 核心 API。');
    }
    const target = resolveTarget(config);
    let created;
    try {
      created = await controller.create(target.workspaceId !== undefined ? { workspaceId: target.workspaceId } : { cwd: target.cwd });
    } catch (error) {
      throw new Error('创建会话失败：' + errorText(error));
    }
    const sessionId = created && created.sessionId;
    if (!sessionId) throw new Error('sessionController.create 未返回 sessionId');

    if (target.workspaceId !== undefined && target.registry) {
      try {
        const workspace = typeof target.registry.get === 'function' ? target.registry.get(target.workspaceId) : undefined;
        if (workspace && !workspace.sessionIds.includes(sessionId)) await workspace.attachSession(sessionId);
      } catch { /* grouping is cosmetic */ }
    }

    const request = {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: buildPrompt(config, text) }],
      clientTimeZone: timeZone()
    };
    // Older/newer signs may want the cancellation signal; retry once without it
    // for compatibility. The request id makes the retry idempotent.
    try {
      await controller.prompt(request, new AbortController().signal);
    } catch (first) {
      try {
        await controller.prompt(request);
      } catch (second) {
        throw new Error('提交任务失败：' + errorText(second));
      }
    }
    return { sessionId };
  }

  /** Apply the experimental Auto review preset to new root sessions, best effort. */
  function applyAutoPreset(agent, config) {
    try {
      const presets = get('permissionPresets');
      const session = agent && agent.session;
      if (!presets || !session) return;
      if (session.header && session.header.origin === 'subagent') return;
      const current = presets.current(session);
      if (current === config.autoPresetName) return;
      try {
        const catalog = typeof presets.catalog === 'function' ? presets.catalog() : undefined;
        if (catalog && typeof catalog.defaultPreset === 'string' && current !== catalog.defaultPreset) return;
      } catch { /* no catalog: keep going */ }
      presets.set(session, config.autoPresetName);
      log && log.info && log.info('QuickDesk: applied permission preset %s to new session %s', config.autoPresetName, String(session.id));
    } catch (error) {
      log && log.debug && log.debug('QuickDesk: could not apply preset (%s)', errorText(error));
    }
  }

  function hasService(name) {
    return get(name) !== undefined;
  }

  /**
   * Names of the tools currently visible in the global view. Used only for the
   * pre-task desktop-backend check; a DSH that renames or hides the tools
   * service degrades to "unknown" (empty list) and QuickDesk still submits.
   */
  function visibleToolNames() {
    try {
      const tools = get('tools');
      const view = tools && typeof tools.view === 'function' ? tools.view(undefined) : undefined;
      const visible = view && view.visible;
      if (visible && typeof visible.keys === 'function') return [...visible.keys()].map(String);
    } catch (error) {
      log && log.debug && log.debug('QuickDesk: cannot enumerate tools (%s)', errorText(error));
    }
    return [];
  }

  /** Whether at least one desktop-automation tool is registered. */
  function hasDesktopTools() {
    return visibleToolNames().some(isDesktopToolName);
  }

  /**
   * Cancel the running turn of one tracked session (used by the step budget).
   * Preferred path is the public Agent API `agent.cancel({ kind: 'user' }, {
   * keepInbox: true })`, which is exactly what DSH's own session stop uses;
   * the sessionController fallback covers a DSH that keeps only the remote
   * command. Never throws: a budget stop is advisory and must not break the
   * tool pipeline.
   */
  function cancelAgent(agent) {
    try {
      if (agent && typeof agent.cancel === 'function') {
        agent.cancel({ kind: 'user' }, { keepInbox: true });
        return true;
      }
    } catch (error) {
      log && log.debug && log.debug('QuickDesk: agent.cancel failed (%s)', errorText(error));
    }
    try {
      const controller = get('sessionController');
      const sessionId = agent && agent.session && agent.session.id !== undefined ? agent.session.id : agent && agent.id;
      if (controller && typeof controller.cancel === 'function' && sessionId !== undefined) {
        controller.cancel({ sessionId });
        return true;
      }
    } catch (error) {
      log && log.debug && log.debug('QuickDesk: sessionController.cancel failed (%s)', errorText(error));
    }
    return false;
  }

  /**
   * Best-effort: turn off the other desktop plugin's own visual overlays via the
   * DSH settings service, which persists to that plugin's config. This is
   * optional: a DSH version without the settings service just keeps the
   * overlays and logs a warning, and QuickDesk otherwise works.
   * @returns {Promise<{ok: boolean, already?: boolean, fields?: string[], ns?: unknown, reason?: string}>}
   */
  async function disableComputerUseUi(fields) {
    const settings = get('settings');
    if (!settings || typeof settings.describe !== 'function' || typeof settings.update !== 'function') {
      return { ok: false, reason: 'settings service unavailable in this DSH version' };
    }
    const wanted = Array.isArray(fields) ? fields : [];
    for (let attempt = 0; attempt < 20; attempt++) {
      let descriptors;
      try {
        descriptors = await settings.describe({ redactSecrets: false });
      } catch (error) {
        await delay(400);
        continue;
      }
      const target = (Array.isArray(descriptors) ? descriptors : []).find((descriptor) =>
        descriptor && descriptor.value && typeof descriptor.value === 'object' && wanted.some((field) => field in descriptor.value));
      if (!target) {
        await delay(400);
        continue;
      }
      const patch = {};
      for (const field of wanted) if (field in target.value) patch[field] = false;
      if (Object.keys(patch).length === 0) return { ok: false, reason: 'overlay fields not present in settings value' };
      if (Object.keys(patch).every((field) => target.value[field] === false)) {
        return { ok: true, already: true, ns: target.ns };
      }
      try {
        try {
          await settings.update(target.ns, patch, target.revision);
        } catch (first) {
          await settings.update(target.ns, patch);
        }
        return { ok: true, fields: Object.keys(patch), ns: target.ns };
      } catch (error) {
        return { ok: false, reason: errorText(error), ns: target.ns };
      }
    }
    return { ok: false, reason: 'computer-use settings entry not found' };
  }

  return { get, on, hasService, submitTask, applyAutoPreset, disableComputerUseUi, friendlyTool, cancelAgent, visibleToolNames, hasDesktopTools };
}
