# Changelog

All notable changes to QuickDesk are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-11-14

### Fixed
- **Chinese Windows code-page crash (GB2312/936)**: `scripts/launcher.ps1` and
  `scripts/approval-popup.ps1` are now pure ASCII. Windows PowerShell 5.1 reads
  BOM-less scripts using the system ANSI code page; the previous Chinese
  fallback strings made the launcher fail to parse on a fresh Chinese Windows
  machine, so the sidecar exited before writing `launcher.log` and the global
  hotkey never worked.
- The ASCII-only rule is enforced by `scripts/tests/encoding.test.mjs` and a
  GB2312 parser simulation in `scripts/tests/powershell-syntax.test.mjs`; both
  fail the publish gate if non-ASCII text returns to a PowerShell script.

### Added
- **Settings → QuickDesk → Diagnostics and support**: a one-click diagnostics
  collector. The settings page asks the Host to run
  `scripts/collect-diagnostics.ps1`; a native Save-As dialog lets the user pick
  where to store the report zip, and the temporary collection folder is deleted
  after a successful zip. The report covers environment, DSH profiles, sidecar
  logs, launcher prerequisites, module resolution and recent DSH logs.
- `scripts/tests/diagnostics.test.mjs` verifies the zip, its contents, the JSON
  result marker and temporary-folder cleanup.
- `scripts/tests/release-notes.test.mjs` plus a bilingual release-notes file per
  version; the GitHub release workflow now uses the bilingual file as its body.
- Verified against DSH Desktop 0.2.2-rc.3 (previously rc.1).

### Changed
- npm package description is bilingual, and the README now points at npm-safe
  absolute asset/link URLs plus a diagnostics section.
- Settings Config gained one volatile diagnostics request field
  (`diagnosticsRequest`); the settings page writes a request token and the Host
  runs the collector, showing progress through the HUD and opening the report
  folder on success. The README configuration tables document the field.

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
