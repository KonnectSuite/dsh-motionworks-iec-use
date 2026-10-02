# MotionWorks support-engineer implementation status

This is work in progress. Version 0.5.5 did not establish complete IDE control.

## Proven follow-up patch for 0.5.5

- Trial detection selects only mwctVerify-owned Windows Forms dialogs containing
  an exact Use Trial button, and keeps that button paired with its own dialog.
  Regression cases cover unrelated Windows Forms windows, absent/hidden controls,
  a later buttonless verifier window, and multiple matching dialogs.
- Startup checks trial prompts even when a process or blocked IDE frame exists.
  It performs one UI Automation Invoke (or posted native button action if Invoke
  is unavailable before submission), then checks closure; no blind mutation retry.
- Live startup on 2026-10-01: already_running=false, trial_dialog=true,
  trial_answered=true, IDE version=1.19, ide_enabled=true, blocked=false,
  dialog_count=0. The disposable stage was opened; no controller action occurred.
- Installed Ade.tlb proves Variables.Create has seven inputs: Name, Type,
  BlockType, Description, InitialValue, IecAddress, Retain. The previous probes
  included incorrect argument shapes; these do not disprove the actual API.
- `test/native_api_probe.ps1` created and saved CodexApiLocal in the disposable
  TopCutterCutControl: count 149→150, INT, block type 1, initializer 7, empty
  address, description Native API probe. This is a native-call probe, not yet a
  public guarded addition tool or whole-worksheet collateral-change proof.
- OpenDocument's earlier failures used slash-style logical names or physical
  paths. The native API requires an internal document URN. `@POUS.Name.Sheet`
  and `@HW.Configuration.Resource.Global_Variables` now pass with an explicit
  SAFEARRAY(VARIANT)* in both PowerShell and Python. Public navigation resolves
  the exact saved tree name (including differently named bodies), verifies the
  active logical name, and checks unchanged modified state. Code views report
  `/Pous/Name`; variable views include the worksheet child.
- Public `mw_ide_variable_change` passed local add/edit/delete in the disposable
  stage: counts 150→151→151→150, complete saved and raw native declarations
  matched, with native flags preserved. Saved comment padding is normalized only
  for baseline alignment; exact raw native before/after checks remain intact.
- Full regression suite and package dry-run passed. Native global/external
  lifecycle additionally passed: globals 164→165→165→164, externals/local
  150→151→151→150, complete declaration/flag preservation throughout. Group
  moves remain refused.
- After the local lifecycle, fresh Build passed with an observed pending-to-
  compiled transition (6.9 seconds), modified=false. Make settled successfully
  as already up to date (2.2 seconds). No controller action occurred.
- After global/external lifecycle and navigation, fresh Build again passed with
  an observed compile transition (4.7 seconds), modified=false; Make settled
  already up to date (2.2 seconds).

## Required remaining capability evidence

Native structure follow-up: public POU PROGRAM create/rename/copy/delete passed
with counts 7→8→8→9→8→7. Blank ST FUNCTION_BLOCK and FUNCTION (INT return type)
create/delete passed. Function return types live in the PROJECT.TRE POU record;
LIST.POU's third column is blank. All unrelated program streams, declarations,
globals and tasks remained unchanged. Public task create/settings edit/assign/
unassign/delete passed with counts 5→6→6→6→6→5. Settings changed interval to
T#20ms and priority to 5, preserving watchdog and empty display fields. A distinct
instance name was assigned and removed by that exact name. Native cross-reference
Update/ExportToCsvFile also passed without source edits, producing a local CSV;
this export is variable-reference evidence, not proof of every indirect call.
After cleanup, fresh Build passed with an observed compile transition (4.8 s),
compiled=true and modified=false; Make settled already up to date (2.3 s). The
installed package exposes 53 definitions in a fresh module load and reads the
same native inventory (7 POUs, 5 tasks). The running Arya host still needs reload.
Structural plans are saved before mutation; full saved/native before/after
evidence remains available even when a native operation fails partway through.

POU rename/delete still requires reviewed graphical/indirect references: the ST
token scan does not cover three LD POUs in this fixture. The evidence lists those
POUs. Current live structure proofs use disposable, newly created unused POUs;
do not generalize them to arbitrary populated or protected POU conversions.

