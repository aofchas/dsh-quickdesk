# QuickDesk roadmap

## Browser lane (CDP)

**Status: deferred. Not part of the current release.**

QuickDesk currently drives a user-visible Chrome through the desktop
computer-use tools (UIA + keyboard/mouse). A future version may prefer the
`dsh-computer-use-win` browser lane (`browserTab`, `new-tab`, `address`) for
Chrome/Edge tasks.

Why it is deferred:

- The browser lane is not yet as human-like as the desktop path: it works on
  page elements and may use a separate browser profile or an attached tab,
  rather than acting through the visible window and normal pointer/keyboard
  flow.
- Attaching to an already-open browser is still experimental and needs remote
  debugging plus an Allow click.
- The immediate priority is safety: never retry input on an unresponsive
  window, and collect enough evidence to distinguish a Chrome/Explorer hang
  from an automation timeout.

Revisit after the desktop fail-fast and diagnostics work is stable. The future
integration should prefer the browser lane only when it is connected and the
task does not depend on the user's exact window state; otherwise QuickDesk
should keep the current visible-desktop behavior.
