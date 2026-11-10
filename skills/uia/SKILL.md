# UIA-first desktop automation skill

A local playbook for QuickDesk sessions: operate Windows apps through **UI
Automation semantics** first, screenshots only as a fallback or for visual
confirmation.

## Core rule

> Prefer element-bound UIA actions over pixel coordinates. A screenshot tells you
> what the screen looks like; UIA tells you what the control *is* and what it can
> do.

## Tool mapping (mcp__wincu__*)

| Goal | Use | Avoid |
|---|---|---|
| Find the target window | `list_windows` (title/class/pid/rect) | guessing from a screenshot |
| Inspect a window's controls | `accessibility_tree` (`viewMode: control/content/raw`, scoped window) | full-screen OCR |
| Find a control | `find` with name / automationId / class / controlType; check `element_info` | clicking a coordinate from a previous screenshot |
| Activate a control | `invoke` (Invoke/Toggle/Select/Expand patterns), `set_value` (Value pattern), `focus`, `click`/`double_click` on an element id | raw coordinate click |
| Read a value/state | `element_info`, tree value, `find` results | assuming from pixels |
| Type text | `focus` the edit control → `type_text` (verify with the returned value) | click near where a field looked |
| Wait for a state | `wait_for` on element/text or `wait` + re-read tree | fixed sleeps before screenshots |
| Screenshot | only when UIA has no content, or to visually verify a rendered result | using it as the primary observation |

Element ids are UIA runtime ids: they stay stable across UI refreshes and become
explicitly stale instead of silently clicking the wrong place. Re-read when stale.

## UIA patterns worth checking in `element_info`

- **InvokePattern** — buttons, menu items, hyperlinks (prefer `invoke` over click).
- **ValuePattern** — text boxes, spinners, range controls (`set_value`).
- **TogglePattern** — checkboxes, switches.
- **SelectionItemPattern** — list/tab items (select, then read state).
- **ExpandCollapsePattern** — combo boxes, tree nodes, menus.
- **ScrollItemPattern / ScrollPattern** — bring offscreen items into view first.

If a control exposes no useful pattern, fall back to `focus` + `keypress` (keyboard
navigation) before resorting to coordinates.

## Practical workflow

1. `list_windows` → identify the exact window (title + class + pid + rect).
2. `accessibility_tree` scoped to that window, `viewMode: control`, bounded depth.
3. `find` a stable selector (automationId > name + controlType > class name).
4. Read/verify with `element_info`; check enabled/offscreen/bounding box.
5. Act with `invoke` / `set_value` / `focus` / `click` on the element id.
6. Verify with a small `find`/`element_info` re-read (or a screenshot only when
   appearance is the question).
7. Handle dialogs/stale ids by re-reading, never by replaying a guessed click.

## Fallback ladder

1. UIA semantic pattern (`invoke`, `set_value`, selection/toggle).
2. Keyboard on the focused control (`focus`, `keypress`, clipboard `type_text`).
3. UIA tree + `click` on element id (hit-tested by the tool).
4. Screenshot + OCR to *locate* a control, then still act through UIA if possible.
5. Screenshot + coordinate click — last resort; state may be stale; verify after.

## References

- Microsoft UI Automation overview: https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview
- UIA control patterns: https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview
- UIA properties/conditions: https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-properties-overview
- Micro Focus UIA best practices (prefer UIA patterns over device replay):
  https://admhelp.microfocus.com/uftdev/en/26.1-26.3/HelpCenter/Content/HowTo/UIAPro_BestPractices.htm
