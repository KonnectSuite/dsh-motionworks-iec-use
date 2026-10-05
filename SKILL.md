---
name: motionworks-iec-use
description: Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code — stage and open a project, read the live object model, read and rewrite POU Structured Text and Instruction List, add variable declarations, compile, and read the compiler's verdict and error text. START HERE: run mw_project_find before anything else, and work only on a project inside the workspace — never on one from elsewhere on the machine, even if you know where it is. Use when the user wants the agent to actually drive MotionWorks IEC rather than only inspect files. Never downloads to a controller and never commands motion.
whenToUse: The user has MotionWorks IEC 3 Pro open or asks for work in it — a real build, a compile verdict, the live project model, reading or changing POU Structured Text or Instruction List, or reading the IDE's error list. ALSO USE WHEN a MotionWorks project is mentioned at all, even to ask a question about it, because the first step is always to find which project is actually in the workspace. For pure offline `.mwt` inspection without the IDE, the file-level tools alone are enough.
---

# MotionWorks IEC workspace editing

Use the installed tools for discovery, staging, IDE editing and IDE verification.
Use exact registered tool names: `mw_code_task_model` reads the live task model;
there is no `mw_ide_task_model`. An unknown name is a routing error, not proof
that the installed plugin is missing a capability. Check the available catalog
and this guide before making that claim. After intended edits and cleanup,
invoke `mw_ide_build`, then `mw_ide_make`, and inspect `mw_ide_errors` plus
`mw_ide_compile_state`. Build and Make are separate tools; an up-to-date Make
verdict does not establish another fresh compilation. Track requested checks
until they are actually called; disclose any omitted check or corrective follow-up.
Use `mw_ide_errors` directly even when the Message Window is hidden. It can expose
that dock bar through the verified installed native View command; no mouse or
hotkey recovery is needed. If command identity, modal state or resulting pane
identity cannot be proven, it refuses rather than toggling repeatedly. Retain
the diagnostics from fresh Build: Make may clear them, so an empty later pane
does not erase earlier warnings.
The DEFAULT is IDE-FIRST: the agent actually enters code and declarations in MotionWorks.
Prefer a verified native IDE operation over mouse/grid input. Use known keyboard
commands when the native API does not support the operation; inspect the resulting
state before further input. A retired offline editor is not a native IDE operation.
Resolve editor shortcuts through `mw_code_installed_help` before sending keys:
list modules, then search/read the exact installed topic. EditWiz001 covers the
Edit Wizard; GraphEd001 covers graphical keyboard insertion and connections;
ui_handle001 covers general/default shortcut assignments. Shortcuts may be
customized, so inspect their actual effect. Do not use generic Windows F10 menu
assumptions: this MotionWorks installation maps F10 to online mode. Avoid online
commands. Help images may contain symbols absent from extracted text.
At startup use `mw_ide_trial` and `mw_ide_state` to distinguish a licence prompt,
loading process, blocked frame and ready IDE. `mw_ide_state` reports
`trial_dialog`, `trial_dialog_hwnd` and `verifier_running` separately from
`ide_running`: a verifier can be waiting before the IDE frame exists. For an
exact trial prompt use `mw_ide_trial(attempt:true)`, not generic dialog input.
If only the verifier is visible, inspect again rather than launching another IDE.
`mw_ide_start` answers the exact Use
Trial control through the native control API and verifies closure. Do not start
another IDE or begin coordinate clicking while that operation is running.
Offline code/variable/POU editors and the unsupported Rebuild API are retired.
For declarations use `mw_ide_variable_change` with the staged project, exact POU
(omit for resource globals), operation, and `baseline_saved:true` only after
reconciling saved edits. Add/edit requires all seven declaration fields and an
existing writable group. Inspect `verification.accepted` before continuing;
failure means stop and inspect evidence, never retry automatically.
Optional `flags` on add/edit changes explicit boolean retain/pdd/opc/disabled/
not_on_plc/redundant properties through native setters. Omitted flags stay
unchanged; verify all flags and review their effect before compilation.
Delete requires explicit user approval and reference review; renames require review.
For declaration group create/rename/empty delete use
`mw_ide_variable_group_change` with the exact group name, saved baseline and
optional POU (omit for globals). Rename uses `new_name`; delete requires approval,
an empty group and another remaining group. Require `accepted:true` and inspect
retained evidence on failure before further actions. This changes group labels;
moving an existing variable between groups still follows the worksheet workflow.
Run fresh Build/Make after the intended edits. This API does not require opening
a worksheet. To inspect or edit a named worksheet, use `mw_ide_open_worksheet`
with kind `variables` or `code`, the staged project, and exact POU (omit only for
globals). Require `accepted:true`: the tool verifies the native view and two
responsive frames with the expected editor caption. Its `keyboard_focus_verified`
remains false. Observe current editable focus with the connected computer tool
before keys or text; do not use a stale accessibility tree or infer focus from
the native view/caption. An unsettled request may have opened the document already;
inspect it before any next action and never repeat navigation automatically.
Use the same `mw_ide_open_worksheet` arguments with `inspect_only:true` for that
readiness check: it verifies the current editor without OpenDocument or input.
An exact task-instance view is supported only when its native instance type
matches the requested POU and the full worksheet/task-context caption matches.
Inspection cannot establish keyboard focus; native edit APIs do not require it.

