# MotionWorks IDE-first workflow

For supported operations, prefer native APIs: `mw_ide_open_worksheet` resolves
the exact code/variable document; `mw_ide_variable_change` manages declarations;
`mw_ide_pou_change` creates blank ST/IL/FBD/LD POUs and manages copy/rename/delete; and
`mw_ide_task_change` manages tasks, settings and exact program instances.
`mw_ide_code_change` patches existing ST/IL bodies through native ChangeCodeWS:
prefer `expected_body_sha256` set to `text_body_sha256` from `mw_code_pous` plus exact `changes` snippets
(`find`, `replace`, optional exact occurrence `count`, default one). Read the
relevant code with `mw_code_read_text`; the plugin assembles the full replacement
locally after checking the saved hash and every match. This avoids hand-reproducing
large bodies. For complete replacements, supply exact `expected_body` and ASCII `code`,
and reconcile/save before calling. It verifies code and native comment translations,
declarations/flags, globals, tasks and other POU sources, retaining full evidence.
These use the running IDE and verify saved/native results without mouse input. Require
their accepted verdict, retain the verification report and finish Build/Make.
Code and declaration results render compact summaries; full evidence is retained
on disk and can be shown using `detailed_result:true`. A large POU is not a reason
to ask the user to perform supported native edits manually.
The UI recipes below remain fallbacks for editor operations not yet automated.
For new ST FB instances, resolve the installed interface with
`mw_code_block_interface` and use `mw_ide_fb_insert` with explicit pin bindings,
readable `text_body_sha256` supplied as `expected_body_sha256`, and a unique exact
`before` insertion anchor (or explicit character offset; default is append).
It creates the declaration and call natively, retaining completed phases if a
later step fails. Do not repeat a partial insertion or ask the user to retype a
large body. Verify the result and compile the intended task/POU context.
In-out pins generate both `Pin := variable` in the call and
`variable := instance.Pin;` after it. The installed eCLR code generator requires
the same variable connected to both sides; retain that post-call assignment.
See installed eCLR_001 topics TheVARINOUTParameterIsNotConnectedToAVariable.htm
and TheVARINOUTParameterIsConnectedToDifferentVariables.htm.

Native navigation distinguishes the COM active-view identity from visible editor
readiness. It requires two responsive frames and the expected editor caption before
`accepted=true`. Caption is a readiness check; the full native project path and saved
URN remain the identity checks. `keyboard_focus_verified=false` requires a current
editable-focus observation through the connected computer tool before input.
If OpenDocument reused a task-instance editor, the native instance must resolve
by exact logical name and type to the requested POU, and its complete caption must
match the requested worksheet and exact configuration/resource/task/instance.
After an unsettled navigation, use `inspect_only:true` with the same target to
check readiness without opening another document or sending input. A mismatched
current worksheet remains refused. Inspection returns action_performed=false.
If the frame is unresponsive/unknown or its caption still names an earlier editor,
stop and inspect the existing request rather than opening again or sending keys.

For POU creation, set `language` to `ST`, `IL`, `FBD` or `LD` (default `ST`).
Copy retains the source language. FBD and LD share the `.GB` extension, so the
reader uses the exact saved tree record to distinguish them. Graphical creation
accepts only the native empty body observed on MotionWorks IEC 3 Pro / Ade 1.19;
an unknown default fails verification. This does not insert or connect graphical
blocks. Inspect retained evidence on failure before taking another action.
Blank FUNCTIONs still need a VAR_INPUT signature and return logic. In the tested
IDE, compiling a function without inputs reports `VAR_INPUT declaration missing!`.
Use the native declaration tool to define the intended interface before compiling.

## Architecture and dependency

Arya's MotionWorks Cordis plugin supplies workspace identity, staging, native read-only
inspection, programming references, guarded IDE object-model operations and verification.
KonnectSuite/computer-use-mcp supplies the actual visible editor interaction. Register
both in the harness. This plugin does not pretend its checklist executes UI actions.

