# MotionWorks support-engineer implementation status

This is work in progress. Version 0.5.5 did not establish complete IDE control.

## Fresh visible startup and real trial dismissal accepted

`startup-trial-7b8164f8-3209-4733-b042-0d69e677a2ae.json` is accepted=true,
trial_popup_verified=true. The clean disposable fixture IDE was closed normally,
its old process/window was confirmed absent without repeating Alt+F4, and the
public native start tool launched one visible Mwt process with the verified
wrapper. A real Use Trial dialog appeared and the production posted_bm_click
fallback verified closure. This also exercised the scoped input-thread detach
fix. The ready frame was visible, enabled and unblocked; no verifier or modal
remained. New Mwt PID 24380, frame 0x40920. The exact fixture was open. Fresh Build
and Make compiled successfully with modified=false, and full native package and
saved source/translation baselines matched. No customer/controller action occurred.

The start tool's stale bare-launch description now matches its verified-wrapper
launch. New callers request and receive the verified trial method; cached callers
retain their existing closed output schema. Synthetic startup tests cover both
output shapes. Existing-process blocked-start recovery, other licence states and
running Arya chat execution remain distinct acceptance work; this proves the
actual fresh startup path, not every possible popup or complete autonomy.

## Connected CommWatchdog inline replacement accepted

Fresh `comm-graph-92b2b405-c83a-464d-94a5-897f23d9801d.json` is cleaned,
accepted=true and cleanup_verified=true. Native APIs created the ST PROGRAM,
declarations, installed FB call, BG assignment and reviewed FBD conversion.
The foreground companion selected the actual connected WatchDog operand,
opened Tab inline editing, selected only its text with Ctrl+A, typed DINT#2000
and committed with Enter. Separate observations checked each step. No activation
or native workflow was interleaved while the inline box was open. The current
companion API has no handle parameter; it was used as supported, without
bypassing the earlier handle-based companion's guard. Window enumeration returned
only the main frame, accessibility was null, and immediate Tab/Enter captures
were stale. Those observations did not trigger repeated input or focus recovery.

Fresh native Save/Build/listing compared every normalized instruction: only the
typed load feeding WatchDog changed from DINT#1000 to DINT#2000. All seven pins,
declarations/flags, task assignment and unrelated sources/translations matched.
Make and zero-error checks passed. Native unassign/delete, final Build/Make and
the complete preparation-time saved/native baseline matched after cleanup. This
baseline includes the separately verified global grid counter checkpoint above;
no new global counter change occurred. The earlier wrong extra-operand failure
remains retained. Guides now distinguish actual supported companion APIs and
teach the verified focus-preserving path. Native own-window screenshot capture
with an active inline editor, trial startup and arbitrary graphical editing are
still separate requirements; fresh startup/trial acceptance is recorded above.

## Native declaration reader performance investigation

Read-only benchmarks now compared all 429 declarations across globals and seven
POU sheets, retaining every current reader field and flag. Handwritten cached
IDispatch definitions matched but improved total time only about 4% in the
reversed full-project run, so that candidate was not enabled. Interop generated
from the installed Ade.tlb matched every row in both orders: total times were
29.491s versus 35.023s (generated first) and 23.841s versus 38.041s (legacy first).
These are fixture observations, not general timing guarantees; some small sheets
were slower. The fixture's complete saved/native baseline audit passed afterward.

The reproducible, SDK/assembly-hash-bound probe in
test/probes/sdk-variable-reader passed all 429 rows with generated-first total
30.835s versus legacy 36.568s. Receipt:
`variable-reader-generated-verified-local-cache.json`. SDK SHA256:
`7ccec37b8fcff5d1a55198f51a7f97ded0429b2eb0ab740b5cede8cfd9950c6e`.
An earlier attempt to load its generated DLL inside the fixture verification
folder refused with .NET network-location error 0x80131515; that failed receipt
is retained as `variable-reader-generated-verified.json`. A separate ordinary
workspace cache loaded normally; no loader/security setting was changed.

The production bridge now lazily generates interop in its private temporary
mailbox for this exact SDK hash. Unknown SDKs and initialization failures use the
complete existing reader; a changed SDK or native read failure refuses without
retry or partial fallback. The synthetic guard tests pass in 32-bit and 64-bit
PowerShell. No generated SDK DLL is committed or packaged, and no loader policy
is changed. The complete native package (429 declarations, groups, libraries,
POUs and tasks) matched the legacy reader exactly: 37.861s versus 44.515s in this
run, receipt `sdk-reader-package-859ee054-0f7d-40ed-963f-7551247569e7.json`.
Live local declaration flag edits in both directions, independent read-back,
Build/Make and exact cleanup passed:
`native-variable-flags-e6c37d60-e050-479f-8b5a-6603a9f3e5fa.json`.
The complete local/string/global/external flag matrix also passed every native
mutation and independent read-back, removed all scratch objects, and passed
final Build/Make. Its strict binary cleanup receipt remains accepted=false:
`native-variable-flag-matrix-6074b197-42ad-46b0-bf3e-3636e69daf4f.json`.
Only the global VGR high-water counter at offset 4 changed from 1419 to 1420.
The separate read-only `sdk-variable-flags-cleanup.json` proves reversing that
counter in memory reproduces the retained original SHA256, every other source
and translation is identical, and the full native package equals the pre-test
429-declaration package, including every flag and group. It is accepted=true,
binary_identical=false, compiled=true and modified=false. Reconstructed and
current grid bytes are retained separately; no project stream or original
baseline was rewritten. Use this reconciled checkpoint for subsequent fixture
work; the old strict baseline audit correctly still refuses this counter delta.
Generated SDK interop also identifies
_Variable.FbInstance as a Boolean getter, not a pin-object getter; this corrects
the interpretation of the earlier failed object probe below.

## CamGenerator native and compiler acceptance

The reviewed CamGenerator call also passed guarded native ST-to-FBD conversion.
Its fresh graphical compiler listing has one network and ten pin annotations:
all eight public pins resolve to ProbeCam/CamGenerator with the expected
directions, including both sides of the two in-out structures. Declarations
were unchanged by conversion. Subsequent fresh Build/Make and zero compiler
errors passed. Exact scratch unassign/delete, final Build/Make, full original
saved/native baseline and all 357 installed library hashes passed cleanup.
Receipt: `cam-native-7e8a3317-43c9-47b0-835f-2af2dbc4a60c.json`, cleaned,
accepted=true. Run the opt-in harness with `graph` for this phase. This is native
conversion/compiler acceptance; canvas placement, layout, inline editing and
runtime behavior remain unverified. No desktop input was sent.