For toolbox interfaces, inspect `evidence_kind` before acting. An
`installed-compiled-block-interface` exposes explicit diagnostic cache declarations
matched to a saved dependency, with `insertion_eligible:false`. It can help inspect
pin names, types and directions when the worksheet cannot be decoded, but its
freshness against current source is unverified. Do not treat it as an accepted
insertion signature or substitute it for `installed-declared-block-interface`.
`mw_ide_screenshot` captures without activating or restoring the main frame and
checks foreground/active/focused window identity before accepting the image.
It refuses minimized windows or an unsafe screen fallback. Own-window rendering
may omit an owned inline dialog; use the companion's current observation for
that dialog. A successful capture does not establish editable selection.
If compilation reports `completion_unverified`, inspect native state and the
exact Errors, Warnings and Build panes through `mw_ide_errors`. Informational
messages have the exact pane name `Infos`. An unverified timeout or empty pane
does not prove a busy compiler, damaged POU or success. Diagnostic reads refuse
unknown panes and ambiguous/unreadable controls; do not infer an empty result
from a failed read. Set screenshot:true only when a visual inspection is needed.
The tool resolves the internal document URN from the saved tree; never
send a slash-style logical name directly to OpenDocument or navigate by guessed
tree coordinates. Code editors report the POU logical name as their active view.
For ST function-block insertion, inspect `mw_code_block_interface` with an exact
block name and library when ambiguous. Use `mw_ide_fb_insert` with a new instance,
`expected_body_sha256` set to readable `text_body_sha256` from `mw_code_pous`,
`baseline_saved:true` and explicit pin bindings. Alternatively supply exact saved
`expected_body`. For targeted placement use a unique exact `before` anchor at a
line boundary outside strings/comments; use `offset` only when known exactly.
Omit both to append. The tool assembles the full body internally; do not reproduce
large POUs or ask the user to paste the call. Its returned `text_body_sha256` can
guard a subsequent insertion after checking the accepted result.
Outputs and in-out pins require existing direct variables of matching types;
all in-out pins must be bound. The tool declares the instance and inserts the
call through native APIs, retaining completed phases on failure. Each in-out
variable connects on both sides: the named input binding
and `variable := instance.pin;` after the call. The installed eCLR compiler
requires the same variable on both sides. Preserve these output assignments
when editing existing calls; an input-only in-out binding can fail compilation.
Inspect retained evidence before another action; never retry blindly. Require accepted read-back
and fresh Build/Make. Graphical insertion remains outside this tool's scope.
For saved LD/FBD diagnosis, use `mw_ide_graphical_listing` with the exact POU,
`baseline_saved:true` and a bounded network range (`start`, `limit`). It runs a
fresh Build and requires unchanged complete sources plus clean native state.
The listing, declarations, worksheet and source map must match the POU and have
been regenerated during that Build. It returns raw compiler networks and symbol
annotations. FB pin names/directions come from matching compiler dependency
declarations, checked against the saved instance type and fresh Build. Inspect
`dependency_artifacts` and `compiler_dependency_freshness_verified`; compiler
ordinals can differ from the installed interface order. Private compiler rows
are counted for completeness but never exposed as public pins. Unknown pin
ordinals remain unresolved. The compiler can omit unused POUs; a missing listing stops the
operation. Do not assign a customer POU just to manufacture diagnostic evidence.
Unknown tokens remain unresolved. This is compiler diagnostic
evidence, not proof of canvas placement, pin wiring or runtime behavior. Inspect
the actual graphical editor before graphical edits or reference-clearance claims.
MotionWorks ST uses post-call assignments from instance output fields. The native
FB insertion tool emits that form; do not substitute `=>` output arguments, which
the live compiler rejected here. If compilation marks the project modified, save
and independently compare source/translation hashes before accepting clean state.
For POU structure use `mw_ide_pou_change`: create blank PROGRAM/FUNCTION_BLOCK/
FUNCTION (explicit return_type for FUNCTION), copy, rename or delete. Creation
accepts language ST (default), IL, FBD or LD. Copy/rename uses `new_name` and retains
the source language. Graphical creation requires the verified native empty body;
unknown defaults fail verification. It does not place or wire graphical blocks.
Reconcile saved edits and require `verification.accepted`.
Blank FUNCTION creation is only a structural operation. Define its VAR_INPUT
signature and return logic before Build/Make; the tested compiler rejects a
function without VAR_INPUT declarations.
Rename/delete requires references_reviewed, including graphical and indirect
calls; the automatic ST scan cannot prove their absence. Delete also requires
explicit user approval. Review task assignments and remaining type/call references.
For native source-language conversion use `mw_ide_pou_convert` with the exact
POU, destination `language` FBD or LD, and `expected_body_sha256` returned by
`mw_code_pous`. Set `baseline_saved:true` only for reconciled saved state and
`conversion_reviewed:true` after reviewing replacement of its original source
language/layout/comments. Prefer an isolated copy when generating new graphics.
The tool converts the selected POU in place through native Pou.Convert, requires
fresh compiler artifacts for that exact source, preserves native declarations,
flags/groups/libraries and unrelated sources, then compiles the resulting graph.
Unused POUs may have no compiled source; failure stops without assigning tasks,
retrying or rolling back. Inspect retained phase evidence before another action.
This creates native graphical source through compilation; canvas placement,
individual pin wiring and machine behavior still need separate verification.
For a new FBD POU whose logic can be expressed with supported ST calls, prepare
an isolated ST POU and declarations through the native tools, insert library FBs
with `mw_ide_fb_insert`, then use the reviewed conversion route above. Assigned
TON and TON_Retentive conversion, including both sides of Accum, passed live
compilation and canvas inspection. Read the full graphical listing to verify
every generated network and compiler-resolved pin. Use observed canvas editing
for individual graphical changes; Tab opens the selected operand's inline box.
Verify its focus/text before replacing it, then inspect the settled result and
fresh compiler instructions. An immediate stale screenshot requires another
observation, not another key. See docs/GRAPHICAL_EDITOR_WORKFLOW.md for the
verified two-block constant edit and its limits.
For native POU exchange use `mw_ide_pou_package`: export an exact writable POU
with `baseline_saved:true`, then retain its session-bound `package_token`.
Import accepts only that unchanged native package into the same staged project
with the original POU name absent and `dependencies_reviewed:true`. It checks
library bindings and external globals, preserves native declaration flags/groups
and complete graph/code sources, and refuses overwrites or arbitrary paths.
Tokens expire on plugin reload and are consumed before one import attempt.
Require `accepted:true`, inspect retained evidence after failure, and finish
intended imports with fresh Build/Make. It does not place or wire new blocks.
For tasks use `mw_ide_task_change`: create/edit/delete/assign/unassign. Edit accepts
`settings_changes` for existing field names and imports them through the IDE,
preserving other fields. Unassignment uses the exact `instance` name, which can
differ from the POU type. Unassign/delete requires approval; delete refuses a
nonempty task. Full source baselines are retained at `evidence_path`, with compact
counts returned to avoid repeating whole projects in the conversation. Finish
structural edits with fresh Build/Make and saved-source checks.
No environment flag restores those public tools. Edit through the IDE instead.
For any motion-logic design, diagnosis or review, read `docs/ENGINEERING_WORKFLOW.md`
before proposing code. It supplies the requirements, evidence, timing, FB lifecycle,
PLC authority, registration, cam, stop/recovery and behavioral acceptance gates.
Use `mw_ide_edit_guide(operation: "engineering")` as the short entry checklist.
Continue through the complete authorized edit/read-back/verification loop; do not
stop at a successful tool call or reopen. Never conceal a blocker or bypass safety.
A successful file write is offline evidence only. Report native IDE acceptance separately.
Never download a project, start a controller, or command machine motion.
Use one IDE owner and serialize acceptance workflows. The bridge's single IPC
channel is not verified for concurrent independent harness processes.