Use the local repository build, not `npx computer-use-mcp` when intending to use the
KonnectSuite fork. The npm package metadata still names the upstream repository.

```json
{
  "mcpServers": {
    "konnect_computer_use": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\computer-use-mcp\\dist\\main.js"]
    }
  }
}
```

Run `npm ci` and `npm run build` in that checkout first. Prefer stdio. This local fork's
optional HTTP listener now requires `MCP_HTTP_TOKEN`, accepts its bearer token on every
request, and binds only to `127.0.0.1`. Do not expose desktop control to a network.
Loading an MCP server into Codex and into Arya are
separate configuration operations. Reload each host to acquire a fresh tool catalog.
Installed files and a fresh standalone module load do not prove the existing chat
catalog refreshed. After an app update completes, verify the installed plugin
selection and a new host catalog before treating it as ready. An app installer is
not the running chat host. Do not change an active installer or repeatedly launch
the desktop app to manufacture this evidence.
Keep approvals enabled for desktop actions and supervise initial commissioning.

The computer tool schema has `action`, optional `coordinate:[x,y]` and optional `text`.
Examples below are tool arguments, not terminal commands:

```json
{"action":"get_screenshot"}
{"action":"left_click","coordinate":[420,260]}
{"action":"key","text":"ctrl+s"}
{"action":"type","text":"(* reviewed offline-only smoke comment *)"}
```

These coordinates are illustrative, never a reusable MotionWorks macro. Interpret
coordinates in the **returned image_width/image_height** space. Screenshots may be
downscaled; the server scales inputs back to desktop coordinates. The tool is desktop
global, not window-scoped, and returns `ok:true` for input submission, not edit acceptance.

## Identity, backup and focus

When the selected backed-up workspace project is already open, use the
[attach-first workflow](OPEN_IDE_REMOTE_ENGINEER.md). The sequence below is for a new
disposable session; staging/opening is not required again for every code request.

1. Inspect `mw_ide_status`, then use `mw_project_find` to confirm the intended
   project is in the session workspace. If it is already open, reconcile Save All
   and call `mw_ide_attach` to make a verified backup; continue in place.
2. For a closed IDE, call `mw_ide_attach` on the workspace `.mwt` after first-backup approval.
3. Inspect `mw_ide_status` and `mw_ide_state`. Obtain consent before replacing/closing
   a user's existing project. Do not assume a modal or COM failure means the IDE closed.
4. Verify the IDE opened the exact selected workspace wrapper.
5. Take a computer screenshot. If MotionWorks is not foreground, select its observed
   window/taskbar entry and observe again. Never send editor shortcuts into another app.
6. Capture baseline Build diagnostics. Existing warnings must not be attributed to the change.

## Editing recipes (UI-guided, version dependent)

Call `mw_ide_edit_guide` for a concise operation checklist. Menu labels, controls and
keyboard shortcuts must come from the installed IDE's observed UI or help.

For local/global/external variables, first read
[Variable worksheet safety](VARIABLE_WORKSHEET_WORKFLOW.md). Prove native insertion
created a new data row before typing; Default is a group, not an insertion row.
Use `mw_code_verify_variables` after Save against the full planned declaration list.

| Operation | Native editor workflow | Acceptance evidence |
|---|---|---|
| ST body | Open the POU body; confirm ST; click text editor; verify focus; replace only intended text | Visible text, Save, `mw_code_read_st`, fresh compiler verdict |
| POU variables | Open `<POU>V`; insert/edit native worksheet row; set name/type/usage/address/init/description | Visible row, Save, declaration read-back and compiler |
| Globals | Open resource Global_Variables; use native row editor | Correct resource, correct direct address, no overlaps, read-back |
| External declarations | Add VAR_EXTERNAL to each consumer using native variable editor | Name/type agree with global; compile assigned consumer |
| POU create/edit/delete | Use Logical POUs native commands; select language/kind; inspect references before rename/delete | Logical inventory, task references, Save, reopen and compile |
| LD/FBD | Use graphical editor/Edit Wizard; insert elements and wire observed pins | Visual connection review, actual installed FB interface and compiler |
| Task assignment | Use native Project Tree instance command or guarded supported IDE object-model tool | Task/resource/cycle/priority/order, live model and saved tree agree |
| Libraries | Use native Libraries command; select approved local library/version | Resolved interface/version and all consumers compile after reopen |

