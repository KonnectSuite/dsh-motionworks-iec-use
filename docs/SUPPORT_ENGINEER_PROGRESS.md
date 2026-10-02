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

## Graphical compiler-network inspection

Added `mw_ide_graphical_listing` for saved LD/FBD diagnosis without desktop input.
It requires a reconciled saved baseline, performs a fresh observed native Build,
checks clean compiled state and complete source/inventory preservation before
and after reading, and requires all four compiler artifacts to have been written
during that Build. Exact listing/declaration POU headers, worksheet identity and
source-map paths must agree. Hashes/timestamps and full baselines are retained.
Compiler networks are bounded by start/limit; known declaration tokens receive
name/section annotations. Unknown tokens remain verbatim, with no inferred pin,
layout, wiring or runtime verdict. The tool never edits or decodes graphical GB.
The reader does not combine unrelated neighboring `.DIP` cache records; one
observed record had a different block header despite sharing the listing stem.

The final public guard passed all three populated LD POUs: EIP_ToCLX (10 networks,
Build 4.7 s), ServoHoming (25, 4.7 s), ServoTaskSlow (5, 4.3 s). Evidence respectively:
`graphical-listing-d976b197-8eec-4bde-8229-cb15defc1dd3.json`,
`graphical-listing-ef2edd63-ae2e-4440-a78c-1aa94d9db10a.json`,
`graphical-listing-27f16be7-1b78-4edc-8b0c-f2caf2add5c9.json`.
An unused disposable blank FBD PROGRAM was omitted by the compiler and inspection
stopped. After explicit native assignment in the disposable fixture, the reader
accepted its regenerated zero-network listing; this is not populated FBD or
graphical insertion acceptance. Native unassignment/deletion then restored all
original seven-POU, five-task, global, program and translation baselines. Fresh
cleanup Build (4.4 s)/Make (2.2 s) passed, compiled=true and modified=false.
Evidence: `native-graph-listing-fbd-live.json` and
`graphical-listing-8639cd55-7cad-4093-9835-3a774af898be.json`.

Regressions cover stale/missing artifacts, unverified Build, unknown/modified native
state, collateral source changes, mismatched declaration/worksheet/source paths,
ambiguous listings, unknown symbols, truncated networks and bounded ranges.
The full regression suite passes with 58 tools. Graphical placement/wiring and
an end-to-end Arya-led engineering operation remain unverified; the goal is active.

Deployment copied and hash-verified 127 package files as 0.5.5; backup:
`Arya-restored-hotfix-20261001-201615-5db0d00b`. A fresh process loaded the installed
module's 58 tools and accepted EIP_ToCLX listing after Build (4.3 s), regenerated
artifact verification and complete source preservation. Evidence:
`installed-graphical-listing.json` and
`graphical-listing-0318da1f-198d-4104-b35a-cdfdc6198909.json`.
This does not prove the currently running Arya process reloaded its catalog.

## Native populated graphical POU exchange investigation

Activating and refreshing the returned MotionWorks window still failed screenshot
capture with `FrameArrived timed out` and `window capture timed out`. No graphical
input was sent. Read-only inspection of the installed DDE command dispatcher then
established exact ExportPou and ImportPou argument bindings before execution;
details and installed DLL identity are in `docs/import-export.md`.

ExportPou returned 0 for the original ServoTaskSlow, writing only a fresh native
exchange directory in the disposable workspace and leaving the project unmodified.
Complete original source, translation and inventory preservation passed. The
package contains binary tree/native POU data, not editable XML or graphical text.
Evidence: `native-export-pou-probe.json` and `native-export-pou-preservation.json`.

A populated LD copy CodexGraphExchange passed native export/delete/import/Save.
The restored graph body, eleven declarations, translations and complete other
sources/tasks/globals matched its pre-export copy. Temporary native assignment
allowed fresh Build (9.1 s) and a verified five-network compiler listing. Native
unassignment/deletion followed by Build (7.2 s)/Make (2.7 s) restored the original
seven-POU baseline with compiled=true and modified=false.
Evidence: `native-exchange-copied.json` and `native-exchange-roundtrip.json`.