## Default: code inside the MotionWorks IDE

For an existing writable ST or IL worksheet, prefer `mw_ide_code_change`.
For targeted edits, get `text_body_sha256` from `mw_code_pous`, read the relevant body
with `mw_code_read_text`, and pass that hash as `expected_body_sha256` plus `changes`, an array
of exact `{find, replace, count}` snippets. Use the readable hash, not `body_sha256` (raw native comment references).
Count defaults to one; specify the exact
count deliberately for repeated text. The plugin reads the full saved body, checks
the hash and every match, assembles changes sequentially in memory, then imports
once and verifies the complete saved result. Stale hashes, ambiguous matches or
missing text refuse before import. Never hand-reproduce a long body or delegate
supported ST/IL typing to the user because the body is large. Do not repeat a
failed mutation automatically: inspect evidence/current state first.
Code and declaration results render compact verification summaries by default;
full inventories remain in `evidence_path` (`detailed_result:true` shows them).
Physical wiring, controller downloads and running-machine tests remain human work.
For a complete replacement, read the current body with `mw_code_read_text`
(or `mw_code_read_st` for ST), supply it as exact `expected_body`, and pass
the complete replacement `code` with `baseline_saved:true` only after native
edits are reconciled/saved. This uses the native DDE ChangeCodeWS API, not
keyboard input or a disk-source writer. Comments are resolved from the native
translation XML for full saved read-back. Input currently supports printable
ASCII plus tabs/newlines. Inspect `verification.accepted` and `evidence_path`,
then fresh Build/Make. A failed or uncertain import requires inspection before
another action. Read `docs/NATIVE_TEXT_WORKFLOW.md` and use the ST/IL native route before editor typing. Graphical/toolbox workflows use observed native editors; the ST FB insertion helper does not emit IL calls.