Graphical listing range validation now precedes workspace/native inspection and
Build. Invalid start/limit values refuse without calling a native dependency;
the same validation protects the orchestration helper. CommWatchdog's pending
live harness now requests the supported maximum of 50 networks instead of 100.
Its saved-listing replay and the range/freshness/source-preservation tests pass.

The complete native package trace measured about 77 seconds per snapshot on
this fixture. Declaration-property reads are the main measured cost. Offline
Ade.tlb inspection shows _Variables offers Item/ItemById/Create and collection
properties, but no bulk declaration export. Investigate efficient typed/cached
COM property dispatch with exact old/new row equivalence before changing these
checks; do not skip full native flag/group verification to improve speed.

A newly created CamGenerator call has now passed an offline native lifecycle.
`CodexCamProof` was created as ST; native declarations added CamSegmentStruct,
Y_MS_CAM_STRUCT, four output variables and a CamGenerator instance. Reviewed
code bound both in-out structures, Execute=FALSE, TableSize=UDINT#2880 and all
four outputs. A distinct BG instance was assigned. Fresh Build (6.8 seconds),
Make, zero compiler errors, exact source read-back and all four fresh target
compiler artifacts passed. This used the general native code API, not the
guarded automatic FB insertion planner, and sent no desktop/controller input.

Cleanup unassigned the exact scratch instance and deleted its POU, then passed
fresh Build (5.5 seconds), Make and full original saved/native baseline checks.
All 357 installed Cam Toolbox files remained hash-identical. Retained receipt:
`cam-native-6e62a31e-9e6d-4fbc-b3a7-5d7cf3fa4491.json`, cleaned, accepted=true.
`test/cam_native_lifecycle_live.mjs` retains each native action and supports
explicit cleanup from its receipt after a stopped run. This proves the reviewed
call compiles against these installed references; it does not prove cam runtime
behavior, arbitrary protected block signatures, worksheet decoding or the
library cache's source binding. Automatic insertion eligibility remains false.

An authorized fresh native Build now passed on the exact disposable fixture:
Compile(2) showed an observed pending-to-compiled transition and rewrote both
ICI00036.DIT and TYLLIST.TYP during the request window. All eight diagnostic
CamGenerator pins remained identical. Full saved/native project comparisons and
the complete installed Cam Toolbox file manifest stayed unchanged; the fixture
remained compiled and unmodified. The library's tmp.sto itself was not rewritten.
Evidence: `cam-compiler-refresh-9798b91d-75ae-462c-8ee5-55f588afe3e6.json`.
The opt-in `test/cam_compiler_refresh_live.mjs` retains source/library digests,
compiler timestamps/hashes, native snapshots and the Build verdict. This proves
fresh project compiler evidence against current native references, not fresh
library-cache generation or protected-worksheet/source binding. Source binding
and insertion eligibility therefore remain false. No desktop input was sent.

The diagnostic reader now also validates each public pin's numeric compiler type
against explicit names in the sibling TYLLIST.TYP table, including the named
CamSegmentStruct and Y_MS_CAM_STRUCT structures. The whole table's 41 type roots,
166 component entries and 16 array dimensions match its header counts; duplicate
or conflicting IDs, unknown names, incomplete counts and declaration/type-token
mismatches are refused. It returns compiler_pin_types_verified=true and the type
table's hash while freshness/source binding and insertion eligibility remain false.
The native-bound read-only query passed with all eight pins and unchanged source
baseline: `user-library-interfaces-1e130939-6f09-4c84-b375-ce138a38f3d7.json`.

Read-only native API probes did not establish an alternative live pin reader.
The installed `_Library` interface has identity/path properties but no POU/pin
collection. The two library-relative GetObjectByLogicalName paths did not resolve
CamGenerator using adeOtFunctionBlock=6. The initial variable probe treated
FbInstance as an object and failed accessing Type. The later SDK-generated
interop identifies that getter as Boolean, so this failure does not establish
anything about a pin-object reader. Its BG program instance had a null Variables getter and an
empty FbInstances collection. This is evidence about this offline fixture, not a
claim that every native/online interface is unavailable. Retained evidence:
`library-readonly-probe-48a34ac9-c32f-408f-b904-789ff9e77013.json` and
`library-readonly-probe-10cad9b7-d492-4ef5-a794-62b0ca1dba11.json`.
Earlier failed ROT attachment and probes remain retained. No OpenDocument,
Compile, Save, Create or desktop input ran; the subsequent full saved/native
fixture comparison passed with seven POUs, 164 globals and compiled/unmodified state.

The public interface reader now exposes this cache path as diagnostic evidence
after live library/reference matching, exact block and worksheet identity checks,
complete source/dependency declaration membership, count/ordinal validation and
stable file hashes. It returns `installed-compiled-block-interface`,
`insertion_eligible:false`, compiler_cache_freshness_verified=false and
compiler_source_binding_verified=false. Insertion planning and authoritative
static review continue to refuse that evidence kind. This does not bypass the
unsupported worksheet decoder.

The actual public tool passed a read-only, native-bound fixture check with all
eight CamGenerator pins, both cache/source hashes, unchanged complete project
sources, compiled=true and modified=false. Existing ReadMotorSpeed and
CommWatchdog declaration interfaces still passed. Evidence:
`user-library-interfaces-ea167452-e514-49fe-bf88-9fcc9fbca7f8.json`.
The provenance fields identify the readable tmp.sto as source_file/source_stream
and separately retain worksheet_file/worksheet_sha256 for the unsupported
src.st1 container; these hashes are not interchangeable.
Pure regressions cover identity, membership, direction/count/ordinal and duplicate
refusals; insertion tests refuse diagnostic-only metadata. Fresh native source
binding and an actual CamGenerator insertion remain open.

