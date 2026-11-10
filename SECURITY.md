# Security policy

QuickDesk is a local Windows desktop assistant plugin for DeepSeek Harness. It
has no network requests of its own and no telemetry.

## What it runs locally

- **Host plugin** (`quickdesk.mjs`, `compat.mjs`): runs inside the DSH process;
  uses only DSH services looked up dynamically in `compat.mjs`; starts and stops
  the PowerShell sidecar.
- **Launcher sidecar** (`scripts/launcher.ps1`): a PowerShell 5.1 + WinForms
  process that registers a global hotkey, shows the translucent input box and
  the status HUD. No administrator rights are requested.
- **Approval popup** (`scripts/approval-popup.ps1`): a PowerShell process started
  only while an approval request is pending; returns the decision (allow/deny)
  to the Host through stdout.
- **Settings page** (`client.js`): a browser module that renders the QuickDesk
  settings form and submits field patches to the Host through the public DSH
  settings Remote.

## Permissions QuickDesk uses

| Capability | Why | How to turn it off |
|---|---|---|
| Global hotkey (low-level keyboard hook) | Summon the input box from any app | Change `hotkey` or stop DSH |
| Approval popup takeover | Confirm irreversible actions with Enter/Backspace | `approvalPopup: false` |
| Optional host-side settings write | Try to hide `dsh-computer-use-win`'s overlay | `disableComputerUseUi: false` (default) |
| Task submission | Create a DSH session and send the prompt | No toggle; quit DSH |

QuickDesk does **not** read other plugins' files or settings, does not send data
anywhere, and does not bundle or patch DSH.

## Reporting a vulnerability

Open a private security advisory on GitHub
(`Security → Report a vulnerability`) or open an issue if the report does not
need to stay private.

Please include: DSH version, QuickDesk version, Windows version, the affected
file/feature, and reproduction steps. Do not include secrets or personal data in
public issues.