Added a bounded opt-in reproduction, `test/native_pou_exchange_live.mjs`. It only
imports its own untouched, hash-checked export into an absent test identity, and
retains phase evidence on failure. Its initial bundled-Python attempt stopped
because pywin32 was absent, before export/import. The unused test copy was removed
through the native API. The script now requires and checks an explicit existing
COM-capable Python before project mutation. This probe dependency is separate
from the installed plugin bridge.

The corrected reproduction subsequently passed its complete export/delete/import,
source comparison, temporary assignment, fresh graphical listing, unassignment,
deletion, Build/Make and complete original-baseline restoration. Evidence:
`native-pou-exchange-live-967bd849-0254-4d05-b0b0-942a81394b9e.json`.

General public exchange guards, graphical placement/wiring and Arya-led live
host acceptance remain unfinished. The support-engineer goal remains active.

## Public native package route acceptance (0.5.5)

Added `mw_ide_pou_package` as tool 59. Its session-bound private export/import
route verifies same staged project, complete native/saved source baselines,
package hashes, name collision refusal, library bindings, external global types,
exact graph/code/translation restoration and all native declaration flags/groups.
An import receipt is consumed before native mutation; partial action evidence is
retained without blind retry. No arbitrary external package or overwrite route.

The first two live export checks stopped before native mutation while reconciling
COM's omitted external worksheet comments. Each unused temporary POU was removed
through the native API before the corrected run. Comments remain verified through
saved declarations and translation files; raw native rows are preserved separately.
The corrected public route passed export, collision refusal, deletion/import,
complete copied-source comparison, temporary assignment, fresh five-network ladder
listing, unassignment/deletion, fresh Build/Make and exact seven-POU baseline
restoration. Evidence: `public-pou-package-live-c33a9343-2de0-41ac-b441-d883ef07abef.json`.

The automated suite passes with 59 tools. Deployment copied and hash-verified
129 declared package files as 0.5.5; backup:
`Arya-restored-hotfix-20261001-210055-61408607`. A fresh installed-module process
loads all 59 tools including the package route. The running Arya process's reload,
graphical placement/wiring and Arya-led complete host acceptance remain unverified.

## Native ST-to-FBD conversion investigation

Fresh desktop selection and activation still produced `FrameArrived timed out`,
then `window capture timed out` on the one allowed refreshed-target retry. No
editor input was sent. Installed `il001` help topic
`sourceconversionforil.fbdandld.htm` documents compiled ST/IL/FBD/LD conversion
to IL/FBD/LD using intermediate code; conversion to ST is not supported.
Archive SHA-256: `86c10a2227b260b15eeca2e1a4dba6f65294014e8a7b927db4188ea0091d7cda`.
Topic SHA-256: `a5fa1fb9bbefc3a68b1dd3536cf2aa1c6c5bcffe0508c56f39e160bb2b9d613b`.

Read-only inspection of the installed DDE SourceConvert handler establishes
four argument buffers and FBD/IL/LD language selectors (FFLD is conditional),
but the complete DDE object-name binding is not yet verified. No SourceConvert
command or private vtable call was invoked. The public Ade.tlb `_Pou.Convert`
method has one `newPouLanguage` argument; native enum FBD is 3.

A disposable ST PROGRAM with Run/Ready BOOL, Elapsed TIME and IEC TON ProbeTimer
compiled through native APIs. `_Pou.Convert(3)` returned CodexConvertProbe,
retained the exact POU inventory and changed its language from ST(2) to FBD(3).
Native Save completed. Saved target declarations, all other POUs, tasks, globals
and unrelated source/translation files matched the pre-conversion state. A fresh
Build (11.2 s) produced an accepted populated FBD listing with one network.
Temporary task unassignment and POU deletion followed by Build/Make restored the
complete original seven-POU baseline. Evidence:
`native-conversion-live-f36c8f08-d167-4723-bce0-ca8d0f00efe6.json` and
`graphical-listing-33962f7c-8766-4482-905d-d46c9603b9ac.json`.