The installed CamGenerator `tmp.sto` contains a readable `@$@$@$@$.clu`
declaration listing even though its Variables.VB worksheet is unsupported.
The fixture's ICI00036.DIT names the same 140 source declarations plus a generated
private `@T_Code_00` row. The dependency parser previously missed that row and
rejected the complete 141-row table. It now recognizes the observed private
temporary spelling for completeness, but never exposes it as a public pin.
Unknown private spellings, duplicate ordinals and private names in public
sections remain refused. Nine graphical-listing regressions passed.

The opt-in read-only `test/cam_dependency_saved.py` compared the actual library
declaration listing with the actual saved dependency and resolved all eight
public pin names/directions. It retains explicit type names from the listing and
hashes of both caches, source container and library registry. All watched hashes
remained unchanged. Evidence:
`cam-dependency-saved-f925415c-231c-4769-8872-29fde7da1e11.json`.
This is saved metadata evidence, with freshness_verified=false; it does not prove
a fresh native Build, a newly inserted CamGenerator, runtime cam behavior or
decompression of Variables.VB. The public block-interface tool still cannot decode that
worksheet. Next bind this alternative declaration source to verified native
library identity and fresh compiler/source evidence before permitting insertion.

## October 5 wrap-up and next acceptance test

The trial native-button fallback had attached the bridge input thread to the
verifier threads without ever detaching. It now scopes unique successful
attachments around its single button post and detaches in finally, including
activation and post failures. Every detach is attempted even if another fails;
cleanup failure is reported as an ambiguous submitted action, with no retry.
Production-function tests in 32-bit and 64-bit PowerShell cover shared/self
threads, failed attachment, activation/post failure, detach failure and exact
verified/unverified closure. They use synthetic native methods and send no UI
input. Current read-only trial_state reports no dialog or verifier and the same
IDE frame 0x505EC. This is a resource-lifecycle fix, not proof of the live popup's
root cause or live dismissal. Fresh startup/trial acceptance remains required.

Startup inspection found a concrete mismatch: the interactive Mwt launcher used
`-WindowStyle Hidden`, while `Get-IdeWindow` accepts only visible frames. The IDE
launcher now requests Normal; background bridge helpers remain hidden. This is
a plausible contributor to the retained 300-second timeout, not a verified sole
cause. Microsoft documents the [Start-Process window styles](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1).
The startup clause also refuses a still-disabled frame before COM and preserves
existing-process recovery instructions on timeout; it no longer directs Arya
to manual trial clicks or claims retired offline tools bypass the licence.

Production-body synthetic startup tests passed for fresh visible launch,
existing-process reuse without a duplicate launch, one exact pre-frame trial
action, unverified trial closure, disabled frame, observation timeout and invalid
wrapper hash. Trial discovery/state tests also passed. These tests launch no IDE
and perform no UI input. A fresh real startup and visible trial-dialog dismissal
are still required when the desktop is available; the current fixture IDE was
not restarted while FactoryTalk was in front.

Native screenshot capture no longer restores or activates the main IDE frame,
which could dismiss a graphical inline editor. It checks foreground/active/focus
identity and refuses an unverified fallback. Production-body mock tests covered
stable capture, minimized refusal, unsafe fallback and focus drift. Live capture
passed with saved sources unchanged and compiled=true, modified=false:
`focus-capture-76a6dc29-ec56-4db1-80f1-8d1080d21abd.json`. No inline editor was
open in that check; popup preservation and correct operand selection remain unproven.

Staging guard tests and all 14 workspace boundary checks passed. The actual open
fixture replacement was refused with all 714 backing files unchanged:
`stage-open-guard-865924cd-5398-47db-aa51-df47a64d2a02.json`. Initial startup
timed out after 300 seconds; the same instance later responded and the resumed
check passed without starting another IDE. The timeout cause remains unresolved.

The previously pending scratch fixture cleanup is now complete. Native unassign,
POU removal, fresh Build/Make and the complete original baseline comparison
passed: seven POUs, 164 globals and five tasks; compiled=true, modified=false.
Receipt: `arya-toolbox-resume-cleanup-4a373020-e7b7-4de0-8f3f-b5664635bf49.json`.
The earlier failed cleanup and graphical receipts remain retained.

Next: in the dedicated disposable Arya fixture chat, verify capture with the
actual inline editor open, then replace the connected CommWatchdog operand from
DINT#1000 to DINT#2000. Require exact generated instructions, fresh Build/Make,
unchanged collateral sources and full cleanup. Compressed CamGenerator interfaces
and broader graphical autonomy remain open. Customer projects are outside this test.

The next opt-in harness is `test/comm_watchdog_graph_live.mjs`, with `prepare`,
`verify_canvas` and `cleanup` phases. Use only the exact authorized smoke workspace
in `MOTIONWORKS_MCP_WORKSPACE`; resume using the printed receipt basename in
`MW_COMM_GRAPH_EVIDENCE`. It prepares a dedicated CodexCommGraph PROGRAM with all
seven declared CommWatchdog pins, requires the connected WatchDog input's generated
load to change from 1000 to 2000 with every other instruction unchanged, and checks
saved/native collateral and complete cleanup. It performs no canvas input itself.
The harness has passed syntax validation and replay of the retained accepted
native CommWatchdog listing (seven resolved pin directions and its exact typed
DINT load). The compiler represents 1000 as `@TYP:4# 00#000003e8`; the expected
2000 replacement is `@TYP:4# 00#000007d0`. Its new live phases have not run.
Keep the prior failed graphical result separate from any future accepted receipt.

The updated computer-use capture still timed out twice on the live IDE
(`FrameArrived timed out`, then `window capture timed out`). The same returned
IDE window remained available. The connected companion captured the desktop,
which had FactoryTalk in front; no desktop input or fixture mutation was performed
while preparing this harness. Run the live phases when desktop use is available.

## Preserve existing stages during fresh-copy preparation

Staging previously deleted an existing target before preparing/binding the new
copy. It now requires reviewed `replace_existing:true`, refuses an open target
or unknown/modal IDE state, prepares the incoming copy before replacement, and
retains the prior folder/wrapper/identity together with content hashes. A final
state/content check refuses intervening writes. Concurrent requests for the same
target in this plugin process are refused. Partial commit failure retains prior
backup and pending paths for inspection; no automatic native repair is attempted.
These checks do not replace the requirement to preserve unsaved IDE work or
review the intended source before staging. Graphical autonomy remains open.