Read `docs/IDE_FIRST_WORKFLOW.md` before editing. The companion KonnectSuite
`computer-use-mcp` provides `computer` actions for screenshots, clicks, keys and typing.
It is a separate MCP server: loading this Cordis plugin does NOT install or register it.
Confirm the harness actually exposes its computer tool. If unavailable, report that
dependency; do not silently fall back to native file modification or invent tool calls.
`mw_ide_edit_guide(operation)` returns a read-only checklist, not an executed edit.

If the IDE is already open, discover the workspace, inspect `mw_ide_state` and
`mw_ide_status`, and match the active project to its existing stage identity. Continue
that exact verified stage without closing, restaging or reopening it. Preserve unsaved
editor changes: saved files are not the live editor buffer. Read
`docs/OPEN_IDE_REMOTE_ENGINEER.md` for the attach-first workflow and registration-eye
investigation. If status times out or contradicts visible state, do not launch another
IDE or conclude it is closed. Report the API attach failure.

After selecting/staging and opening (or attaching to) the exact project, use the IDE's editors for ST,
code bodies, descriptions, LD/FBD and libraries when no verified native tool is
available. Prefer the native code, declaration, POU and task tools above for their
supported operations; UI actions are the fallback. Do not edit native streams
behind the open IDE. Preserve original code and inspect references before rename/delete.