The initial probe stopped before FB insertion because TON resolved ambiguously
between IEC and eCLR. Its unused blank temporary POU was inspected and removed;
the corrected probe explicitly selects IEC. `test/native_conversion_live.mjs`
requires an explicit pywin32 runtime and retains phases without automatic retry.
This is native conversion evidence, not a public conversion tool. Complete raw
native declaration-flag preservation needs a guarded route. The listing preserves
unresolved @IFB/@IFBP tokens; canvas geometry/wiring and Arya host acceptance
remain unverified. The next implementation is guarded conversion of an isolated
copy after a fresh compile, with exact native/saved collateral checks.

## Guarded public native conversion acceptance (0.5.5)

Added tool 60, `mw_ide_pou_convert`. It converts the exact selected POU in place
through the public COM method, with an explicit conversion review and expected
saved body SHA-256. `mw_code_pous` now supplies and renders that hash for ST and
graphical bodies. The installed-module read-back verified those public hashes
against complete saved structural evidence for all seven original POUs.

The tool requires a fresh Build plus newly regenerated CIC/DIT/DIW/SP artifacts
for the exact source POU, matching declarations, worksheet and project source
mapping. It refuses omitted/unused/stale source caches before conversion and
never manufactures usage through task assignment. After conversion/native Save,
it verifies exact POU type/declarations, all native flags/groups and libraries,
every unrelated source/task/global/translation, then a fresh generated-graph
Build/listing and final saved/native preservation. Unknown native flag/group
states stop before conversion. Full partial phases are retained without retry
or rollback; graphical geometry and individual pin wiring remain unverified.

The first public FBD attempt converted successfully but stopped before Save
because PowerShell coerced the returned Pou dispatch object to a type string.
Inspection confirmed the same POU name and FBD language. Native Save and full
flag/group comparison passed before explicit unassignment/deletion. Cleanup
Build marked the project modified; a subsequent reviewed Save, independent
original-source comparison and Make restored the clean seven-POU baseline.
Evidence: `conversion-partial-cleanup.json`. The bridge now reads the returned
Pou object's Name, with a string-return branch for compatible native versions.

Corrected public conversion of the populated IEC TON sample passed for both
ST-to-FBD and ST-to-LD, including source cache freshness, generated one-network
listing, native metadata/flags, complete collateral checks, cleanup Build/Make
and exact original-baseline restoration. Evidence:
`public-conversion-live-656aacb8-a0bc-4e03-bf43-b92b378ad651.json` /
`pou-conversion-83ee0ca6-2157-46d4-b8c7-063a5232cfd5.json` (FBD), and
`public-conversion-live-26a690f1-a7e9-484b-a297-642fafa4b01c.json` /
`pou-conversion-d774ac1f-4cae-4d4b-b6dc-48beb5d25ec1.json` (LD).
The bounded reproduction is `test/public_conversion_live.mjs`; select the
fixture workspace and `MOTIONWORKS_CONVERSION_LANGUAGE=FBD` or `LD` explicitly.

The full automated suite passes with 60 tools; focused regressions also cover
unknown flags, wrong returned identity, stale source artifacts and failures
after conversion. Deployment copied and hash-verified 131 declared package
files as 0.5.5; backup: `Arya-restored-hotfix-20261001-213255-320da082`.
A fresh installed-module process loads all 60 tools and verifies public body
hashes (`installed-conversion-tools.json`). This does not prove the running Arya
process reloaded. Direct graphical editor/toolbox placement/wiring, general IL
editing and Arya-led live host acceptance remain incomplete; the goal is active.

### Electron archive resolution correction (2026-10-01)