The October 5 field export demonstrates repeated successful native edits,
navigation and compilation; see [field session audit](FIELD_SESSION_AUDIT_2026-10-05.md)
for actual result counts, refusals, release notes and remaining acceptance work.
The latest polish routes unassigned-POU warnings to native task assignment and
makes stage identity/backup recovery explicit without bypassing provenance guards.

## Arya toolbox graphical test: partial, stopped

The authorized fixture chat's next test ended at sequence 1657. Arya read both
named toolbox interfaces, created AryaToolboxProbe, added and verified five local
declarations, inserted CommWatchdog with all four status outputs, assigned BG,
and passed fresh ST Build and native FBD conversion. Compiler listing resolved
the installed toolbox pins. Those operations used native tools.

The keyboard edit failed. Main-frame keyboard attempts were refused while the
inline editor owned a temporary foreground handle; a missing-handle attempt and
the companion's get_active operation also failed. Arya found the inline handle
and sent Ctrl+A, text and Enter, but focus recovery had changed selection: an
extra unconnected DINT#2000 operand appeared while DINT#1000 remained connected.
Fresh graphical Build completion was unverified and Errors reported
`Object not connected or invalid connection!`. Failed evidence is retained in
`graphical-listing-9fc96407-f271-4b11-917f-edbf85d7f717.json`; successful native
conversion in `pou-conversion-92be4e8f-440f-4fa7-8491-b8cde60450ee.json`.
This does not pass the requested graphical editing lifecycle. The guide now
explains temporary inline handles and requires selection/connection rechecking
after focus recovery. Testing was paused at the user's request; the later
wrap-up above records cleanup and the remaining acceptance test.

Cleanup was requested before pausing, but its initial native Save was refused:
the bridge found no running MotionWorks IDE window. No cleanup mutation ran and
the IDE was not relaunched. At that pause the disposable staged fixture contained
the scratch POU/assignment pending observed-state cleanup on resume. This did not
affect a customer source project. Receipt: `arya-toolbox-pause-cleanup.json`.
That cleanup subsequently passed as recorded above. Next verify selection-preserving inline edits.
Compressed CamGenerator interfaces and broader graphical autonomy remain open.

## Named user-library declaration worksheets

The interface reader now recognizes a single named declaration worksheet such
as `Variables.VB`, after checking its paired grid, exact saved tree identity and
declaration count. Project and firmware interface paths remain unchanged.
Focused identity/refusal tests passed. A read-only native-bound fixture check
retained all eight ReadMotorSpeed pins and seven CommWatchdog pins with source
and registry hashes. Saved source snapshots matched and the IDE remained
compiled and unmodified. Evidence is retained as
`user-library-interfaces-6e98250c-d359-4fd4-a4a5-f6cf425a5640.json`.

CamGenerator's named worksheet is recognized, but its declaration payload uses
the unsupported MotionWorks compressed container. The tool reports that exact
limitation rather than guessing pins. This check does not yet prove Arya's
insertion, graphical editing or build lifecycle with these toolbox blocks.

## Complete programming-review output

The generic write renderer previously cut programming-review output after 400
characters. A dedicated read-only renderer now preserves the complete report,
including final findings, citations, unresolved signatures and coverage limits.
The focused render checks and live native-bound fixture check passed. Evidence
`program-review-render-66e9a69a-b3f8-4509-9725-0426b757f560.json` retains the full
14,326-character report and identical before/after source snapshot digests.
Four ST POUs were reviewed, three graphical POUs explicitly skipped. It reported
one warning about fbReadMaster's Error output, not a proven machine fault.
TON remained ambiguous between IEC and eCLR; CamGenerator's declaration stream
could not be parsed. Those unresolved interfaces are now visible to Arya. This
test does not prove broader graphical analysis, timer timing or motion behavior.

The installed fix was verified after an Arya host restart in the same authorized
fixture chat (ending sequence 994). Actual tool result 970 contained all 14,326
characters and parsed exactly equal to the retained native-bound engine report.
Arya's response 992 explicitly confirmed the final limitations arrived, reported
all findings and both unresolved interfaces, and used one read-only ST read to
corroborate its warning. No source or IDE editing occurred. The full fixture
baseline check passed after completion. Actual tool evidence is retained as
`arya-program-review-chat-evidence.json` in the fixture verification folder.

## Running Arya native engineering lifecycle

Authorized dedicated fixture session `d637dc30-4a0d-470d-8c45-f88c710d2be0`
created an ST PROGRAM, three local declarations and a group, inserted an IEC TON
call, renamed the populated group, assigned the PROGRAM to BG and passed fresh
Build and exact read-back. Native worksheet navigation, exact unassign/delete
and final Build passed. Independent full saved/native baseline equality and
clean compiled state passed, preserving all seven original POUs, five tasks and
164 globals. No manual IDE editing or controller action was needed.

The initial run guessed the wrong task-model tool name and omitted Make. A
verification-only corrective follow-up used the existing `mw_code_task_model`
and Make (already up to date), preserving those initial mistakes in the report.
Skill guidance now names the actual tools and requires separate Build/Make
checks. This is accepted with assisted follow-up, not complete autonomous
acceptance. See ARYA_ENGINEERING_ACCEPTANCE_2026-10-05.md and the retained fixture
receipts. A fresh run now completed the bounded lifecycle without a corrective
message, including autonomous diagnostics visibility recovery. It disclosed
omitted flag enumeration and truncated code-check output; broader graphical
flows through Arya remain unverified.

The hidden Message Window recovery is now implemented directly in the plugin.
The installed Mwt.exe menu resource 501 verifies View > Message Window command
36554. The bridge posts it once only when the exact Message Window is hidden,
refuses modal or unverified command identities, observes recovery, and preserves
project modified state. Fixture-only `hidden_output_pane_live.ps1` passed with
Errors 0, Warnings 0, Build 22 and Infos 9 unchanged across each recovery. Full
saved/native fixture equality passed afterward. Receipt
`hidden-output-f58454ca-2a2f-465a-a844-5d1b982921c2.json` retains this proof; the
earlier off-screen experiment remains failed evidence. Zero current warning rows
do not override the fresh lifecycle Build's 25 retained warnings.

