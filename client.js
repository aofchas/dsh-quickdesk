// QuickDesk settings page (browser half).
//
// DSH Settings → Plugins serves the `quickdesk` namespace from the Host Config
// schema; this module renders the QuickDesk page and writes field patches back
// through ctx.configForms, so users never edit cordis.patch.yml by hand.
window.__ModuleLoader__.load({
  id: 'dsh-quickdesk',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const NS = 'quickdesk.settings';

    // Mirrors the Host Config defaults; a stripped snapshot still renders.
    const DEFAULTS = {
      hotkey: 'Ctrl+Alt+Space',
      submitKey: 'Enter',
      cancelKey: 'Escape',
      approveKey: 'Enter',
      rejectKey: 'Backspace',
      language: 'auto',
      statusCorner: 'top-right',
      statusEnabled: true,
      statusLingerMs: 20000,
      workspaceDirectory: '',
      defaultPrompt: '',
      maxSteps: 20,
      enforceMaxSteps: true,
      approvalPopup: true,
      popupTimeoutMs: 120000,
      autoPresetNewSessions: true,
      autoPresetName: 'auto',
      disableComputerUseUi: false,
      diagnosticsRequest: ''
    };
    const KEYS = Object.keys(DEFAULTS);
    const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
    const LANGUAGE_VALUES = ['auto', 'zh', 'en'];
    const NUMBER_RULES = {
      statusLingerMs: [1000, 3600000],
      maxSteps: [5, 200],
      popupTimeoutMs: [5000, 600000]
    };

    const dictionaries = {
      zh: {
        nav: 'QuickDesk',
        title: 'QuickDesk 设置',
        intro: '用全局快捷键呼出输入框，一句话把桌面任务交给 DeepSeek Harness。这里的修改会保存到当前 profile 的配置里。',
        groupShortcuts: '快捷键',
        groupLanguage: '语言',
        groupStatus: '状态浮窗',
        groupTask: '任务执行',
        groupApproval: '审批与权限',
        labelHotkey: '呼出快捷键',
        hintHotkey: '任意程序前台下按下即呼出输入框；支持单键或 Ctrl/Alt/Shift 组合',
        captureHotkey: '按下组合键…',
        capturingHotkey: '请按下快捷键（再次点击按钮取消）',
        hotkeySingleKeyWarning: '单键全局热键会影响其他程序的输入，建议使用组合键或 F 键。',
        actionTypingWarning: '这个单键在输入框内将无法正常输入，建议改用组合键。',
        shortcutConflict: '快捷键冲突',
        swapShortcuts: '交换两者',
        shortcutsSwapped: '已交换两个快捷键',
        labelSubmitKey: '提交键',
        hintSubmitKey: '输入框里按下即提交任务；支持单键或 Ctrl/Alt/Shift 组合',
        labelCancelKey: '取消键',
        hintCancelKey: '关闭输入框、不提交；支持单键或 Ctrl/Alt/Shift 组合',
        labelApproveKey: '审批通过键',
        hintApproveKey: '审批弹窗中按下即通过；支持单键或 Ctrl/Alt/Shift 组合',
        labelRejectKey: '审批拒绝键',
        hintRejectKey: '审批弹窗中按下即拒绝；支持单键或 Ctrl/Alt/Shift 组合',
        labelLanguage: '界面与任务协议语言',
        hintLanguage: 'auto 跟随系统语言；任务协议与所有界面文案同步切换',
        languageAuto: '自动（跟随系统）',
        languageZh: '中文',
        languageEn: 'English',
        labelStatusEnabled: '显示状态浮窗',
        hintStatusEnabled: '任务运行和结束时显示一行状态条',
        labelStatusCorner: '状态浮窗位置',
        hintStatusCorner: '浮窗贴哪个屏幕角落',
        cornerTopRight: '右上',
        cornerTopLeft: '左上',
        cornerBottomRight: '右下',
        cornerBottomLeft: '左下',
        labelStatusLingerMs: '结束后保留时长（毫秒）',
        hintStatusLingerMs: '1000 – 3600000',
        labelWorkspaceDirectory: '新会话工作目录',
        hintWorkspaceDirectory: '留空使用 DSH 默认工作区；可填绝对路径',
        labelDefaultPrompt: '自定义任务协议',
        hintDefaultPrompt: '留空使用内置的中/英文协议；可用 {{MAX_STEPS}} 占位符',
        labelMaxSteps: '步数上限',
        hintMaxSteps: '5 – 200；达到上限会取消本轮，避免空转烧 token',
        labelEnforceMaxSteps: '强制执行步数上限',
        hintEnforceMaxSteps: '关闭后只提示预算，不中断任务',
        labelApprovalPopup: '使用 QuickDesk 审批弹窗',
        hintApprovalPopup: '需要确认的操作在右下角弹窗，Enter 通过 / Backspace 拒绝',
        labelPopupTimeoutMs: '审批超时（毫秒）',
        hintPopupTimeoutMs: '5000 – 600000；超时自动拒绝',
        labelAutoPresetNewSessions: '新会话自动套用 Auto review',
        hintAutoPresetNewSessions: '让新任务默认使用自动审查权限预设',
        labelAutoPresetName: '权限预设名',
        hintAutoPresetName: '默认 auto',
        labelDisableComputerUseUi: '尝试关闭 computer-use 浮窗',
        hintDisableComputerUseUi: '可选：请 DSH 设置服务关闭 computer-use 插件的浮窗/接管提示；默认关闭',
        restartNote: '保存后立即生效；如果改的是快捷键或状态条位置，浮窗会重启一次（约 1 秒）。',
        groupDiagnostics: '诊断与支持',
        hintDiagnostics: '遇到问题时运行诊断：收集 DSH / QuickDesk 环境、日志和 sidecar 状态并生成 zip。报告包含本机路径和进程信息，请只发给开发者。',
        runDiagnostics: '运行诊断…',
        diagnosticsRequested: '已请求诊断，正在启动收集器…',
        diagnosticsRunning: '正在收集诊断信息，请稍候…',
        diagnosticsIdle: '点击按钮后选择报告保存位置；完成后会自动打开报告所在文件夹。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        noChanges: '没有修改',
        discard: '放弃修改',
        reset: '恢复默认值',
        loading: '正在读取 QuickDesk 设置…',
        unavailable: 'QuickDesk 设置当前不可用。刚安装或升级插件后，请完全退出并重启 DSH。',
        reload: '重新加载页面',
        notWritable: '当前 profile 不允许从界面修改设置。',
        invalidKey: '快捷键格式无效：写一个按键，可带 Ctrl/Alt/Shift，例如 Ctrl+Alt+Space',
        invalidNumber: '数值超出允许范围',
        invalidInteger: '请填写整数'
      },
      en: {
        nav: 'QuickDesk',
        title: 'QuickDesk settings',
        intro: 'Summon the input box with a global hotkey and hand a desktop task to DeepSeek Harness in one sentence. Changes here are saved into the active profile.',
        groupShortcuts: 'Shortcuts',
        groupLanguage: 'Language',
        groupStatus: 'Status HUD',
        groupTask: 'Task execution',
        groupApproval: 'Approvals and permissions',
        labelHotkey: 'Hotkey',
        hintHotkey: 'Pressed from any foreground app to summon the input box; supports single keys or Ctrl/Alt/Shift combos',
        captureHotkey: 'Press shortcut…',
        capturingHotkey: 'Press keys (click the button again to cancel)',
        hotkeySingleKeyWarning: 'A single-key global hotkey can swallow input in other apps; prefer a combination or an F key.',
        actionTypingWarning: 'This single key cannot be typed in the input box; prefer a combination.',
        shortcutConflict: 'Shortcut conflict',
        swapShortcuts: 'Swap both',
        shortcutsSwapped: 'The two shortcuts were swapped',
        labelSubmitKey: 'Submit key',
        hintSubmitKey: 'Pressed in the input box to submit the task; supports single keys or Ctrl/Alt/Shift combos',
        labelCancelKey: 'Cancel key',
        hintCancelKey: 'Closes the input box without submitting; supports single keys or Ctrl/Alt/Shift combos',
        labelApproveKey: 'Approve key',
        hintApproveKey: 'Approves a pending approval popup; supports single keys or Ctrl/Alt/Shift combos',
        labelRejectKey: 'Reject key',
        hintRejectKey: 'Rejects a pending approval popup; supports single keys or Ctrl/Alt/Shift combos',
        labelLanguage: 'UI and task-protocol language',
        hintLanguage: 'auto follows the OS language; changes the protocol and all UI copy together',
        languageAuto: 'Auto (follow system)',
        languageZh: '中文',
        languageEn: 'English',
        labelStatusEnabled: 'Show the status HUD',
        hintStatusEnabled: 'Shows a one-line status while a task runs and when it ends',
        labelStatusCorner: 'Status HUD corner',
        hintStatusCorner: 'Which screen corner the HUD sticks to',
        cornerTopRight: 'Top right',
        cornerTopLeft: 'Top left',
        cornerBottomRight: 'Bottom right',
        cornerBottomLeft: 'Bottom left',
        labelStatusLingerMs: 'Keep the final status (ms)',
        hintStatusLingerMs: '1000 – 3600000',
        labelWorkspaceDirectory: 'Workspace for new sessions',
        hintWorkspaceDirectory: 'Empty = DSH default workspace; absolute paths allowed',
        labelDefaultPrompt: 'Custom task protocol',
        hintDefaultPrompt: 'Empty = built-in zh/en protocol; {{MAX_STEPS}} is available',
        labelMaxSteps: 'Step budget',
        hintMaxSteps: '5 – 200; the turn is cancelled at the limit to avoid wasted tokens',
        labelEnforceMaxSteps: 'Enforce the step budget',
        hintEnforceMaxSteps: 'Off = prompt-only budget, the task is never cancelled',
        labelApprovalPopup: 'Use the QuickDesk approval popup',
        hintApprovalPopup: 'Confirmation appears in the bottom-right; Enter approves, Backspace rejects',
        labelPopupTimeoutMs: 'Approval timeout (ms)',
        hintPopupTimeoutMs: '5000 – 600000; timeouts reject automatically',
        labelAutoPresetNewSessions: 'Apply Auto review to new sessions',
        hintAutoPresetNewSessions: 'New tasks get the Auto review permission preset by default',
        labelAutoPresetName: 'Permission preset name',
        hintAutoPresetName: 'Default: auto',
        labelDisableComputerUseUi: 'Try turning off the computer-use overlay',
        hintDisableComputerUseUi: 'Optional: asks the DSH settings service to hide the computer-use overlay/takeover hint; off by default',
        restartNote: 'Changes apply immediately; shortcut or HUD-corner edits restart the overlay once (about 1 second).',
        groupDiagnostics: 'Diagnostics and support',
        hintDiagnostics: 'When something is wrong, run diagnostics: it collects the DSH / QuickDesk environment, logs and sidecar state into a zip. The report contains local paths and process details, so share it only with the developer.',
        runDiagnostics: 'Run diagnostics...',
        diagnosticsRequested: 'Diagnostics requested; starting the collector...',
        diagnosticsRunning: 'Collecting diagnostics; please wait...',
        diagnosticsIdle: 'Click the button, then choose where to save the report. The report folder opens when it is ready.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        noChanges: 'No changes',
        discard: 'Discard changes',
        reset: 'Reset to defaults',
        loading: 'Reading QuickDesk settings…',
        unavailable: 'QuickDesk settings are unavailable right now. After installing or upgrading the plugin, fully quit and restart DSH.',
        reload: 'Reload the page',
        notWritable: 'This profile does not allow editing settings from the UI.',
        invalidKey: 'Invalid shortcut: one key with optional Ctrl/Alt/Shift, e.g. Ctrl+Alt+Space',
        invalidNumber: 'Number out of range',
        invalidInteger: 'Enter a whole number'
      }
    };

    const KEY_RE = /^(?:(?:ctrl|alt|shift)\+)*(?:[a-z0-9]|f(?:[1-9]|1[0-9]|2[0-4])|space|enter|return|escape|esc|tab|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right)$/i;

    function isKeySpec(value) {
      const text = String(value === undefined || value === null ? '' : value).replace(/\s+/g, '');
      if (!text) return false;
      const parts = text.split('+').filter(Boolean);
      if (parts.length === 0) return false;
      if (parts.length > 1 && !parts.slice(0, -1).every((part) => /^(ctrl|alt|shift|win)$/i.test(part))) return false;
      return KEY_RE.test(text);
    }

    const MODIFIER_KEYS = new Set(['control', 'ctrl', 'shift', 'alt', 'meta', 'os']);

    function normalizeCapturedKey(raw) {
      const text = String(raw === undefined || raw === null ? '' : raw);
      if (!text) return null;
      const lower = text.toLowerCase();
      if (MODIFIER_KEYS.has(lower)) return null;
      if (lower === ' ' || lower === 'space' || lower === 'spacebar') return 'Space';
      if (lower === 'esc' || lower === 'escape') return 'Escape';
      if (lower === 'return' || lower === 'enter') return 'Enter';
      if (lower === 'tab') return 'Tab';
      if (lower === 'backspace') return 'Backspace';
      if (lower === 'delete' || lower === 'del') return 'Delete';
      if (lower === 'insert' || lower === 'ins') return 'Insert';
      if (lower === 'home') return 'Home';
      if (lower === 'end') return 'End';
      if (lower === 'pageup' || lower === 'pgup') return 'PageUp';
      if (lower === 'pagedown' || lower === 'pgdn') return 'PageDown';
      if (lower === 'up' || lower === 'arrowup') return 'Up';
      if (lower === 'down' || lower === 'arrowdown') return 'Down';
      if (lower === 'left' || lower === 'arrowleft') return 'Left';
      if (lower === 'right' || lower === 'arrowright') return 'Right';
      if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(text)) return text.toUpperCase();
      if (/^[a-z]$/i.test(text)) return text.toUpperCase();
      if (/^[0-9]$/.test(text)) return text;
      return null;
    }

    function formatHotkeyEvent(event) {
      if (!event || event.metaKey) return null;
      const key = normalizeCapturedKey(event.key);
      if (!key) return null;
      const parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      parts.push(key);
      const spec = parts.join('+');
      return isKeySpec(spec) ? spec : null;
    }

    const SHORTCUT_FIELDS = ['hotkey', 'submitKey', 'cancelKey', 'approveKey', 'rejectKey'];
    const SHORTCUT_CONFLICT_GROUPS = [
      ['hotkey', 'submitKey'],
      ['hotkey', 'cancelKey'],
      ['hotkey', 'approveKey'],
      ['hotkey', 'rejectKey'],
      ['submitKey', 'cancelKey'],
      ['approveKey', 'rejectKey']
    ];

    function canonicalKeySpec(value) {
      const raw = String(value === undefined || value === null ? '' : value).trim();
      if (!isKeySpec(raw)) return '';
      const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
      const modifiers = [];
      let key = '';
      for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') modifiers.push('ctrl');
        else if (lower === 'alt') modifiers.push('alt');
        else if (lower === 'shift') modifiers.push('shift');
        else key = normalizeCapturedKey(part) || '';
      }
      if (!key) return '';
      const ordered = ['ctrl', 'alt', 'shift'].filter((modifier) => modifiers.includes(modifier));
      return (ordered.length > 0 ? ordered.join('+') + '+' : '') + key.toLowerCase();
    }

    function shortcutConflict(draft) {
      if (!draft) return null;
      for (const group of SHORTCUT_CONFLICT_GROUPS) {
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            const field = group[i];
            const otherField = group[j];
            const left = canonicalKeySpec(draft[field]);
            const right = canonicalKeySpec(draft[otherField]);
            if (left && right && left === right) return { field, otherField, spec: String(draft[field]).trim() };
          }
        }
      }
      return null;
    }

    function canSwapShortcutConflict(conflict) {
      return Boolean(conflict && conflict.field !== 'hotkey' && conflict.otherField !== 'hotkey');
    }

    function swapShortcutValue(draft, conflict, editedField, previousValue) {
      if (!draft || !canSwapShortcutConflict(conflict) || !isKeySpec(previousValue)) return draft;
      const source = editedField === conflict.field
        ? conflict.field
        : editedField === conflict.otherField
          ? conflict.otherField
          : null;
      if (!source) return draft;
      const target = source === conflict.field ? conflict.otherField : conflict.field;
      return { ...draft, [target]: previousValue };
    }

    function shortcutWarning(field, value) {
      if (!isKeySpec(value)) return '';
      const parts = String(value).split('+').map((part) => part.trim()).filter(Boolean);
      if (parts.length > 1) return '';
      const key = normalizeCapturedKey(parts[0]);
      if (!key) return '';
      if (field === 'hotkey' && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return 'hotkeySingleKeyWarning';
      if ((field === 'submitKey' || field === 'cancelKey') && (/^[A-Z0-9]$/.test(key) || key === 'Space')) return 'actionTypingWarning';
      return '';
    }

    function captureHotkeyEvent(event) {
      if (!event || event.repeat) return null;
      if (MODIFIER_KEYS.has(String(event.key || '').toLowerCase())) return null;
      const value = formatHotkeyEvent(event);
      return value ? { action: 'set', value } : null;
    }

    function same(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    const styles = {
      page: {
        maxWidth: '720px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        color: 'var(--dsw-alias-label-primary, #e7e9ee)',
        fontSize: '13px',
        lineHeight: '1.5'
      },
      title: { margin: 0, fontSize: '18px', fontWeight: 600, lineHeight: '26px' },
      intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary, #9aa0aa)' },
      group: { display: 'flex', flexDirection: 'column', gap: '12px' },
      groupTitle: { margin: 0, fontSize: '14px', fontWeight: 600, lineHeight: '22px' },
      field: { display: 'flex', flexDirection: 'column', gap: '5px' },
      label: { fontWeight: 500 },
      hint: { color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', fontSize: '12px' },
      control: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #3a3f4b)',
        background: 'var(--dsw-alias-bg-l2, rgba(255,255,255,0.05))',
        color: 'inherit',
        font: 'inherit',
        fontSize: '13px'
      },
      inline: { display: 'flex', alignItems: 'center', gap: '8px' },
      hotkeyRow: { display: 'flex', alignItems: 'center', gap: '8px' },
      shortcutBox: { display: 'flex', flexDirection: 'column', gap: '4px' },
      warning: { margin: 0, color: 'var(--dsw-alias-state-warning-primary, #e0b25e)', fontSize: '12px', lineHeight: '1.4' },
      conflict: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-state-danger-primary, #ff6b6b)',
        color: 'var(--dsw-alias-state-danger-primary, #ff6b6b)',
        fontSize: '12px'
      },
      footer: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '4px' },
      note: { color: 'var(--dsw-alias-label-tertiary, #9aa0aa)', fontSize: '12px' },
      button: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #3a3f4b)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      },
      primary: {
        padding: '6px 16px',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'var(--dsw-alias-state-business-primary, #4c7dff)',
        color: '#fff',
        font: 'inherit',
        cursor: 'pointer'
      },
      message: { marginLeft: 'auto', fontSize: '12px' }
    };

    function Field({ label, hint, children }) {
      return h('div', { style: styles.field },
        h('span', { style: styles.label }, label),
        children,
        hint ? h('span', { style: styles.hint }, hint) : null);
    }

    function Notice({ t, status }) {
      return h('div', { style: styles.page },
        h('h2', { style: styles.title }, t('title')),
        h('p', { style: styles.hint, role: 'status' }, status === 'loading' ? t('loading') : t('unavailable')),
        h('div', null,
          h('button', { type: 'button', style: styles.button, onClick: () => window.location.reload() }, t('reload'))));
    }

    function SettingsPage({ t, scope, savePatch }) {
      const tr = typeof t === 'function' ? t : (key) => key;
      const state = React.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot()
      );
      const ready = Boolean(state) && (state.status === undefined || state.status === 'ready') && state.value !== undefined;
      const saved = React.useMemo(() => {
        const value = ready ? { ...DEFAULTS, ...state.value } : { ...DEFAULTS };
        return value;
      }, [ready, state && state.value]);
      const savedKey = JSON.stringify(saved);
      const [draft, setDraft] = React.useState(saved);
      const [dirty, setDirty] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [tone, setTone] = React.useState('');
      const [diagnosticsBusy, setDiagnosticsBusy] = React.useState(false);
      const [capturingField, setCapturingField] = React.useState(null);
      const captureRefs = React.useRef({});
      const previousShortcutRef = React.useRef({});
      const lastEditedShortcutRef = React.useRef(null);

      React.useEffect(() => {
        if (!dirty) setDraft(saved);
      }, [savedKey, dirty]);

      React.useEffect(() => {
        if (!diagnosticsBusy) return undefined;
        const timer = setTimeout(() => setDiagnosticsBusy(false), 120000);
        return () => clearTimeout(timer);
      }, [diagnosticsBusy]);

      React.useEffect(() => {
        if (!capturingField) return;
        const node = captureRefs.current[capturingField];
        if (node && typeof node.focus === 'function') node.focus();
      }, [capturingField]);

      if (!ready) return h(Notice, { t: tr, status: state && state.status });

      const writable = state.writable !== false;
      const disabled = !writable || saving;
      const conflict = shortcutConflict(draft);
      const shortcutLabel = (field) => tr({
        hotkey: 'labelHotkey',
        submitKey: 'labelSubmitKey',
        cancelKey: 'labelCancelKey',
        approveKey: 'labelApproveKey',
        rejectKey: 'labelRejectKey'
      }[field]);
      const change = (field, value) => {
        if (SHORTCUT_FIELDS.includes(field)) {
          previousShortcutRef.current[field] = draft[field];
          lastEditedShortcutRef.current = field;
        }
        setDraft((previous) => ({ ...previous, [field]: value }));
        setDirty(true);
        setMessage('');
        setTone('');
      };
      const validate = () => {
        for (const field of SHORTCUT_FIELDS) {
          if (!isKeySpec(draft[field])) return 'invalidKey';
        }
        if (conflict) return 'shortcutConflict';
        for (const [field, [min, max]] of Object.entries(NUMBER_RULES)) {
          const value = draft[field];
          if (!Number.isInteger(value)) return 'invalidInteger';
          if (value < min || value > max) return 'invalidNumber';
        }
        if (!LANGUAGE_VALUES.includes(draft.language)) return 'invalidLanguage';
        if (!CORNERS.includes(draft.statusCorner)) return 'invalidCorner';
        return undefined;
      };
      const save = async () => {
        const invalid = validate();
        if (invalid) {
          setTone('error');
          if (invalid === 'shortcutConflict' && conflict) {
            setMessage(tr('shortcutConflict') + ': ' + shortcutLabel(conflict.field) + ' ↔ ' + shortcutLabel(conflict.otherField));
          } else {
            setMessage(tr(invalid));
          }
          return;
        }
        const patch = {};
        for (const field of KEYS) {
          if (!same(draft[field], saved[field])) patch[field] = draft[field];
        }
        if (Object.keys(patch).length === 0) {
          setTone('');
          setMessage(tr('noChanges'));
          return;
        }
        setSaving(true);
        setMessage('');
        try {
          await savePatch(patch);
          setDirty(false);
          setTone('success');
          setMessage(tr('saved'));
        } catch (error) {
          setTone('error');
          setMessage(tr('saveFailed') + (error && error.message ? ': ' + String(error.message) : ''));
        } finally {
          setSaving(false);
        }
      };
      const discard = () => {
        setDraft(saved);
        setDirty(false);
        setMessage('');
        setTone('');
      };
      const startDiagnostics = async () => {
        if (diagnosticsBusy) return;
        setDiagnosticsBusy(true);
        setTone('');
        setMessage(tr('diagnosticsRequested'));
        try {
          await savePatch({ diagnosticsRequest: String(Date.now()) });
          setTone('success');
          setMessage(tr('diagnosticsRequested'));
        } catch (error) {
          setDiagnosticsBusy(false);
          setTone('error');
          setMessage(tr('saveFailed') + (error && error.message ? ': ' + String(error.message) : ''));
        }
      };
      const captureShortcutKeyDown = (event, field) => {
        if (capturingField !== field) return;
        event.preventDefault();
        event.stopPropagation();
        const captured = captureHotkeyEvent(event);
        if (!captured) return;
        setCapturingField(null);
        change(field, captured.value);
      };
      const toggleCapture = (field) => {
        if (disabled) return;
        setCapturingField((current) => current === field ? null : field);
      };
      const swapShortcutConflict = () => {
        const edited = lastEditedShortcutRef.current;
        const previous = edited ? previousShortcutRef.current[edited] : undefined;
        const next = swapShortcutValue(draft, conflict, edited, previous);
        if (next === draft) return;
        setDraft(next);
        setDirty(true);
        setTone('success');
        setMessage(tr('shortcutsSwapped'));
      };
      const swapSource = conflict && lastEditedShortcutRef.current === conflict.field
        ? conflict.field
        : conflict && lastEditedShortcutRef.current === conflict.otherField
          ? conflict.otherField
          : null;
      const swapAvailable = Boolean(conflict && canSwapShortcutConflict(conflict) && swapSource && isKeySpec(previousShortcutRef.current[swapSource]));

      const text = (field, extraStyle) => h('input', {
        id: 'quickdesk-' + field,
        type: 'text',
        style: { ...styles.control, ...(extraStyle || {}) },
        value: draft[field],
        disabled,
        onChange: (event) => change(field, event.target.value)
      });
      const shortcutWarningText = (field) => {
        const warning = shortcutWarning(field, draft[field]);
        return warning ? h('p', { style: styles.warning }, tr(warning)) : null;
      };
      const shortcutControl = (field) => h('div', { style: styles.hotkeyRow },
        text(field, { flex: '1 1 auto', minWidth: 0 }),
        h('button', {
          type: 'button',
          ref: (node) => { captureRefs.current[field] = node; },
          style: capturingField === field ? styles.primary : styles.button,
          disabled,
          onClick: () => toggleCapture(field),
          onKeyDown: (event) => captureShortcutKeyDown(event, field),
          onBlur: () => {
            if (capturingField === field) setCapturingField(null);
          },
          title: tr('captureHotkey'),
          'aria-pressed': capturingField === field
        }, capturingField === field ? tr('capturingHotkey') : tr('captureHotkey')));
      const shortcutField = (field, labelKey, hintKey) => h(Field, {
        label: tr(labelKey),
        hint: tr(hintKey)
      }, h('div', { style: styles.shortcutBox },
        shortcutControl(field),
        shortcutWarningText(field)));
      const number = (field, step) => h('input', {
        id: 'quickdesk-' + field,
        type: 'number',
        step: step || 1,
        style: styles.control,
        value: Number.isFinite(draft[field]) ? draft[field] : '',
        disabled,
        onChange: (event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(parsed)) change(field, parsed);
        }
      });
      const toggle = (field) => h('input', {
        id: 'quickdesk-' + field,
        type: 'checkbox',
        checked: Boolean(draft[field]),
        disabled,
        onChange: (event) => change(field, event.target.checked)
      });
      const select = (field, values, labelFor) => h('select', {
        id: 'quickdesk-' + field,
        style: styles.control,
        value: draft[field],
        disabled,
        onChange: (event) => change(field, event.target.value)
      }, values.map((value) => h('option', { key: value, value }, tr(labelFor(value)))));

      const languageLabel = (value) => value === 'auto' ? 'languageAuto' : value === 'zh' ? 'languageZh' : 'languageEn';
      const cornerLabel = (value) => 'corner' + value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');

      return h('section', { id: 'quickdesk-settings', style: styles.page },
        h('h2', { style: styles.title }, tr('title')),
        h('p', { style: styles.intro }, tr('intro')),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupShortcuts')),
          shortcutField('hotkey', 'labelHotkey', 'hintHotkey'),
          shortcutField('submitKey', 'labelSubmitKey', 'hintSubmitKey'),
          shortcutField('cancelKey', 'labelCancelKey', 'hintCancelKey'),
          shortcutField('approveKey', 'labelApproveKey', 'hintApproveKey'),
          shortcutField('rejectKey', 'labelRejectKey', 'hintRejectKey'),
          conflict ? h('div', { style: styles.conflict },
            h('span', null, tr('shortcutConflict') + ': ' + shortcutLabel(conflict.field) + ' ↔ ' + shortcutLabel(conflict.otherField)),
            swapAvailable ? h('button', {
              type: 'button',
              style: styles.button,
              disabled,
              onClick: swapShortcutConflict
            }, tr('swapShortcuts')) : null) : null),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupLanguage')),
          h(Field, { label: tr('labelLanguage'), hint: tr('hintLanguage') },
            select('language', LANGUAGE_VALUES, languageLabel))),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupStatus')),
          h(Field, { label: tr('labelStatusEnabled'), hint: tr('hintStatusEnabled') },
            h('label', { style: styles.inline }, toggle('statusEnabled'))),
          h(Field, { label: tr('labelStatusCorner'), hint: tr('hintStatusCorner') },
            h('select', {
              id: 'quickdesk-statusCorner',
              style: styles.control,
              value: draft.statusCorner,
              disabled,
              onChange: (event) => change('statusCorner', event.target.value)
            }, CORNERS.map((value) => h('option', { key: value, value }, tr(cornerLabel(value)))))),
          h(Field, { label: tr('labelStatusLingerMs'), hint: tr('hintStatusLingerMs') },
            number('statusLingerMs', 1000))),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupTask')),
          h(Field, { label: tr('labelWorkspaceDirectory'), hint: tr('hintWorkspaceDirectory') },
            text('workspaceDirectory')),
          h(Field, { label: tr('labelDefaultPrompt'), hint: tr('hintDefaultPrompt') },
            h('textarea', {
              id: 'quickdesk-defaultPrompt',
              rows: 6,
              style: { ...styles.control, resize: 'vertical', fontFamily: 'inherit' },
              value: draft.defaultPrompt,
              disabled,
              onChange: (event) => change('defaultPrompt', event.target.value)
            })),
          h(Field, { label: tr('labelMaxSteps'), hint: tr('hintMaxSteps') },
            number('maxSteps')),
          h(Field, { label: tr('labelEnforceMaxSteps'), hint: tr('hintEnforceMaxSteps') },
            h('label', { style: styles.inline }, toggle('enforceMaxSteps')))),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupApproval')),
          h(Field, { label: tr('labelApprovalPopup'), hint: tr('hintApprovalPopup') },
            h('label', { style: styles.inline }, toggle('approvalPopup'))),
          h(Field, { label: tr('labelPopupTimeoutMs'), hint: tr('hintPopupTimeoutMs') },
            number('popupTimeoutMs', 1000)),
          h(Field, { label: tr('labelAutoPresetNewSessions'), hint: tr('hintAutoPresetNewSessions') },
            h('label', { style: styles.inline }, toggle('autoPresetNewSessions'))),
          h(Field, { label: tr('labelAutoPresetName'), hint: tr('hintAutoPresetName') },
            text('autoPresetName')),
          h(Field, { label: tr('labelDisableComputerUseUi'), hint: tr('hintDisableComputerUseUi') },
            h('label', { style: styles.inline }, toggle('disableComputerUseUi')))),
        h('div', { style: styles.group },
          h('h3', { style: styles.groupTitle }, tr('groupDiagnostics')),
          h('p', { style: styles.hint }, tr('hintDiagnostics')),
          h('div', null,
            h('button', {
              type: 'button',
              style: styles.button,
              disabled: disabled || diagnosticsBusy,
              onClick: startDiagnostics
            }, diagnosticsBusy ? tr('diagnosticsRunning') : tr('runDiagnostics'))),
          h('p', { style: styles.hint, role: 'status' },
            diagnosticsBusy ? tr('diagnosticsRunning') : tr('diagnosticsIdle'))),
        h('p', { style: styles.note }, tr('restartNote')),
        h('div', { style: styles.footer },
          h('button', { type: 'button', style: styles.primary, disabled, onClick: save }, saving ? tr('saving') : tr('save')),
          h('button', { type: 'button', style: styles.button, disabled: disabled || !dirty, onClick: discard }, tr('discard')),
          h('button', {
            type: 'button',
            style: styles.button,
            disabled,
            onClick: () => {
              setDraft({ ...DEFAULTS });
              setDirty(true);
              setMessage('');
              setTone('');
            }
          }, tr('reset')),
          h('span', { style: { ...styles.message, color: tone === 'error' ? 'var(--dsw-alias-state-danger-primary, #ff6b6b)' : 'var(--dsw-alias-label-tertiary, #9aa0aa)' }, role: 'status' }, message)),
        writable ? null : h('p', { style: styles.hint }, tr('notWritable')));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries));
      const t = ctx.locale.bind ? ctx.locale.bind(NS) : (key) => key;
      let mounted = false;
      const mount = (scope, owner) => {
        if (mounted || !scope) return;
        mounted = true;
        const savePatch = async (patch) => {
          const ops = Object.entries(patch).map(([field, value]) => ({ op: 'set', path: [field], value }));
          if (typeof scope.mutate === 'function') {
            const current = scope.getSnapshot();
            const accepted = await scope.mutate(ops, current && current.revision);
            if (accepted !== true) throw new Error(t('saveFailed'));
            return;
          }
          if (typeof scope.set === 'function') {
            for (const [field, value] of Object.entries(patch)) await scope.set(field, value);
            return;
          }
          throw new Error(t('saveFailed'));
        };
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'quickdesk',
          order: 17,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ scope, savePatch, as: 'section', idPrefix: 'quickdesk-page' })
        }, SettingsPage));
      };
      // Modern host: configForms owns the namespace (schema + revision fence).
      ctx.inject(['configForms'], (owner) => {
        mount(owner.configForms.get('quickdesk'), owner);
      });
      // Older host: a settingsScope bound to the same profile entry id.
      ctx.inject(['settingsScope', 'connection', 'remote'], (owner) => {
        if (mounted) return;
        mount(owner.settingsScope.bind({ namespace: 'quickdesk' }), owner);
      });
    }

    return { apply, inject: ['slots', 'locale'], __test: { formatHotkeyEvent, captureHotkeyEvent, isKeySpec, canonicalKeySpec, shortcutConflict, canSwapShortcutConflict, swapShortcutValue, shortcutWarning } };
  }
});
