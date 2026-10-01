# Pairing with computer-use-mcp

Use this plugin for workspace-bound project staging, read-only source inspection,
COM project identity, Build and compiler diagnostics. Use Arya's computer-use tools
to make source, variable, POU, graphical LD and library-manager edits in the IDE,
inspect the result visually and handle dialogs. Capture the active project path before and after UI actions and compare it
with the staged `.mwt` path. A UI click, posted command, or empty Errors pane alone is not
a compile verdict; check the live Build result and read back the changed project model.

The user-provided [computer-use-mcp](https://github.com/KonnectSuite/computer-use-mcp)
is an optional companion. This repository does not bundle or call that package directly.

For live edits, a functioning desktop companion is required. A successful input
response acknowledges submission, not editor acceptance or completed typing.
Observe the settled result before the next action and read back saved sources.
Never send blind clicks if screen capture fails. Desktop capture can require
desktop-access permissions unavailable to a sandboxed companion process; diagnose
that access separately instead of changing the customer project or weakening guards.