Read-only inspection found the desktop profile selects the installed bundle.
A separate Arya Electron Node-mode probe confirmed that patched `index.js` and
`package.json` resolve through `app.asar`, but new `pou-package.js` and
`pou-conversion.js` return ENOENT there. The archive index does not acquire new
entries when files are copied into `app.asar.unpacked`. Consequently the earlier
physical-path Node import did not establish that a restarted Arya could load it.

The entry point now selects its physical package root before dynamically
importing all local helpers. Child scripts and documentation share that root.
The packaged-runtime regression leaves helper modules absent from the virtual
archive and verifies tool registration and read/staging behavior. The full
60-tool automated suite passes. Actual running-chat catalog reload and graphical
canvas operation remain unverified.

A separate process using Arya's own Electron executable successfully imported
through the real `app.asar` URL: physical HERE, 60 tools, conversion/package
routes present and variable guide returned. Evidence is
`arya-electron-plugin-load.json` in the parent workspace. Installed files were
hash-verified (131 files); backup `Arya-restored-hotfix-20261001-214336-3e88a652`.
This is an independent host-runtime import, not a reload of the active chat.

### Graphical symbol identities and UI boundary (2026-10-01)

A fresh target selection and screenshot recovery still failed with
`FrameArrived timed out: timed out waiting on channel`, then
`window capture timed out`. Accessibility exposes panes and toolbox controls,
but clicking the observed toolbox dropdown returned
`coordinate input geometry is unavailable`. Only Alt menu activation was sent;
no canvas input, document text, placement or wiring was attempted.

The compiler reader now maps implicit local `@IV` declaration ordinals and
`@IFB` instance ordinals, checks complete compiler declaration names/scopes
against the saved worksheet, and rejects duplicate ordinals/names/bindings.
`@IFBP` operands expose the known instance and raw pin ordinal while leaving
the pin declaration unresolved. No pin names, runtime behavior or canvas
geometry are inferred. Unknown external bindings remain unresolved.

All three original ladder POUs passed the public fresh-Build listing route
with unchanged source/declaration/task/global/translation baselines. Evidence:
`graphical-symbol-ordinals-live.json` in the disposable verification directory.
ServoTaskSlow has 11 bindings and 5 networks, ServoHoming 47 bindings and 25
networks, and EIP_ToCLX 20 bindings and 10 networks. The complete automated
60-tool suite passes, including missing/ambiguous declaration checks.

The additional disposable FBD probe stopped before conversion when native
`pou_package_snapshot` timed out (30 seconds); it was not retried. Inspection
confirmed the probe was still ST and the native project was saved. Explicit
unassignment/deletion succeeded; the original seven-POU source baseline matched
exactly, and fresh Build/Make returned compiled and unmodified. Evidence:
`public-conversion-live-98efd4ac-59fa-4f52-8e36-ad10344ab8cf.json` and
`graphical-symbol-fbd-probe-cleanup.json`. New FBD symbol annotations remain
unverified live. Graphical canvas control and active Arya-chat acceptance remain
outstanding; the full support-engineer goal stays active.

### Bounded full native snapshot timing (2026-10-01)

A read-only seven-POU native snapshot took 25,213 ms including bridge startup,
close to the prior 30-second limit. The reader now caches POU/group/library
collections, visits each POU once instead of repeatedly looking it up by name,
and caches variable counts with before/after drift checks. New checks refuse
changed POU count/order, group counts and library counts. Phase timings go only
to the private bridge log, preserving deterministic snapshot comparison data.
Both public package/conversion routes allow a bounded 60 seconds for this full
read; no retries or mutation timeouts were added.

The revised read took 24,252 ms and returned byte-equivalent JSON data after
parsing (all declarations, flags, groups, structure and libraries) to the earlier
snapshot. Evidence: `snapshot-timing-before.json` / `snapshot-timing-after.json`.
This single measurement is a modest improvement, not a general performance
benchmark. Logs show variable rows dominate the inspection cost. Synthetic
collection tests execute the actual reader functions, checking bounded lookups,
exact values/flags, empty sheets and inventory drift. The full 60-tool suite
passes with those tests included.