| Requirement | Evidence needed / current status |
|---|---|
| Startup and trial | Passed disposable launch; install reload still required |
| Named worksheet navigation | Native code/local/global navigation passed; exact saved-tree URNs and active views verified in two POUs |
| POU add/edit/delete | Native blank ST/FBD/LD creation and populated ST/LD lifecycles passed with independent saved/native inventory and collateral checks; graphical body editing/wiring remains unverified |
| Local/global/external variables | Public native add/edit/delete and full saved/native comparisons passed for all three scopes; group moves remain refused |
| Tasks and POU assignment | Public native create/settings edit/assign/exact-instance unassign/delete passed; controller-specific timing acceptance remains separate |
| POU code editing | Public native ST import/replacement/clear passed with exact saved code/comments, declaration/flag and collateral checks; stale-body refusal; fresh Build/Make passed. Printable ASCII input; graphical/IL routes remain incomplete |
| Toolbox and FB insertion | Installed interface/pin inspection, editor insertion/wiring, declaration and build verification; incomplete |
| Support-engineering judgment | Version-aware reference lookup, engineering diagnosis and tested operation workflows; existing guidance alone is insufficient |

Native code follow-up: `mw_ide_code_change` uses
`ChangeCodeWS <POU> ST <worksheet> "<input path>"` through ExecuteDdeCommand.
Parenthesized/bracketed command strings were rejected; the native parser expects
space-separated arguments. The input is a private import file, not a modified
native source stream. Native ST comments are references into the worksheet's
translation XML, now resolved in readable source and included in baseline hashes.
The public disposable workflow passed create, code/comment replacement, stale-body
refusal, comment-only replacement, empty-body clearing and delete. Fresh Build
while the code was present passed with observed compile transition (6.2 s),
compiled=true and modified=false; Make settled up to date (2.2 s).
New POU variable storage is initialized within creation before Save, preventing
the next native variable read from unexpectedly dirtying a just-created POU.
The full regression suite passes with 54 tool definitions. The running Arya host
still needs reload before its catalog can be claimed current.
The installed package was hash-verified (116 files), and a fresh installed module
exposed all 54 tools. After test cleanup, it read the original 7 POUs/5 tasks;
fresh Build passed (5.1 s) and Make settled up to date (2.2 s). Full program-stream
and translation-file hashes were identical before/after this compilation.
Evidence: `native-code-cleanup-build-500b088f-3051-40e8-b16c-a78ba8124e4f.json`
in the disposable workspace's `.motionworks/verification` directory.

Next implementation: populated POU workflows and toolbox/FB insertion, plus
actual Arya host reload and end-to-end operation. Do not mark the support-engineer
objective complete from native ST editing alone.

## Latest native FB and installed-help follow-up

Commit b61192a was pushed to main as a 0.5.5 patch and installed with 120
hash-verified package files; a fresh installed module exposed 56 tools.
Native variable insertion now accepts an existing empty writable group, enabling
the first declaration in a newly created POU. Absent FB declaration metadata is
null, matching saved/native read-back rather than producing false disagreements.
The live-bound catalog exposed 685 project/library/firmware blocks without an
unavailable library. Pin directions/types come from user-library declarations or
firmware .PT parameter tables; IEC/eCLR implicit bindings are labeled separately.

The public ST FB insertion tool retains its plan and mutation phases, creates an
instance through the native variable API, imports the call through native DDE,
and independently verifies the source. It stops on partial failure without retry.
The standard TON and Yaskawa TON_Retentive calls require the output-assignment
form supported by this IDE. An initial `=>` form was rejected by the compiler and
corrected; the generated replacements compiled with a fresh observed transition
(8.9 s). Compiler Save cleared modified state without changing any program-stream
or translation-file hash; Make settled up to date (2.7 s). The unused disposable
test POU was removed with accepted native/saved collateral verification.
The corrected public workflow was then rerun from creation through cleanup and
passed completely: four declarations, standard TON and toolbox TON_Retentive
insertion, fresh Build (10.1 s, compiled=true, modified=false), and Make (2.4 s).
The cleanup assertion matched the original complete program/translation hashes,
POUs, tasks and globals. Retained evidence:
`native-fb-live-d418609b-6d17-4a61-b5f0-0b26ece3d125.json` in the disposable
workspace's `.motionworks/verification` directory.
After that complete cleanup, fresh Build passed again (8.9 s) and Make settled
up to date (2.5 s), both compiled=true and modified=false. All program-stream and
translation-file hashes remained unchanged. Evidence: `native-fb-cleanup-build.json`.

The installed CHM reader now exposes `mw_code_installed_help` (57 definitions in
the current checkout). Live reads cover 38 installed English archives and exact
Edit Wizard, graphical inline insertion, default-shortcut, and ST FB-call topics.
Its parser strips executable HTML content and preserves text/table boundaries and
image references; source and topic hashes accompany excerpts. Tests cover archive
binding, query/topic restrictions, cache reuse, cache corruption refusal and source
version changes. Full regression tests pass. See INSTALLED_HELP_WORKFLOW.md.