For each input: observe the current screenshot, choose the target from that observation,
perform one action, then refresh. Before typing click the actual editable surface and
verify focus. Coordinates use the MCP's returned image dimensions, NOT unscaled display
dimensions. Do not copy positions from an old screenshot or from another app/version.
Prefer observed menus and keyboard navigation over blind pixel macros. Unexpected
modal dialogs require inspection; never repeatedly press Enter to dismiss them.

The generic computer tool controls the foreground desktop and cannot enforce this
plugin's workspace guards. Independently confirm MotionWorks is foreground and has
the exact staged project before every edit. If the user changes focus, re-observe.
Do not automate terminals, authentication, security dialogs or other apps. Never
use Online/Download, controller Run/Reset, forces, jogs or test-motion controls.

Save edits through MotionWorks BEFORE reading disk-based tools or using `mw_ide_verify`.
The verifier compares disk source; it cannot certify an unsaved UI edit. Read the
saved ST/variables and task inventory back, compare with the intended change, build
and inspect diagnostics. Close/reopen only with consent and verify persistence.
Report tested capabilities individually; a successful ST smoke does not prove every
FB, graphical command, task operation or library version works.

## Select and bind the project

1. Run `mw_project_find` first. Discovery is confined to the calling session workspace.
2. If no project exists there, ask the user to provide the project in that workspace.
   Do not search Desktop, Downloads, other chats, or remembered paths for a substitute.
3. Select the intended `.mwt` and its expanded directory. If several exist and intent
   cannot be determined from the request, clarify which one is intended.
4. If no matching verified stage is already open, call `mw_ide_stage`. It copies both into `<workspace>/.motionworks/stage/`, rewrites
   the wrapper binding and records source identity. Edit this workspace copy.
5. Pass the selected project explicitly when multiple staged copies exist. Opening
   validates the wrapper's embedded directory and its digest before the bridge acts.

The session header determines the workspace. The DSH profile and plugin installation
folder are not project workspaces. Missing context is a refusal, not an invitation to
fall back to the shell directory. Shared plugin-stage projects from older versions are
not eligible. Another open IDE project is not authorization to edit, save or build it.
Outside references may be inspected using explicitly read-only reference tools; they
must never become the opened or edited target. Do not bypass these guards with COM,
shell scripts, hard-coded project paths, or copied examples from reference documents.
Exports and backups also belong inside the workspace.

## Inspect before changing

For an existing stage, call `mw_workflow_check` with its explicit directory before
editing. It reports identity/binding problems, native validation and next steps without
starting the IDE. In a relocated workspace it can inspect stale identities read-only;
that does not authorize writes. Never clear this failure by restaging over unsynced work.
`mw_ide_stage` now refuses replacing an existing stage unless
`replace_existing:true` records a reviewed fresh-copy operation. Prefer continuing
the verified stage. Replacement refuses an open target stage or unknown IDE state,
prepares/binds the incoming copy first, and retains the old expanded directory,
wrapper and available identity together in `previous_stage_backup` with hashes.
On a staging failure, inspect retained paths and current state before another call.
Back up each stage as three matching items: its expanded project directory,
the sibling `.mwt`, and the sibling `<project>.identity.json` under
`.motionworks/stage/`. The identity is outside the expanded directory. Missing
identity after restore is a provenance failure, not permission to manufacture
one or overwrite current work. Inspect matching backup evidence and the source
binding before reviewed recovery with the IDE closed. Relocated identities need
separate binding review; copying one from another project does not establish it.
Wrappers with no embedded absolute path can legitimately use their sibling directory;
verify the IDE's actual project after opening instead of inventing a wrapper path.