After installing the fix and restarting App and Host, the same Arya fixture
chat passed a read-only hidden-window check (sequences 905-950). The skill reload
was 906; Errors 912, Warnings 922, Build 924 and Infos 926 returned the expected
0/0/22/9 rows. Compile state 914 was compiled=true, modified=false; task model
916 contained the original five tasks and no scratch binding. Arya made no
mouse/keyboard recovery calls; it also used read-only system status and element
listing, so this was not an exclusively MotionWorks-tool-only turn. The source
baseline check passed again after the chat ended. Retained actual tool evidence:
`arya-hidden-diagnostics-chat-evidence.json` in the fixture verification folder.

Visibility is now checked before COM tab activation, because activation itself
can expose a hidden dock bar. The strengthened native test explicitly records
one verified command recovery per hidden setup. Receipt
`hidden-output-c612c1e6-75c6-46bc-82d5-03e7b5cfe432.json` proves all four command
paths, unchanged diagnostics and restored visible layout. Earlier readable-pane
checks alone were weaker evidence of which recovery route ran.

## Updated tools verified in the running Arya chat

The authorized October 5 read-only check exposed stale executable caching after
a plugin disable/re-enable: 61 tools and archived discovery remained while the
skill text updated from disk. Application > Restart App and Host fixed it.
The fresh running-chat request exposed all 62 tools, including variable groups;
skill loading, current-project discovery, native IDE state and report-only trial
checks passed. Exact record references are in SESSION_RUNTIME_AUDIT_2026-10-05.md.
This establishes live catalog/read-only execution; it does not establish an
Arya-led editing lifecycle or arbitrary graphical work.

## Multi-contact ladder branch and keyboard selection

Fresh `ld-branch-df0f0799-47e8-4b87-b07f-437bbe83dd7d.json` is cleaned,
accepted=true, cleanup_verified=true. Native APIs created an isolated LD PROGRAM,
four BOOL declarations and a disposable BG assignment. F6/F7 and Tab inline
editing established a serial rung whose fresh listing matched LD Run, AND Enable,
ST Ready. Right/Space selected its coil through the documented object cursor.

Right/Shift+Space/Left/Shift+Space selected both contacts while excluding the
coil. Ctrl+T inserted a lower contact spanning those two serial contacts. Binding
Alternate through Tab produced the observed branch and exact fresh instructions
LD Run, AND Enable, OR Alternate, ST Ready. Make passed; complete native fields,
six flags, groups and saved collateral matched. Save created an empty target-body
translation file, accounted for only after parsed empty ItemList verification.
Native cleanup and fresh Build/Make restored the exact full source/structure
baseline with zero errors. The installed graphical guide and skill now teach
this route. Arbitrary branch topologies and active Arya-led execution remain
unverified. No online/controller operations occurred.

The Windows capture helper failed FrameArrived and window-capture retries.
The separately connected Konnect companion supplied observations and input;
native operations and canvas input were serialized throughout.

## Native declaration groups and crash recovery

The new `mw_ide_variable_group_change` registers as tool 62. Automated planning,
reader, corruption, package-path and full suite checks pass. Live local/global
create, populated rename, approved empty delete and populated-delete refusal
passed through the public tool. Retain and OPC flags were preserved. Scratch
members and the scratch POU were removed; fresh Build/Make and zero errors passed.

The overall lifecycle receipt `native-groups-live-6a819978-4402-414e-9dfb-f9dc335ab909.json`
remains stopped and accepted=false: exact final cleanup differs only in the global
`Global_Variables.VGR` stream (before c7694fc7…, after 3415dc73…). Full saved
declarations, POUs, tasks, translations and all other program streams match.
Do not call this exact binary restoration or ignore the grid stream globally.
Next investigate the grid difference with a retained raw before/after stream,
complete native global flags/membership and an explicitly scoped fresh fixture.
No failed mutation should be repeated; all scratch mutations already completed.

Installed-host registration alone does not prove a chat has reloaded the plugin.
The subsequent live-chat check and full host restart above establish exposure.

### Raw grid follow-up and discovery correction

Fresh receipt `native-group-grid-4772c014-fb2a-4d7a-a6d3-a625fbc8d5eb.json`
is `cleaned_with_verified_counters`, accepted=true, cleanup_verified=true and
binary_identical=false. Raw before/after streams are retained. All 164 records
are byte-identical and complete native flags/groups/declarations match. Only
the variable high-water counter at offset 4 (1418 to 1419) and the group trailer
counter at offset 22282 (17 to 18) changed after one native group/member roundtrip.
Every other byte matched. Fresh Build/Make, zero errors and all other sources,
tasks and translations passed. This exact fixture experiment accounts for those
two counters; ordinary source verification is unchanged. The older lifecycle
receipt remains accepted=false because its initial raw bytes were not captured.

The diagnostic grid parser refuses the temporary retain/OPC row (165 declared,
164 parsed). It assumes zero record flag fields. The native variable API fully
verified the row/flags; the parser was not relaxed for offline mutation. Raw bytes
were retained, the successful addition was reconciled, and exact deletion followed
without repeating the add.

The October 4 Arya session `668068a5-191f-4fc5-ae01-9747a1ce6e0d` has 61
MotionWorks tools in both recorded request catalogs. Skill loading, discovery
and saved POU reads succeeded. Startup/trial tools were present but not invoked;
the status call reported no running IDE. This does not prove startup failure or
current chat reload. Automatic discovery did surface archived copies. It now
excludes `backups` and `_backups` case-insensitively, while an explicitly requested
backup root remains searchable. Read-only verification in the actual cutter
workspace returns only BottomCutterS5 and TopCutterS5 (two projects).

## Assigned two-block FBD and observed constant editing

Fresh acceptance `toolbox-graph-299eeadd-536c-4b46-9905-20b3bd1c93d0.json`
is cleaned, accepted=true and cleanup_verified=true. Native ST insertion of IEC
TON and Yaskawa_Toolbox_v375 TON_Retentive, BG assignment and reviewed native
FBD conversion passed. Full fresh listings resolved both instances, public pins
and both Accum in-out accesses to the same local variable. The actual canvas
displayed those connections. Tab/Ctrl+A/text/Enter changed the selected Retentive
Preset from 100 ms to 200 ms. Complete instruction comparison accepted exactly
that one constant change, preserving the other network and all connections.
Declarations, flags, tasks, unrelated sources and translations were unchanged.
Make and zero-error reads passed. Exact unassign/delete and fresh Build/Make
restored the complete original baseline; this was a fresh test after restoration.
The skill now gives Arya this native preparation/conversion route for supported
new FB graphs and the verified inline-edit procedure.

