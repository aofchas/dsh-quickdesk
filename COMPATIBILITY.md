# QuickDesk compatibility contract

QuickDesk is built to survive DSH and computer-use plugin upgrades with no code
change, or at most a one-file change.

## Tested with

| Component | Version |
|---|---|
| QuickDesk | 1.2.1 |
| DeepSeek Harness Desktop | 0.2.2-rc.3 |
| `@deepseek-ai/dsh` runtime | 0.2.2-rc.3 |
| `dsh-computer-use-win` (optional, not imported) | 0.5.6 |

## All DSH-core touch points

They are intentionally concentrated in `compat.mjs` and `quickdesk.mjs`:

| API | Where | If DSH renames/changes it |
|---|---|---|
| `ctx.get(name)` service lookup | `compat.mjs` `get()` | Core Cordis API; very stable. If changed, edit `get()` only. |
| `sessionController.create(request)` → `{ sessionId }` | `compat.mjs` `submitTask()` | **The only task-creation entry point.** Adapt `submitTask()`; the rest of QuickDesk still loads. |
| `sessionController.prompt(request, signal?)` | `compat.mjs` `submitTask()` | Tries signal then no-signal; if the request shape changes, adapt only this call. |
| `agent.cancel({ kind: 'user' }, { keepInbox: true })` | `compat.mjs` `cancelAgent()` | **Step-budget stop.** Same call DSH's own session stop uses. If the Agent API changes, fall back to the next row inside `cancelAgent()` only. |
| `sessionController.cancel({ sessionId })` | `compat.mjs` `cancelAgent()` | Fallback for the budget stop when `agent.cancel` is absent. Guarded; a failed stop only logs. |
| `tools.view(scope?)` → `{ visible: Map }` | `compat.mjs` `visibleToolNames()` / `hasDesktopTools()` | **Desktop-backend check only.** A DSH that renames or hides the tools service returns an empty list; QuickDesk logs a warning and still submits the task. |
| `workspaceRegistry.list()` / `get(id)` / `attachSession()` | `compat.mjs` | Optional: missing service → uses working directory or process cwd. |
| `workingDirectory.defaultDirectory` | `compat.mjs` | Optional fallback only. |
| `permissionPresets.current/set/catalog` | `compat.mjs` `applyAutoPreset()` | Optional; failures only skip the Auto preset. |
| `settings.describe()` / `settings.update(ns, patch)` | `compat.mjs` `disableComputerUseUi()` | Optional, **opt-in only** (`disableComputerUseUi: false` by default): tries to turn off computer-use-win's overlay/indicator fields. DSH may reject the write during HMR; then QuickDesk logs a warning and everything else works. |
| `approval/request` waterfall event | `quickdesk.mjs` answerer | Registered only when `approval` service exists; absent/renamed event is caught and logged. |
| `tools/pre-execute` waterfall event | `quickdesk.mjs` status + step budget | Uses only `exec.agent` (tracked id / cancel) and `exec.name` (HUD label), then calls `next()`. If the payload shape changes, adapt the one handler; the budget stop degrades to "prompt-only". |
| `Config` export (schemastery `z.object`) | `quickdesk.mjs` | **Settings page contract.** DSH's settings service projects this schema into the `quickdesk` namespace and validates the row config on activation. A DSH without the settings service degrades to YAML-only configuration. |
| `ctx.inject(['settings'])` → `settings.configure({ auto: false }, fiber)` | `quickdesk.mjs` `apply()` | Optional; declares that client.js owns the page. Missing/renamed service is caught and logged. |
| `settings.describe()/update(ns, patch)` + `configForms.get('quickdesk')` | DSH settings host/client (not imported) | Client writes go through the DSH config editor, which persists into the profile patch. If the namespace layout changes, adapt `client.js`'s `mount()`/`savePatch()` only. |
| Client slots `settings.section` + client locale `register/bind` | `client.js` | Standard client plugin APIs (same as `dsh-computer-use-win`). If a slot is renamed, the page silently stops appearing; adapt the single `ctx.slots.inject('settings.section', …)` call. |
| `dsh.client.inject` = `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings` | `package.json` | Client package dependencies; required for `ctx.locale` and `ctx.configForms`. Update if DSH renames those client packages. |
| `agent/status`, `agent/error`, `agent/created` events | `quickdesk.mjs` | Status/default-preset only; guarded. |
| `ctx.on(event, handler, { prepend })` | `compat.mjs` `on()` | Third argument is the only optional-argument use; if changed, edit `on()`. |
| `ctx.effect`, `ctx.logger` | `quickdesk.mjs` | Core Cordis plugin lifecycle; typically stable. |

The Host half declares **no `inject`** and imports nothing from DSH except the
optional `@deepseek-ai/schemastery` peer that defines `Config` (the Settings
schema, same pattern as `dsh-computer-use-win`). A DSH that drops the settings
service still loads the plugin and degrades to YAML-only configuration; a Loader
that drops schema projection only loses the settings page.