There is no guarantee of universal arbitrary FB or FU support just because one block
worked. Inspect the installed interface, pin direction, instance declaration and library
version before insertion. Never reverse engineer an unknown graphical binary as a UI fallback.

Take one action per observation and refresh afterwards. Verify focused field before
typing. For tables, verify each committed row before moving on; a Tab chain can silently
shift after optional columns/dialogs. For long ST, inspect visible start/end, Save and
read back the **entire** saved body to detect missing characters or truncation. Do not
use blind select-all outside an observed ST editor. Never paste commands into terminals.

The live test exposed four important traps:

- A screenshot immediately after input can show the old state. If the expected change
  is absent, take a follow-up screenshot before repeating input. `ok:true` means only
  input submission. A brief settling interval is not evidence of completion.
- Native Unicode `keyboard.type` dropped newlines in this Windows ST editor. The local
  computer-use fork now normalizes CRLF/CR and sends line breaks as explicit Enter keys.
  Only send multiline text to a confirmed multiline editor: Enter can submit a dialog.
  Inspect indentation and saved source after typing; the IDE may auto-indent.
- An existing variable name can be appended to rather than replaced. One test produced
  `NewVar1iSmokeValue` rather than `iSmokeValue`. Read the full saved declaration; never
  assume double-click selected all text. Ctrl+A in worksheet navigation selects rows,
  not necessarily text inside a cell. Re-observe and verify edit mode first.
- Ctrl+S saved only the active worksheet in this test. Another ST tab remained dirty.
  Use the observed File > Save All command before whole-project read-back/verification.

## Build and persistence loop

Save in the IDE first, then read native source. `mw_ide_verify` starts from disk and
cannot certify unsaved UI text. Compare intended code/declarations with read-back before
verification. A POU must be assigned to the intended task to establish execution context.

Run fresh Build, Make, inspect Errors and Warnings, and retain the verification report.
Differentiate an observed fresh compile from cached `already_up_to_date` Make. Empty
Errors alone is not success. Native Rebuild was not accepted by the current 1.19 bridge;
do not represent Build as Rebuild. Use the observed native menu if testing Rebuild.

With consent Save/close/reopen the exact project, inspect edits and task bindings again,
and compile again. Report compiler acceptance separately from hardware commissioning.
Never Download, Run/Reset a controller, force I/O, jog or command motion under this workflow.

## Retired offline editors

Native inspection, manifests and diagnosis remain available. Eight offline code,
variable and POU editor tools have been removed from the public catalog, as has the
unsupported Rebuild API. The old environment opt-in cannot restore them. Use the
verified native declaration/code/POU/task tools first. Use observed graphical
editors/import dialogs for unsupported operations. Private engine
fixtures retain historical format/rollback coverage; they are not an agent workflow.
See [retired tools and replacements](TOOL_RETIREMENT.md).

Staging/rebinding, backup recovery and authorized source promotion are infrastructure,
not coding inside the IDE. They remain separately guarded and must never overwrite
unsaved work. Do not sync back or promote without the user's request.

## Initial installation evidence, 2026-10-01 (before interactive edits)