## Full native inspection budget and restored group drift

The October 3 follow-up increases the complete package inspection and guarded
conversion/package request budgets from 60 to 180 seconds. A timed-out read
actually completed successfully at 68,208 ms; the patched live read completed at
105,545 ms. This changes the observation budget, not inspection performance or
acceptance rules. The regular suite passes.

The completed read revealed a native globals group ` n` differing from saved
`System Variables`, so conversion stopped before mutation. Saving during probe
unassignment materialized that rename as `n`; collateral checks refused acceptance.
The exact probe was removed after receipt/source reconciliation. The installed
type library declares VariableGroup.Name writable; the guarded fixture-only
restoration used that native setter to restore System Variables for all 36
members. Complete native global rows/flags/groups, saved source baseline, fresh
Build/Make and zero errors passed. `fixture-group-restore.json` is accepted=true;
the earlier toolbox receipt is now cleaned_without_conversion with
cleanup_verified=true, preserving accepted=false for its failed conversion.
The origin of the unexpected group rename has not been established.

A readonly compiled C# reader prototype returned identical 164-row data but took
7,953 ms versus 7,012 ms for the existing reader. It was not adopted. Evidence:
`native-reader-timing.json`. Complete inspection speed remains a limitation.

## Assigned ST toolbox FB compilation

The installed eCLR compiler requires each VAR_IN_OUT to connect to the same
variable before and after the call. Native insertion now generates its named
input binding and `variable := instance.pin;` afterward. Without the latter,
an assigned TON_Retentive PROGRAM failed with "Accum is not connected" despite
passing native source readback. Earlier unused-POU builds did not cover that
requirement. Installed eCLR_001 topics
TheVARINOUTParameterIsNotConnectedToAVariable.htm and
TheVARINOUTParameterIsConnectedToDifferentVariables.htm document the requirement.

Fresh public acceptance created a 2,322-line commented ST PROGRAM, rejected a
stale readable hash before mutation, inserted IEC TON and Yaskawa_Toolbox_v375
TON_Retentive, assigned the PROGRAM to BG, and observed successful fresh Build.
Make was up to date, native state was compiled and unmodified, and the correctly
identified Errors pane was empty. Four freshly generated compiler artifacts
matched exact POU/worksheet/source-map identities. Cleanup and final Build/Make
restored the complete original source baseline. No resume was needed.
Evidence: native-fb-hash-84bcbc28-32e1-409f-bed6-d6359f31450f.json, cleaned,
accepted=true. This proves these two assigned ST FB calls, not arbitrary toolbox
objects, graphical canvas editing or runtime machine behavior.

## Worksheet readiness and task-instance context

Native navigation now recognizes an exact task-instance view only after reading
adeOtProgramInstance (19) by its observed logical path and verifying its Name and
Type against the requested POU. It requires the full worksheet/context caption,
unchanged modified state and two responsive observations. Wrong worksheet, POU,
task or native instance identity remains refused; keyboard focus stays unproven.

Added `inspect_only:true` to re-check an unsettled editor without OpenDocument or
input. Protocol 6 prevents an old bridge from ignoring this flag and navigating.
The full non-IDE suite passed. Live test
`native-navigation-readiness-live-e554274e-c77a-4a39-8d69-a874a6f78fff.json`
passed 4 opens, 4 matching inspections and 4 wrong-target refusals, with unchanged
POUs/tasks/globals/program sources/translations. Read-only
`navigation-instance-native-proof.json` proves the native instance lookup, but
active task-instance editor reuse still needs a live reproduction. No customer
project, controller action, mouse input or keyboard input was used.

## Native trial and large-body patch live proof

The real trial prompt was dismissed by native startup with trial_answered=true.
A disposable 2,322-line commented ST POU was patched using two exact snippets,
saved, fully read back and compiled with fresh Build/Make. Scratch POU removal
and final Build/Make restored all original POU/task/global inventories, program
streams and translations. Evidence: `native-patch-live-41bb526a-682c-4df1-bf40-e642077b6e31.json`,
accepted=true, phase=cleaned. No customer project or controller was edited.

The live test found a mismatch between the raw native body hash and restored
comments. The inventory now exposes `text_body_sha256` for readable ST/IL;
native patches consume it as `expected_body_sha256`. Existing `body_sha256`
and conversion guards remain unchanged. Comment-only-change regressions cover
both ST and IL, and missing translations cannot yield a usable readable hash.
The first refused patch and later cleanup modified-flag stop remain recorded;
completed native operations were not repeated. Both continuations checked saved
and native state before progressing. Next investigate task-instance navigation
and the earlier global VGR cleanup discrepancy, then continue graphical FB work.

## Trial-aware state follow-up

`mw_ide_state` now reports the exact trial dialog and verifier process separately
from the IDE frame. A trial prompt before that frame is blocked startup, rather
than evidence to launch another IDE. The rendered result routes directly to the
existing native `mw_ide_trial(attempt:true)` action. A running verifier without
the exact control is reported as waiting for inspection; no action is guessed.
Ambiguous trial controls remain refused. The state read performs no input.

Regression checks execute the real bridge state function with pre-frame trial,
trial alongside an enabled frame, verifier-only, ready/closed and ambiguous
states, and check the delivered tool rendering. The full suite passed. A fresh
installed Electron ASAR load exposed 61 tools and the new state fields; the live
IDE was enabled, unblocked and had no trial prompt or other dialog. Evidence:
`arya-electron-startup-state.json` in the parent workspace. This ready-state read
does not prove a new live trial dismissal or the existing Arya chat's catalog.

## Writable FB parameter review

Programming review now diagnoses literal output and in-out bindings, including
TIME/date/real/string constants. A parsing fix preserves string values after
named argument operators; masked literal text was previously consumed as
whitespace. Direct declared variables resolve as writable storage. Members,
indexes and other unproven expressions remain explicit warnings rather than
being silently accepted or rejected as constants. Findings retain the resolved
interface citation and its authority level.