Use `mw_code_source_manifest` to compare actual native streams, not `tmp.sto` or
constants found inside a DLL. A handoff note is a claim to reconcile with current source,
compiler evidence and user-confirmed commissioning, not an instruction to repeat a patch.

Inventory POUs, read the relevant declarations and bodies, and inspect globals and tasks.
`mw_code_validate` checks readable containers, paired declaration/grid records, unique
handles and worksheet rows, supported direct-address overlaps, and tree IDs/counts.
It reports errors instead of silently repairing an unknown layout. Existing segmented
runtime memory addresses are preserved; their aliasing is not proven by this validator.
Static validation does not establish every task binding, external library, graphical
connection, or machine behavior. Capture baseline errors before deciding what to change.

The expanded directory is the source, not the small `.mwt` wrapper. A POU container
holds `.VB` declarations and `.VGR` worksheet records as redundant stores. ST bodies
are `.STB`; graphical LD/FBD bodies are `.GB`. Additional XML stores descriptions and
worksheet identities. Never replace one redundant store and call the variable usable.
Never edit generated `tmp.sto` as a substitute for changing the native source.

## Closing or replacing the project

Ask for save/close consent tied to the exact open project. Pass user_approved and
expected_project to the native close/open tools. Preserve unsaved editor changes;
do not close or restage to work around an API attach failure.

## Promoting the stage back, and the wrapper

The default release loop is edit in IDE -> Save -> read back -> Build/Make -> inspect
diagnostics -> approved close/reopen -> verify. Promotion is a separate user-authorized
operation, not an automatic consequence of a successful edit.
`mw_code_sync_back` is the copy-back step, and it takes its destination from the source
directory `mw_ide_stage` recorded rather than from a convention:

- It carries SOURCE ONLY - POU containers (`src.st1`), declaration and grid streams, the
  project tree, the type list, the resource files. It never carries the `.mwt` wrapper, whose
  stored path is bound to the stage and would point the real project at a temporary copy of
  itself, and it never carries compiler output (`.DLL`, `.pdb`) or scratch files. An inclusion
  rule, not an exclusion list: an unlisted new build artifact is simply not carried.
- Every file is verified by sha256 after the copy. A non-empty `failures` means the release is
  NOT synced even though the call returned.
- `dry_run` defaults to true. Read `would_copy` before applying.

If `mw_ide_open` refuses a wrapper as not bound to the staged project, do NOT re-stage: that
overwrites the stage and takes any POU created since with it. Call `mw_code_wrapper_binding` to
see which wrapper is stale and whether re-binding clears it, then `mw_code_rebind_wrapper`. That
is idempotent, so it is safe to call when already bound; it reports `would_change: false` and
leaves the file digest unchanged.

A POU that is assigned to no task never runs, and a clean build does not prove otherwise - a POU
containing an undeclared variable compiled cleanly while unassigned. `mw_code_tasks` lists the
unassigned set. Assign the program in the MotionWorks Project Tree, then re-run
`mw_code_tasks` to confirm. A build attempted while a POU is unassigned can stall for ~90 s and
end with an empty Errors pane, which is not a clean result.

To ask whether an interface has room for another status value, use `mw_code_eip_map` rather than
reconstructing the address arithmetic: it reads the declared assembly size from the L5X and the
used range from the project's own `%I`/`%Q` addresses. `next_free_word_address` is arithmetic over
what was read, not a claim that the peer program leaves that word alone - confirm the offset on
the CompactLogix side before writing it.

## Declarations and POU lifecycle

