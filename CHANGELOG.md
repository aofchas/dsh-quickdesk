# Changelog

All notable changes to QuickDesk are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-10

### Added
- **DSH settings page**: Settings → Plugins → QuickDesk edits every option
  (shortcuts, language, status HUD, workspace, task protocol, step budget,
  approvals) and writes through the DSH config editor — no YAML editing.
- Host `Config` schema (schemastery, all fields volatile) and a companion
  `client.js` settings page with zh/en copy, validation, save/discard/reset.
- Live configuration application: the Host polls committed Loader config and
  applies changes without remounting; hotkey/HUD edits restart only the
  PowerShell sidecar.
- `docs/market-copy.md`: bilingual copy for the DSH plugin market listing.

## [1.1.0] - 2026-11-10

### Added
- Chinese/English localization for the input box, status HUD, approval popup and
  the default desktop task protocol (`locale/zh.json`, `locale/en.json`).
- `language: auto|zh|en` setting; `auto` follows the OS locale.
- Desktop-backend detection before submitting a task (clear hint when no
  computer-use provider is installed).

### Changed
- `defaultPrompt` now defaults to empty (built-in localized protocol); custom
  prompts still use the `{{MAX_STEPS}}` placeholder.
- Removed the 1.0.x `client.js` that wrote another plugin's settings
  unconditionally; `disableComputerUseUi` is now opt-in and host-only.

### Fixed
- HUD labels normalize provider-prefixed tool names
  (`windows_computer_use_*` → «查找窗口»/«截图»).

## [1.0.3] - 2026-11-10

### Added
- Hard `maxSteps` budget (default 20) that cancels the running turn when the
  model keeps verifying/summarizing after the task is done.
- `enforceMaxSteps`, `/N` step indicator in the HUD, 35-case offline self-test.

### Changed
- Completion-first task protocol: stop when the target state exists, default to
  one-line output, forbid page-content summaries, screenshot budget ≤2.
- Single source for the default prompt in `quickdesk.mjs` (removed the duplicate
  from `cordis.patch.yml`).
- Measured on a YouTube search task: 53 tool calls (12 screenshots) → about 10
  steps (≤2 screenshots).

## [1.0.0] - 2026-11-10

### Added
- Global-hotkey input box (`Ctrl+Alt+Space`), task submission through
  `sessionController`, one-line status HUD and an approval popup.
- UIA-first default prompt, configurable shortcuts/status/approval fields in
  `cordis.patch.yml`, Auto review preset for new sessions.
- PowerShell sidecar (`launcher.ps1`, `approval-popup.ps1`) with a single-instance
  mutex and configurable hotkeys.