Arya was launched through its installed app entry and exposed its normal current
workspace/session UI. The desktop profile and packaged host both include the
MotionWorks bundle. This verifies startup/configuration, not a successful Arya-led
operation or current in-process tool catalog. Computer-use screenshots fail with
FrameArrived/window capture timeouts, and indexed clicks lack geometry. Text-only
accessibility succeeds. The live Shift+F2 shortcut opened the populated Edit Wizard;
Alt+3 focus activation remains unproven. F10 was incorrectly tried as a generic
Windows menu key, produced the rejected online-mode dialog, and was dismissed.
Installed help now confirms its Online: Debug assignment, and the skill forbids it.

Remaining acceptance: complete populated/graphical POU editing, observed graphical
FB placement/wiring, and end-to-end tool use from Arya. The overall support-engineer
goal remains active; neither a help reader nor ST FB compilation proves those flows.

Deployment: help follow-up commit 6780d09 was pushed to main and installed as
0.5.5, with 123 package files copied and hash-verified. A fresh installed module
exposed 57 tools and its bundled Python helper successfully searched the installed
Edit Wizard shortcut topic in the disposable session workspace. Backup:
`Arya-restored-hotfix-20261001-183752-22c86879`. The visible Arya session
showed disabled Send and inactive child agents before a reload attempt. Follow-up
inspection found that Alt+F4 hid its window but left the process alive. Launching
its installed app entry restored the same window/process, not a cold restart.
The live host catalog/reload and an Arya-led operation remain unverified;
no forced termination was performed.

## Populated POU acceptance and collateral verification

The populated ST workflow passed through the public tools on the disposable
TopCutterCamSetup source (5205 readable characters, 12 declarations): native copy
to CodexPopCopy, full code/comment import including a new executable local INT
assignment, rename to CodexPopEdit, fresh Build (5.1 s), Make (2.2 s), and deletion.
Declarations and native flags remained intact. Final POUs/tasks/globals and complete
program/translation hashes matched the original seven-POU baseline. Multi-line
comment line endings are normalized by native import/translation XML; the live
test compares normalized EOLs, preserving all other text. The complete rerun passed.
Evidence: `native-populated-live-14e9c736-e0f0-43ae-9ae5-7894f17a70e6.json`.

Populated LD lifecycle also passed: ServoTaskSlow native copy to CodexLdCopy,
rename to CodexLdEdit, fresh Build (6.6 s), Make (2.3 s), and deletion. The copied
graphical body bytes/declarations and all unrelated sources remained unchanged.
Final complete inventories and source/translation manifests matched the original.
Evidence: `native-graph-lifecycle.json`.

A no-op ChangeCodeWS LD attempt using the exact copied native GB stream returned
3 and changed no program stream, translation file or modified state. This is a
rejected route, not proof that all graphical APIs are impossible. No retry or
hand-edit of the graphical native container was performed. Evidence:
`native-graph-noop-probe.json`. Graphical insertion/wiring acceptance remains open.

Structural verification now compares the union of original/final program-source
and translation-file paths outside the explicitly affected POU folders. It detects
unrelated additions, removals and changes, including unused translation records
which a readable-body comparison alone might miss. Injected regressions pass,
and the stricter guard passed the live populated ST and LD operations.
The support diagnostic for the observed illegal `>` token is a conditional candidate:
inspect the exact source, then consult the installed ST FB-call help if it uses
`=>`. It does not assume every greater-than error has that cause or edit automatically.
After final cleanup, the original seven POUs/five tasks compiled again with a fresh
Build transition (4.7 s) and Make (2.3 s), compiled=true and modified=false.
Complete source/translation and inventory comparisons passed before/after this
compile. Evidence: `native-populated-cleanup-build.json`. The full regression suite
passes with 57 definitions and 22 programming/reference tests.

## Native graphical POU creation

The public POU tool now accepts creation language ST (default), FBD or LD.
MotionWorks IEC 3 Pro / Ade 1.19 created two independent blank PROGRAMs per
graphical language with identical 292-byte GB bodies and SHA-256
`09985918e42e9108dd10f5d67cbafa125bd4938821c6c6efe160e735b49492bb`.
The saved reader now distinguishes the leading worksheet record kind (11 LD,
12 FBD) from its project-specific node handle; a GB extension alone is insufficient.
Graphical blank verification accepts only this exact observed body, not arbitrary
short, zero-filled or unknown-version graphical streams. Unknown defaults fail
verification and retain evidence for inspection.

The complete public workflow passed for PROGRAM, FUNCTION_BLOCK and FUNCTION in
both languages: six creations, exact saved/native language and blank-body checks,
function input declarations through the native variable API, fresh Build (5.1 s),
Make (2.2 s), and all six deletions. Complete original seven-POU inventories,
five tasks, globals and program/translation manifests matched after cleanup.
Evidence: `native-graph-creation-live-1375ce21-594c-4912-94c4-075bf76a0fc1.json`.
The initially blank functions produced `VAR_INPUT declaration missing!`; adding
the test signature natively resolved this. Creation remains a structural operation,
not proof of function return behavior. Guidance now requires the intended interface
and return logic before compiling. Regressions cover saved graphical identity,
unknown bodies, unsupported languages and incorrect saved-language verification.
The full regression suite passes with 57 tools. Graphical body editing/wiring and
an end-to-end Arya-led operation remain open; the overall goal is not complete.