Before local/global/external variable edits, read `docs/VARIABLE_WORKSHEET_WORKFLOW.md`
or `mw_ide_edit_guide(operation: "variables")`, which returns that complete guidance.
Never type into the bold Default/group row or column headers. Prefer the observed
native Create Variable Set dialog for additions. First obtain `mw_ide_active_view`
and a successful `mw_ide_variable_plan` token while no dialog is open. Clear unwanted
address/initializer/description values before selecting `VAR_EXTERNAL`, which
disables fields without clearing them. Set one
confirmed labelled field at a time and clear inherited addresses/metadata absent
from the plan. Verify all fields before OK. After native Save require
`mw_ide_variable_verify` accepted:true; `mw_code_verify_variables` remains the
complete-list fallback. These tools do not insert, navigate or send input.
Inline insertion is a separately tested fallback, not an assumed reliable route.
The verifier detects saved
damage; it is not an input interlock and cannot certify unsaved editor contents.

Use the native IDE variable worksheets, ST editors and project commands. Inspect
references before deletion; compare saved descriptions, declarations and task bindings.
Historical native-format notes are engineering evidence, not an editing workflow.
Private engine tests do not authorize offline project mutation.

## IDE acceptance after edits

Prefer `mw_ide_verify(project)` on the exact open stage for validation, Build, Make,
diagnostics and Save in one call. It retains a JSON report in workspace
`.motionworks/verification/`, including failures. With explicit consent use
`close_reopen: true, user_approved: true` for persistence comparison. Do not interpret
an `unverified` verdict as a clean result. The verifier checks program/declaration
streams across Build/Save and all native streams from the saved baseline across
close/reopen; build bookkeeping in PROJECT.TRE is recorded separately, not silently
treated as edited ST. Navigation-only PRMVIEWALL.DAT/PRMVIEWHARD.DAT may normalize;
their hashes and `normalized_view_metadata` are retained in the report. PROJECT.TRE,
program/declaration streams, descriptions and registry metadata remain strict.
If any other native sources change on save/reopen,
inspect both manifests: normalization is possible, but acceptance is not yet proven.

Compile results distinguish `observed_compile_transition`, `already_up_to_date`
(Make only), and `completion_unverified`. A no-op Make is useful state evidence but
not a freshly compiled Build. Report warnings separately from compilation success.

1. Validate the changed project offline and open the exact staged wrapper.
2. Use `mw_ide_build` for Compile(2), which is Build. Make is Compile(1).
   Native Rebuild is a separate command and was not accepted on the installed 1.19 IDE.
3. Inspect the returned verdict, `mw_ide_state`, and `mw_ide_errors`. A posted command
   or cached IsCompiled flag alone does not prove this invocation completed. The bridge
   requires an observed pending-to-compiled transition. If completion cannot be observed,
   it reports unverified; inspect the IDE instead of fabricating a clean verdict.
4. Run Make, inspect errors and warnings, Save All. Only with exact-project consent,
   close gracefully and reopen the same
   wrapper and inspect the changed declarations/body, task bindings and project state.
   Repeat Build/Make when establishing persistence acceptance for a completed change.
5. Report exactly which checks completed, their evidence and any remaining errors.

Native menu automation is version-dependent and can be blocked by dialogs. The unsupported Rebuild API is retired; use the observed native IDE menu if needed. A failed compile does not trigger disk
repair underneath the running IDE. Close safely before restoring a verified backup.
Empty Errors output is not proof of a successful compile. Compiler acceptance is not
machine commissioning, safety validation, or proof that hardware motion is correct.

## Programming references and review

Use `mw_code_reference` before choosing unfamiliar FB pins, variable scope, startup
semantics or task behavior. Omit query to list the reviewed sources; `block` retrieves
one of six reviewed historical interfaces. Return the source revision and page with
advice. Confirm installed IDE, controller and library versions before treating an old
manual interface as authoritative. Native project FB declarations take precedence.
Do not infer pin direction from a caller declaration or guess an unknown interface.

