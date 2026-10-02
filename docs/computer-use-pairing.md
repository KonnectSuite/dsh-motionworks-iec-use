# Pairing with computer-use-mcp

Use this plugin for workspace-bound project staging, native IDE editing, source
inspection, COM project identity, Build and compiler diagnostics. Prefer
`mw_ide_variable_change` for local/global/external declarations,
`mw_ide_code_change` for ST bodies, `mw_ide_fb_insert` for ST block calls,
`mw_ide_pou_change` for ST/FBD/LD creation and POU copy/rename/delete, and
`mw_ide_task_change` for task settings and program instances. These operations do
not need worksheet focus or mouse input. Inspect their accepted verification
verdicts and retained evidence; finish intended edits with fresh Build/Make.

Use Arya's computer-use tools for graphical placement/wiring, library-manager
operations and unsupported editor actions, visual inspection and dialogs.
Resolve keyboard commands from the installed help with `mw_code_installed_help`.
For graphical diagnosis, `mw_ide_graphical_listing` runs a fresh Build and returns
matching regenerated compiler networks and declaration symbols. It can inspect
saved LD/FBD logic without desktop input. Raw compiler tokens do not prove visual
placement or wiring; use current canvas observation for those checks.
At startup, use `mw_ide_trial` / `mw_ide_start` for the offered Use Trial control
before attempting desktop clicks.

Capture the active project path before and after UI actions and compare it
with the staged `.mwt` path. A UI click, posted command, or empty Errors pane alone is not
a compile verdict; check the live Build result and read back the changed project model.

The user-provided [computer-use-mcp](https://github.com/KonnectSuite/computer-use-mcp)
is an optional companion. This repository does not bundle or call that package directly.

For graphical and other UI edits, a functioning desktop companion is required.
Use `mw_ide_open_worksheet` for exact native navigation, then observe the current
editable work surface and focus through the desktop companion before input.
Its caption/readiness verdict does not verify keyboard focus, accessibility
freshness or continued responsiveness after the request. If the accessibility
tree still names a previous worksheet, discard its element indexes. Refresh the
window binding and observation; stop UI input if the mismatch remains or the
new observation is null. Native API operations remain available when desktop
observation fails, subject to their own project/baseline checks.

A successful input
response acknowledges submission, not editor acceptance or completed typing.
Observe the settled result before the next action and read back saved sources.
Never send blind clicks if screen capture fails. Desktop capture can require
desktop-access permissions unavailable to a sandboxed companion process; diagnose
that access separately instead of changing the customer project or weakening guards.