The full regression suite passed. Read-only installed Electron ASAR acceptance
used the original TopCutterCamSetup's `fbCamSelect` and its native-bound
PLCopenPlus_v_2_2a Y_CamStructSelect interface. Three proposed TIME/string/REAL
literal cases each produced both output and in-out errors with interface hashes;
the valid CamTable/TopCutterCamReady bindings produced zero errors. Complete
before/after POUs, tasks, globals, source streams and translation snapshots
matched; native modified state remained false. No proposed code was written.
Evidence: `native-writable-bindings-423f8485-8ac9-4e52-bb3f-919f210f851e.json`
in the disposable fixture's verification directory. The opt-in harness is
`test/native_writable_bindings_live.mjs`. These are static review results,
not a runtime cam-table acceptance or proof of the running Arya chat's tools.

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
| POU add/edit/delete | Native blank ST/IL/FBD/LD creation and populated ST/IL/LD lifecycles passed; one populated TON FBD copy/rename/export/import/delete lifecycle also passed with source preservation. Arbitrary graphical lifecycles remain unproven |
| Local/global/external variables | Native add/edit/delete passed for all three scopes. Native group changes remain refused; one local INT grid move through Ctrl+X/Ctrl+V passed with full declaration/flag checks and compilation |
| Tasks and POU assignment | Public native create/settings edit/assign/exact-instance unassign/delete passed; controller-specific timing acceptance remains separate |
| POU code editing | Native ST/IL import/replacement/clear, exact comments/flags/collateral, stale-body refusal and fresh Build/Make passed. One FBD TON placement/wiring/edit and one LD parallel/serial rung passed; arbitrary graphs remain unproven |
| Toolbox and FB insertion | Installed interfaces, native ST FB insertion, graphical TON placement/wiring and compiler FB pin resolution passed; arbitrary toolbox objects remain unproven |
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

## Compiler FB pin read-back

The graphical reader now follows each referenced local FB instance's compiler
type ID to its exact same-resource DIT file. It validates FUNCTION_BLOCK identity,
CI number, the saved instance type, total declaration count and complete unique
ordinals/names before exposing public input/output/in-out names and directions.
Compiler-generated private names such as Code@@80 count toward completeness but
remain private. Unknown ordinals remain unresolved. Every dependency retains its
hash and is checked again before returning; the public tool requires dependency
timestamps from the fresh Build as well as the four original POU artifacts.

The first live run found a parser gap in graphical library private declarations;
it stopped rather than inventing pin names. The repaired run accepted all three
original LD programs: ServoTaskSlow resolved 44 pin references through four FB
dependencies; ServoHoming resolved 11 through Home_LS, including its private
compiler rows; EIP_ToCLX has function calls and correctly returned zero FB pins.
Make was compiled/unmodified, and the complete seven-POU, task/global, program
stream and translation baseline matched exactly after these read-only checks.

Evidence: graphical-pins-live-f22ff0b3-25ca-43a5-941b-7886f979d363.json in the
disposable verification directory. Eight reader regressions cover the reversed
TON output ordinals, internal/unknown fields, wrong type/CI/kind, incomplete and
duplicate declarations, missing dependencies and changed dependency contents.
The native live harness is test/graphical_pins_live.mjs. This improves graph
diagnosis; canvas placement/wiring and controller behavior remain separate
checks. General LD editing, IL editing and active Arya acceptance are still open.

## Basic ladder editing with observed shortcuts

A disposable CodexLadderProbe PROGRAM/LD POU was prepared with native APIs:
Run, Alternate, Stop and Ready BOOL declarations, and a test-only BG assignment.
Exact native worksheet navigation was accepted before companion input. The
current Objects menu displayed F6 Contact Network, F7 Contact Right and Ctrl+F7
Contact Below; each was exercised and its actual result observed. Tab inline
editing bound the initial contact and coil to existing Run/Ready declarations.
Contact/Coil Properties bound the serial Stop contact and selected its normally
closed symbol. Ctrl+F7 inserted a parallel contact below Run; its properties
reused Alternate. The settled canvas showed the branch rejoining before Stop.

Fresh Build/listing returned one network, matched exactly to LD Run, OR
Alternate, ANDN Stop, ST Ready. Make was compiled/unmodified. All four native
declaration rows, groups/flags and unrelated sources remained identical. The
first verification stopped because native Save removed the scratch body's
empty translation file; inspection confined that change to the intended body,
retained the stop evidence and required all other translations to match.

Explicit native unassignment/deletion removed only this probe. Fresh Build/Make
were clean, and the complete original seven-POU, tasks/globals, program streams
and translation baseline matched exactly. The evidence is ld-canvas-live.json,
phase cleaned, in the disposable verification directory; the opt-in harness is
test/ld_canvas_live.mjs. The graphical guide now carries this tested path.
Multi-object branches, arbitrary LD graph lifecycles, IL editing and actual
running Arya acceptance remain unproven. The support-engineer goal stays active.

## Native IL text lifecycle

An exact disposable native creation confirmed language 1, the .AB text body and
saved worksheet record kind 9. Native ChangeCodeWS with the IL language returned
0 and saved; its comment used the same worksheet translation reference format
as ST. The new mw_code_read_text resolves complete ST/IL comments, while the
existing mw_code_read_st remains ST-only. IL bodies now participate in complete
source/structural hashes, blank-body checks and exact worksheet navigation.

The public lifecycle accepted IL blank creation/deletion, four BOOL declarations,
full-body import, stale expected_body refusal, body replacement, native copy and
rename, clearing and deletion. Native imports preserved all declaration fields,
groups/flags, unrelated POUs, tasks/globals and translation collateral. The
assigned test program compiled before and after its edit; Make was clean, and
complete source snapshots stayed unchanged across compilation. Explicit cleanup
restored the original seven-POU source/task/global/translation baseline exactly.
Evidence: native-il-live-6916bbf5-cd3b-4cb4-a273-4c47e5fcacf3.json, phase cleaned,
in the disposable verification directory; harness test/native_il_live.mjs.

The existing native ST lifecycle additionally passed after the import language
became explicit: comments, stale-body refusal, replacement/clear and Build/Make
with source preservation. Its compile evidence is
native-code-live-build-831c5268-0dfd-488c-9f4a-8083299c8c1e.json. The final
cross-language cleanup/source check is test/native_text_final_live.mjs.