The companion `konnect_computer_use` screenshot service captured the actual
Windows desktop and IDE successfully. It provides an available observation
path distinct from the failed Sky capture. One attempt to inspect Arya's plugin
page instead selected an IDE tree item because native automation brought the
IDE forward between observation and input. Further UI input was stopped while
the native workflow was active. This does not establish placement/wiring or
active-chat plugin reload; serialize native operations and UI input.

The revised complete FBD workflow passed through all native snapshots, conversion,
fresh generated listing and cleanup. `Run`, `Ready`, `Elapsed` and `ProbeTimer`
matched compiler ordinals @IV 1/2/3 and @IFB 4. The original seven-POU baseline
was restored exactly, with clean Build/Make. Evidence:
`public-conversion-live-42aaba2e-dcb8-4c4e-a80b-5112772035c5.json` and
`pou-conversion-b873dcd5-9b7c-402f-b6fc-41bf7444d0cb.json`. The reproduction
harness now asserts those identities from the retained conversion receipt.

After native work stopped, public native navigation opened ServoTaskSlow with
two settled observations. Companion capture displayed the real populated graph
(MC_Power, MC_Reset, MC_ReadStatus, MC_ReadActualPosition) and its FB toolbox.
Opening the observed Group dropdown showed the available groups; Escape closed
it. Independent full source comparison and native state confirm no source edits,
compiled=true and modified=false. Evidence:
`toolbox-observation-source-preservation.json`. This proves graphical observation
and toolbox dropdown access; placement, wiring and active-chat reload remain
outstanding. The next graphical probe can use this working companion capture
path with native and UI operations serialized.

### Direct FBD placement, four connections and constant edit (2026-10-01)

Using the working Konnect companion, a native-created disposable FBD PROGRAM
CodexCanvasProbe was given Run/Ready BOOL, Elapsed TIME and ProbeTimer TON through
public native declaration APIs. The sole test instance was assigned to BG only
in this disposable fixture. Public native navigation settled on its code view.

Tab opened inline insertion. Entering ProbeTimer inserted a variable operand,
not an FB call; that known scratch insertion was undone with observed Ctrl+Z.
Entering the block type TON, then selecting ProbeTimer in its properties dialog,
placed the real block with IN/PT and Q/ET pins. Each observed pin was selected,
then Tab inline insertion connected Run to IN, T#100ms to PT, Q to Ready, and
ET to Elapsed. The actual four connections were visible. Native Save, complete
saved declarations/collateral-source checks, native flags, fresh Build/listing
and Make passed. Selecting the PT constant and replacing its inline text changed
it to T#200ms; visual read-back and a second fresh generated network passed.

The generated TON declaration numbered IN=1, PT=2, ET=3 and Q=4, while the
installed interface listed IN/PT/Q/ET. Both graph versions matched the complete
nine-instruction network against the matching compiler block declaration;
parameter-table/display order was not used as a compiler ordinal mapping.
A retained stale hover tooltip displayed 100ms briefly after the edit; the
settled actual label and regenerated instructions established 200ms. Input
acknowledgments and immediate captures alone are insufficient acceptance.

Explicit native unassignment/deletion removed the probe, and independent full
source comparison restored the original seven POUs, tasks/globals, program
streams and translations exactly. Fresh Build/Make were compiled and unmodified.
Evidence: `graphical-canvas-live.json`, phase cleaned, in the disposable
verification directory. The evidence contains both saved graph baselines, native
flags, fresh listings, the compiler TON declaration hash, visual observations,
exact instruction matching and complete cleanup comparison.

The new packaged GRAPHICAL_EDITOR_WORKFLOW.md is returned directly by the
existing graphical edit guide and referenced by the active skill. The proof is
bounded to this TON FBD graph and constant edit; general LD/contact/coil/branch
editing, general IL editing and actual running Arya acceptance remain incomplete.
The generic graphical listing still reports layout/wiring unverified because it
cannot independently inspect a canvas. The full support-engineer goal is active.
