# Pairing with computer-use-mcp

Use this plugin for workspace-bound project staging, native edits, COM project identity,
Build and compiler diagnostics. Use Arya's computer-use tools to inspect the IDE visually,
answer dialogs, and verify graphical LD or library-manager actions that have no supported
plugin writer. Capture the active project path before and after UI actions and compare it
with the staged `.mwt` path. A UI click, posted command, or empty Errors pane alone is not
a compile verdict; check the live Build result and read back the changed project model.

The user-provided [computer-use-mcp](https://github.com/KonnectSuite/computer-use-mcp)
is an optional companion. This repository does not bundle or call that package directly.
