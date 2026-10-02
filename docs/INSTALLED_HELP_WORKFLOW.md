# Installed MotionWorks help and keyboard workflows

`mw_code_installed_help` reads the English CHM archives shipped with the installed
IDE. It decompiles to a private temporary directory, converts HTML to inert text,
and retains a session-local index under `.motionworks/references/installed-help`.
It opens no help window, edits no project, and distributes no vendor help content.

1. Call without arguments to list available modules and their source paths.
2. Choose the exact module; call with `module` alone to list topic names/titles.
3. Search with `query`, or read a named `topic`. Results include archive/topic
   hashes and a `mk:@MSITStore:` link to the installed original topic.
4. Read the surrounding context and inspect diagrams when needed. Image references
   are reported because text extraction cannot reproduce keys shown as icons,
   graphical selection state, or connection geometry.
5. Confirm the actual effect of a documented shortcut in the current editor.
   Customized assignments and focus can differ. Documentation is not live evidence.

Examples:

```json
{"module":"EditWiz001","query":"shortcut"}
{"module":"ui_handle001","topic":"keyboard.defaultshortcuts.htm"}
{"module":"GraphEd001","topic":"InlineEditBox.htm"}
{"module":"ST001","topic":"callingfunctionblocksinst.htm"}
```

Useful installed help modules include EditWiz001 (Edit Wizard), GraphEd001
(graphical editing), ST001 (Structured Text), TextEd001 (text editing), var001
(declarations), compile001 (compiler workflow), and errors001 (diagnostics).
Use the actual catalog rather than assuming these exist in every installation.

## Observed and documented shortcuts

Installed 3 Pro help on 2026-10-01 documents Shift+F2 for the Edit Wizard,
Tab/F2 for graphical inline insertion, and Ctrl+Shift+C for connecting selected
graphical points. Live Shift+F2 changed the observed ST Edit Wizard from an empty
list to Favorites containing TON, CTU, CTD and other blocks. Alt+3 is documented
for activating the wizard, but the current accessibility observation did not
prove a focus transition; do not label it live-verified.

F10 is **Online: Debug** in `ui_handle001/keyboard.defaultshortcuts.htm`.
A mistaken generic Windows menu probe was rejected by the IDE before online mode
because the disposable project was not compiled after cleanup. The dialog was
dismissed, and no controller action was completed. Do not use F10 to inspect menus.

For ST calls, installed `ST001/callingfunctionblocksinst.htm` documents inputs in
the instance call and separate assignments from instance output fields. Live
compilation rejected `=>` output arguments; `mw_ide_fb_insert` emits the supported
post-call assignment form and checks declared pin directions/types.

## Extraction and limits

The native decompiler is the existing Windows `hh.exe`, using the installed archive
directory as its working directory and the CHM filename as its argument. Quoted
absolute CHM paths silently produced no files in this environment. Temporary output
must have a usable path without spaces; failure is reported without a UI fallback.
Microsoft documents the [HTML Help decompile switch](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/htmlhelp/decompiling-a-help-file).

Archive selection is restricted to discovered installed English modules. Cache
entries are keyed by source hash and validated before reuse. A changed archive
gets a new index; a mismatched cache stops the call. Queries require an explicit
module to avoid expanding the entire installed help collection unnecessarily.

The Sky desktop helper's capture and indexed geometry failed in this environment.
The Konnect companion later captured the actual graphical editor successfully.
A disposable live FBD probe confirmed Tab inline block insertion, instance
selection, automatic connection at selected pins, constant editing and Ctrl+Z
for a known mistaken scratch insertion. Read `GRAPHICAL_EDITOR_WORKFLOW.md` and
use the actual current companion observation before input. Immediate captures
can show a prior state or tooltip; wait for the observed result instead of
resending an action. Do not interleave native workflows with foreground UI input.