`mw_code_reference_sync` optionally downloads the official catalog PDFs into this
workspace's `.motionworks/references`; it sends no project data. It requires pypdf
and network access. Curated search remains available offline. A source-hash mismatch
requires catalog review, not bypassing the check. Installed legacy manual extraction
is heuristic and must not be presented as a verified source revision.

Call `mw_code_check_program` for existing ST or pass `pou` and proposed `body` before
writing. Check scope/type/range findings, named FB arguments and task candidates.
On the verified clean open project, set `installed_interfaces: true` to resolve
vendor FBs from its bound installed libraries. For duplicate names select the
intended library explicitly, e.g. `interface_libraries: { "TON": "IEC" }`.
Installed ambiguity stays unresolved instead of falling back to an older manual.
Read coverage and unresolved interfaces as well as error counts. A missing instance
name match does not prove a program never runs. `mw_code_tasks` resolves the exact
saved instance-to-PROGRAM-type ownership and exposes task settings and native
order; compare `mw_code_task_model` for live IDE state. Preserve execution order
and inspect startup/cyclic context and timing. This advisory review supplements
compiler acceptance and performs no automatic repairs.

Pass exact diagnostic text to `mw_code_diagnose`. Its documented causes are candidates,
not diagnoses proven by the message alone. Correlate with source locations, types,
library versions and current IDE state. Unknown diagnostics remain unresolved.

Use `mw_code_pattern` for initialization, request edges, nonblocking cyclic sequencing
and Enable/Valid position feedback. Read its assumptions and adaptation checks before
using declarations or ST. These are illustrative examples requiring native compilation;
they do not assign tasks or establish safe machine behavior. Consult
`docs/PROGRAMMING_KNOWLEDGE.md` for versions, supported checks and limitations.

## Delivery report

Summarize the changed workspace project and files, transaction journal, offline checks,
IDE acceptance actually observed, and remaining limitations. The staged copy is the editable
deliverable; promote it to the source project only when the user asks, and do it with
`mw_code_sync_back` so the promotion carries source only and is verified by hash - not with a
blanket directory copy, which drags compiled output over the real project. Reload the AryaAI DSH
plugin after changing its installed code so updated tool schemas and bridge logic are used.
Restart a stale bridge when its protocol version is refused; never weaken the workspace checks
to retain an old bridge.

For graphical editing, call `mw_ide_edit_guide(operation: "graphical")` and read
`docs/GRAPHICAL_EDITOR_WORKFLOW.md`. It supplies the observed inline block-type
placement, instance selection, pin insertion/connection and constant-edit path,
with source/flag and fresh compiler checks. Compiler pin ordinals can differ
from installed interface order. The same guide covers the live LD path: confirm
current menu shortcuts, use F6 for a basic network, F7 for a serial contact and
Ctrl+F7 for a single parallel contact. Name existing BOOL operands through an
observed inline editor or Contact/Coil Properties, preserve declaration fields
and flags, and match the intended expression to fresh compiler instructions.
For a parallel path spanning several contacts, use the observed object-cursor
and multi-selection workflow in that guide: arrow keys move the object cursor,
Space selects and Shift+Space extends selection. Confirm the intended contacts
are selected and the coil is excluded before Ctrl+T. A two-contact spanning
branch compiled exactly as `(Run AND Enable) OR Alternate`, with native flags,
collateral sources and exact cleanup verified. Arbitrary graphs still require
their own geometry and instruction checks. Keep native workflows and desktop
input serialized.

Graphical Tab inline editors can own a temporary foreground window handle.
Observe its visible enabled element metadata and exact operand rectangle, then
use that freshly returned handle for Ctrl+A, typing and Enter. The main IDE
handle may be refused while the inline box is active. Do not omit the handle,
weaken the keyboard guard, or focus the main frame and close the box. See the
graphical guide's inline window identity procedure; commit the box before native
Save/Build.
