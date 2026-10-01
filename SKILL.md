---
name: motionworks-iec-use
description: Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code — stage and open a project, read the live object model, read and rewrite POU Structured Text, add variable declarations, compile, and read the compiler's verdict and error text. START HERE: run mw_project_find before anything else, and work only on a project inside the workspace — never on one from elsewhere on the machine, even if you know where it is. Use when the user wants the agent to actually drive MotionWorks IEC rather than only inspect files. Never downloads to a controller and never commands motion.
whenToUse: The user has MotionWorks IEC 3 Pro open or asks for work in it — a real build, a compile verdict, the live project model, reading or changing POU Structured Text, or reading the IDE's error list. ALSO USE WHEN a MotionWorks project is mentioned at all, even to ask a question about it, because the first step is always to find which project is actually in the workspace. For pure offline `.mwt` inspection without the IDE, the file-level tools alone are enough.
---

# MotionWorks IEC workspace editing

Use the installed tools for discovery, staging, IDE editing and IDE verification.
The DEFAULT is IDE-FIRST: the agent actually enters code and declarations in MotionWorks.
Prefer a verified native IDE operation over mouse/grid input. Use known keyboard
commands when the native API does not support the operation; inspect the resulting
state before further input. A retired offline editor is not a native IDE operation.
At startup use `mw_ide_trial` and `mw_ide_state` to distinguish a licence prompt,
loading process, blocked frame and ready IDE. `mw_ide_start` answers the exact Use
Trial control through the native control API and verifies closure. Do not start
another IDE or begin coordinate clicking while that operation is running.
Offline code/variable/POU editors and the unsupported Rebuild API are retired.
For declarations use `mw_ide_variable_change` with the staged project, exact POU
(omit for resource globals), operation, and `baseline_saved:true` only after
reconciling saved edits. Add/edit requires all seven declaration fields and an
existing writable group. Inspect `verification.accepted` before continuing;
failure means stop and inspect evidence, never retry automatically. Delete
requires explicit user approval and reference review; renames require review.
Run fresh Build/Make after the intended edits. This API does not require opening
a worksheet. To inspect or edit a named worksheet, use `mw_ide_open_worksheet`
with kind `variables` or `code`, the staged project, and exact POU (omit only for
globals). Require `accepted:true` before editor input. The tool resolves the
internal document URN from the saved tree and verifies the active view; never
send a slash-style logical name directly to OpenDocument or navigate by guessed
tree coordinates. Code editors report the POU logical name as their active view.
For ST function-block insertion, inspect `mw_code_block_interface` with an exact
block name and library when ambiguous. Use `mw_ide_fb_insert` with a new instance,
exact saved `expected_body`, `baseline_saved:true` and explicit pin bindings.
Outputs and in-out pins require existing direct variables of matching types;
all in-out pins must be bound. The tool declares the instance and inserts the
call through native APIs, retaining completed phases on failure. Inspect that
evidence before another action; never retry blindly. Require accepted read-back
and fresh Build/Make. Graphical insertion remains outside this tool's scope.
For POU structure use `mw_ide_pou_change`: create blank ST PROGRAM/FUNCTION_BLOCK/
FUNCTION (explicit return_type for FUNCTION), copy, rename or delete. Copy/rename
uses `new_name`. Reconcile saved edits and require `verification.accepted`.
Rename/delete requires references_reviewed, including graphical and indirect
calls; the automatic ST scan cannot prove their absence. Delete also requires
explicit user approval. Review task assignments and remaining type/call references.
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

For an existing writable ST worksheet, prefer `mw_ide_code_change`. Read the
current body with `mw_code_read_st`, supply it as exact `expected_body`, and pass
the complete replacement `code` with `baseline_saved:true` only after native
edits are reconciled/saved. This uses the native DDE ChangeCodeWS API, not
keyboard input or a disk-source writer. Comments are resolved from the native
translation XML for full saved read-back. Input currently supports printable
ASCII plus tabs/newlines. Inspect `verification.accepted` and `evidence_path`,
then fresh Build/Make. A failed or uncertain import requires inspection before
another action. Graphical/IL/toolbox workflows still use observed native editors.

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
Read coverage and unresolved interfaces as well as error counts. A missing instance
name match does not prove a program never runs. Preserve native task execution order;
inspect actual bindings, startup/cyclic context and timing in the IDE. This advisory review supplements compiler acceptance and performs no automatic repairs.

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