The KonnectSuite MCP checkout was cloned and built on this PC. Its tests passed:
9 passed, 1 skipped. A real stdio MCP client completed initialize/tools-list and called
`computer:get_screenshot`, returning a 1464x823 PNG. No keyboard/mouse edit was executed
by that smoke. Codex's bundled window capture timed out after its bounded recovery;
loading the MCP SDK into node_repl also encountered module restrictions. The registered
MCP needed an available host connection before interactive IDE tests. The subsequent
interactive session below used the actual authenticated loopback MCP transport.
Codex registration was verified with `codex mcp get`: enabled stdio, 30-second startup,
60-second tool timeout, per-call approval prompts. Non-breaking npm security updates
removed the production high-severity SDK findings; seven moderate transitive runtime
findings remain in nut-js/Jimp/file-type. Do not describe this install as vulnerability-free.
The patched SDK required a small HTTP-only TypeScript optional-property compatibility
change in `src/main.ts`; the rebuilt stdio server is the configured transport.

This is **not** evidence that ST/variable/POU/task/library UI editing has all been smoke
tested in this run. Retain separate pass/fail evidence for each operation, on disposable
projects, including save/reopen. Earlier native ST/variable edits and IDE object-model
task assignment compiled, but offline assigned-POU deletion did not reopen successfully.

## Real IDE-first edit evidence, 2026-10-01

After the user brought MotionWorks to the foreground, an authenticated local connection
to the actual KonnectSuite computer MCP performed these operations on a fresh workspace
copy, without native code writes:

| Operation | Observed result |
|---|---|
| Open exact disposable wrapper | Project Tree displayed the UUID smoke workspace |
| Create Program/ST using native Insert dialog | `CodexIdeSmoke` appeared with T/V/body worksheets |
| Type ST through visible editor | Two local assignments; corrected multiline entry visibly preserved three lines |
| Add local variables in native V worksheet | `xSmokeResult:BOOL`, `NewVar1iSmokeValue:INT` saved and read back |
| Edit variable type/description | INT type and BOOL description read back from native stores |
| Assign Program instance using task context menu | `SlowTsk` contains `CodexIdeSmoke`; saved task inventory agrees |
| File > Save All | Full saved body and declarations inspected; comment stored using native translation marker |
| Build > Rebuild Project | Fresh generation visibly included `CodexIdeSmoke`; completed with 0 errors, 22 warnings |
| Native Make (F9) | Generation observed; completed with 0 errors, 0 warnings |
| Approved File > Close Project and exact-path reopen | ST comment/assignments, BOOL/INT locals, description and SlowTsk instance persisted visibly |
| Native Make after reopen | Generation observed; included `CodexIdeSmoke`; completed with 0 errors, 0 warnings |
| Original project hash comparison | Original expanded source remained unchanged |

No baseline was compiled before edits, so the 22 Rebuild warnings are not classified as
pre-existing. No download or motion operation occurred. Globals, LD/FBD creation,
libraries and UI deletion were not tested in this run. Reopen persistence was explicitly
approved and observed, not inferred from compilation. The smoke tests do not prove every
tool or every FB/FU interface. Tests of the computer fork passed: 14 passed, 1 skipped;
the MotionWorks plugin regression suite also passed.

`test/ide_ui_session.mjs prepare --workspace <parent> --source <workspace .mwt>` prepares
an isolated copy using public discovery/staging tools and captures before hashes.
`inspect --workspace <created smoke workspace>` reads the saved smoke POU, tasks and
original source hashes. It never types into the IDE or writes native POU/global streams.
For new work, prefer the verified native editing tools listed above. Use the
computer tool for unsupported editor operations and retain the actual screenshots
and compile outcome; the historical UI smoke recipe is not the default for routine
declaration or ST/IL edits.
`verify --workspace <smoke workspace>` runs the guarded IDE verifier and retains its JSON
report; it does not close/reopen automatically. After separately approved and observed
UI close/reopen, `reopen-inspect --workspace <smoke workspace>` checks that the saved ST,
declarations, POU/task inventories and original-source hashes still match the prior
verification. This read-back check itself does not prove the UI was reopened: retain the
actual screenshot and post-reopen compiler evidence too.