## Settings page contract

- `quickdesk.mjs` exports `Config` (schemastery) with **every field declared
  `.volatile()`**: DSH's settings service only projects volatile fields into a
  form, and the Loader hands those fields to `apply()` as volatile references.
  `apply()` unwraps them with `plainVolatileConfig()`.
- `client.js` is a normal DSH client plugin (`dsh.client`): it injects
  `@deepseek-ai/dsh-client-locale` + `@deepseek-ai/dsh-client-ui-settings`,
  takes the namespace through `ctx.inject(['configForms'])` →
  `configForms.get('quickdesk')`, and registers one page into
  `ctx.slots.inject('settings.section', …)`.
- Saves go through `scope.mutate([{ op: 'set', path: [field], value }], revision)`,
  i.e. DSH's config editor writes the field into the profile patch. There is no
  custom persistence and no direct YAML editing.
- Because the plugin is not remounted on a volatile edit, `apply()` polls the
  committed Loader entry options every 500 ms (`ctx.fiber.entry.options.config`)
  and applies changes live: most fields are read on demand; a hotkey or
  status-corner change restarts only the PowerShell sidecar.
- Older hosts without `configForms` fall back to `settingsScope.bind({ namespace: 'quickdesk' }).set(field, value)`;
  a host without either simply shows no page while YAML config keeps working.

## Localization contract

- `locale/zh.json` and `locale/en.json` are the single source of the Host copy:
  `meta.title` / `meta.description` (read by DSH Plugin Manager for the plugin
  inventory), `ui.*` (native input box, status HUD, approval popup) and `prompt`
  (the default desktop task protocol).
- The settings page copy lives in `client.js`'s `dictionaries` (`quickdesk.settings`
  client locale namespace), kept in the same wording; add a language in both places.
- `language: auto` resolves from the OS locale (`Intl.DateTimeFormat`), with
  `zh` / `en` forcing a language. Adding a language = add
  `locale/<lang>.json` + register it in `LANGUAGES` in `quickdesk.mjs` and in
  `client.js`.
- The PowerShell sidecars receive the localized strings as UTF-8/base64
  parameters (input box, hint, brand, placeholder) or inside the approval
  payload (title, hint, button labels), so no copy is duplicated in C#/PS code.

## Computer-use plugin independence

QuickDesk never imports `dsh-computer-use-win` and never reads its files or
settings. It only:

- passes the **built-in completion-first task protocol** (localized by
  `language`; optional `defaultPrompt` override) to new sessions, telling the
  model to operate the visible desktop and stop as soon as the task's target
  state exists;
- counts tool calls for “第 N/20 步 / 已完成 N 步”, and cancels the turn with
  `agent.cancel` once the configurable `maxSteps` budget is exceeded;
- checks the DSH tool registry for any recognizable desktop tool before
  submitting a task, so a profile without a computer-use provider fails fast
  with a status message instead of an empty session;
- optionally (opt-in) asks the DSH settings service to turn off the
  computer-use plugin's own overlay/indicator UI.

If the computer-use plugin changes its tool names, approval language, or model
instructions:

1. Update `locale/*.json` (`prompt`, `ui.*`) to match the new conventions; run
   `npm run selftest`.
2. Optionally extend the cosmetic label table (`TOOL_LABELS`) and the desktop
   tool-name set (`isDesktopToolName`) in `compat.mjs`; unknown names are shown
   as-is, so the label table is optional.

## Upgrade checklist

1. Install the DSH update; start it once.
2. Open Settings → Plugins → QuickDesk → edit one field and save.
   - Page appears and saving persists after reload → settings contract is
     compatible.
   - Page missing while the plugin row is active → check `client.js` slot
     registration (`settings.section`) and the `configForms` namespace name
     (`quickdesk`).
   - Save reports a validation error → align `Config` in `quickdesk.mjs` with
     the values `client.js` writes.
3. Press the QuickDesk hotkey and submit a task like “只回复：收到”.
   - Input box appears and a session is created → core path is compatible.
   - Status message reports `sessionController` incompatibility → adapt
     `compat.mjs` `submitTask()` only.
   - Status bar reports missing desktop tools while a computer-use provider is
     installed → check the `tools.view()` touch point in `compat.mjs`.
   - Status area stays blank → check the DSH log for `QuickDesk:` warnings; event
     names may need adaptation in `quickdesk.mjs` (they are all guarded).
4. Run one real desktop task; if the model chooses the wrong browser path or
   keeps verifying after the task is done, edit `locale/<lang>.json` `prompt`
   (no DSH API change needed) and tune `maxSteps`.
5. Reinstall/restart DSH after editing plugin source; `cordis.patch.yml` edits
   need a profile reload too. The step budget is cosmetic-safe: if the cancel
   API disappears, the HUD still counts and the prompt budget still applies.

## Non-goals

QuickDesk does not embed or patch DSH, does not bundle computer-use, and does not
configure the computer-use plugin’s own settings by default. Those remain owned
by the respective packages.