The catalog now has 61 tools, including mw_code_read_text. ST/IL edit guides
return the packaged NATIVE_TEXT_WORKFLOW.md and prefer native imports over
typing. Bridge protocol 4 refuses a stale import handler. IL text input retains
the same printable ASCII restriction. Static ST review explicitly reports IL
as unsupported, even for a supplied body, and must not label IL as ST reviewed.
The ST FB insertion helper remains ST-only. This establishes the tested IL text
lifecycle; arbitrary graphic/toolbox objects and actual running Arya acceptance
remain open. The full support-engineer goal stays active.

## Populated FBD native lifecycle acceptance

The opt-in `test/native_fbd_lifecycle_live.mjs` exercised the public tools on the
sole disposable fixture. It created an ST TON call with Run, Ready and Elapsed
bindings, converted it to FBD, copied and renamed the populated graph, exported
it, deleted the scratch copy and imported the same retained package. The
imported snapshot exactly matched the pre-export snapshot. A fresh graphical
listing resolved all four TON pins (IN, PT, Q, ET) from matching compiler
artifacts; Make succeeded with compiled=true and modified=false.

Native copy/rename retained the original worksheet names. The first harness
comparison incorrectly normalized names by POU name and stopped after the
successful copy. Every graph/declaration stream byte hash matched. The harness
was corrected to compare unique stream roles, then resumed only after matching
the current saved state to the successful native copy receipt. No creation,
conversion or copy was repeated.

Cleanup removed both scratch task instances and POUs. Fresh Build succeeded
(compiled=true, modified=true), then Make settled compiled=true/modified=false.
The complete original seven POUs, five tasks, globals, program streams and
translation files matched the retained baseline exactly. Evidence:
`native-fbd-lifecycle-ed53b00f-1f61-469e-aa4f-a36a02591553.json`, phase cleaned,
accepted=true. No controller action occurred. This proves one populated TON FBD
lifecycle; arbitrary toolbox graphs and running Arya chat acceptance remain open.

## Bound installed-interface engineering review

`mw_code_check_program` now supports `installed_interfaces:true` on the verified
clean open project. Vendor FB signatures come from its bound firmware parameter
tables or toolbox declaration streams, with source/registry hashes in findings.
Project-defined interfaces keep precedence. Failed or ambiguous installed
resolution stays unresolved, without historical fallback. `interface_libraries`
selects the intended bound library for duplicate names; IEC and eCLR both expose
TON in the live fixture. TIME short literals and generic ANY pins no longer
produce false exact-type mismatch findings.

Live public acceptance created a disposable TON plus TON_Retentive ST POU.
Read-only proposed calls exposed wrong pin names, BOOL/TIME mismatches and an
in-out constant as errors with installed source citations. The initial harness
stopped because unselected TON correctly remained ambiguous; it resumed only
once the complete saved sources and corrected body matched the retained state.
The selected IEC/Toolbox review then passed; the corrected calls had zero review
errors and no unresolved interfaces. Native Build/Make compiled successfully.
The erroneous proposed code was never written. Full before/after snapshots
prove review made no source changes, and cleanup restored the original seven
POUs, tasks, globals, source streams and translations before final Build/Make.
Evidence: `native-engineering-eb30827d-3d21-4789-978f-04c6f1f60b2e.json`, phase
cleaned, accepted=true. This is static diagnostic/compile acceptance, not proof
of complete machine behavior or the already-running Arya chat's catalog.

## Exact saved task ownership and timing context

`mw_code_tasks` and programming review now resolve each saved task instance to
its registered PROGRAM type instead of comparing type names to instance names.
The task result includes configuration/resource identity, native instance order,
cycle kind and exact SET fields (interval, priority and watchdog), plus source
hashes and changed-during-read refusal. Tree warnings, unknown program types,
duplicate identities and task/settings mismatches cannot claim exact ownership.
The obsolete instruction that task assignment is refused was replaced with the
public guarded `mw_ide_task_change` workflow. Saved ownership remains distinct
from current unsaved IDE state, indirect calls and runtime execution.

Read-only public acceptance compared all five saved tasks to the live native
COM task model, including a differently named instance. Names, types, order,
cycle kinds and complete settings agreed. No original PROGRAM is without a
direct task assignment. The former instance-name heuristic falsely reported
EIP_ToCLX; that warning is absent from the new programming review. Complete
before/after POU, task, global, program-stream and translation snapshots match.
Evidence: `native-task-ownership-cec2827e-382a-4bfc-9e3d-e46842d4588b.json`,
phase accepted, accepted=true. No IDE source or controller mutation occurred.

## Existing variable group move: observed shortcut fallback

Installed Ade variable Group is a property-get only; POU MoveToGroup is a different
interface. Native variable mutation continues to refuse group changes and now
routes to the documented grid workflow. The grid Properties dialog has no group
selector. Installed var001 topic assigningadeclarationtoacertainvariablesgroup.htm
(hash b0b733272ddc090881e2845056946d504367bd2aaeb9b541c9663ecc9f7f6cf3)
provides cut/paste and drag/drop for existing declarations.

The disposable live proof created two INT declarations and a writable Destination
group through native APIs. After exact native variable navigation, selecting only
Mover's full data row, Ctrl+X, selecting the current Destination group header and
Ctrl+V moved Mover once. Full saved/native verification retained its name, type,
VAR usage, initializer, description, empty address and six native flags, with
Anchor and group read-only states unchanged. Only declaration/group streams in
the scratch POU changed. Code using Mover and Anchor was then imported natively,
assigned to a disposable BG instance, and compiled with source preservation.
Cleanup unassigned/deleted the scratch POU and restored the exact original seven
POUs, tasks, globals, source streams and translations; final Build/Make passed.
Evidence: native-variable-group-live.json, phase cleaned, accepted=true.

The first drag changed foreground; native inspection proved no mutation. A second
fresh drag only changed selection. Neither established a move, and no input was
sent into Codex. Cut/paste was observed independently. This is one local INT
proof, not batch/global/protected-group acceptance. The public mw_ide_variables
reader now exposes section, group, description, all six flags and group read_only
state for independent verification, and native read failures refuse partial data.