The original seven POUs compiled after cleanup with fresh Build (4.8 s) and
Make (2.2 s), compiled=true and modified=false. All program/translation hashes
and inventories remained unchanged. Evidence: `native-graph-creation-cleanup-build.json`.
Deployment copied and hash-verified all 123 package files as 0.5.5; backup:
`Arya-restored-hotfix-20261001-192540-d941e40f`. A fresh installed module exposes
57 tools with ST/FBD/LD creation and its installed helper correctly reads the
three original LD POUs. This does not prove the current Arya process reloaded
its tool catalog.

## Native navigation and visible editor readiness

The native active-view API reported a newly opened blank FBD document before
the computer tool observed its visible editor. The returned window title changed,
but its accessibility tree still named the earlier ST document. A later window
listing exposed a transient Not Responding ghost, while native metadata remained
readable. MotionWorks recovered without termination. Screenshot capture failed
with `FrameArrived timed out` and `window capture timed out`; after an observation
kernel reset, current accessibility was null for both MotionWorks and Arya.
No keyboard/text/click input was sent against this inconsistent observation.

Navigation now refuses false/unknown frame responsiveness before OpenDocument.
After the one native request, it requires two responsive observations with the
expected editor caption, exact native active view and unchanged known modified
state. It returns the distinct native/frame verdicts, settled observation count,
and `keyboard_focus_verified=false`. An unsettled action reports accepted=false,
action_performed=true and asks for inspection, never an automatic second open.
Caption is only a readiness check; project path, staged identity and saved URN
remain the identity checks. Native declaration/code APIs still need no editor focus.

Eight injected regressions cover ready, unresponsive, unknown, stale/absent caption,
wrong view, modified-state drift and unknown baseline. Live FBD code/local-variable
navigation passed before the unused test POU was deleted. The final public guard
also passed ST code, local variables, populated LD code and globals with two ready
observations each and complete source/declaration/task/translation preservation.
Evidence: `native-navigation-readiness-live-34b41686-e259-4291-a96b-b2e2b3b860af.json`.
Original seven-POU cleanup and fresh Build (6.7 s)/Make (2.5 s) passed. Build set
modified=true; native Save cleared it with all inventories/program/translation
hashes unchanged. Evidence: `native-editor-readiness-cleanup-build.json`.
The full 57-tool regression suite passes. Current graphical keyboard insertion,
wiring and an Arya-led session remain unverified; the overall goal remains active.

Deployment: all 123 package files were copied and hash-verified as 0.5.5, with
backup `Arya-restored-hotfix-20261001-194509-7212c087`. A fresh installed module
exposes 57 tools and its native global navigation returned two responsive,
matching editor observations, focus_verified=false, compiled=true, modified=false.
Complete source/inventory comparison passed. Evidence: `installed-editor-readiness.json`.
This is installed-module acceptance, not proof that the existing Arya process
reloaded its catalog or performed an engineering task.

## Companion routing correction and graphical observation retry

The companion pairing guide still directed source, variable and POU edits to
desktop tools. It now explicitly routes supported declarations, ST code/block
calls, POU lifecycle and task operations through the verified native tools, and
reserves desktop input for graphical placement/wiring and unsupported operations.
It also distinguishes native caption readiness from current desktop observation
and keyboard focus; stale worksheet trees must not supply input targets.

A fresh disposable `CodexGraphKeyboard` PROGRAM/FBD creation and native navigation
passed. Desktop capture again failed with `FrameArrived timed out` and then
`window capture timed out` after refreshing the returned window. Accessibility
still named the previous globals worksheet. The same live MotionWorks process
alternated between responsive and unresponsive observations, then recovered
without termination. After a desktop observation kernel reset, its returned
window title named the FBD document but accessibility was null. No desktop input
was sent; this does not verify graphical insertion or wiring.

Native deletion of the unused, blank, zero-variable test POU passed and restored
the complete original seven-POU, five-task, global, program-source and translation
baseline. Evidence: `graph-keyboard-baseline.json`,
`graph-keyboard-responsiveness.json` and `graph-keyboard-cleanup.json` in the
disposable workspace verification directory. Desktop observation remains the
current limit for the graphical keyboard route. Other native operations remain
available; the full support-engineer goal remains active.

Cleanup fresh Build (6.9 s) and Make (2.5 s) passed with compiled=true and
modified=false. All complete baseline inventories and program/translation
manifests matched. Evidence: `graph-keyboard-cleanup-build.json`.
