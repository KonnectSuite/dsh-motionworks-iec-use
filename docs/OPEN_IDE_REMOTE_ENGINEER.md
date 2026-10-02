# Arya as MotionWorks Remote Engineer — attach first

## Starting request

> Arya, MotionWorks is already open on my test project. Help with new-sheet detection:
> I get false cuts, and suspect registration-eye chatter. Disconnecting the eye leaves
> the knife parked. Read the saved code, investigate, then edit in the IDE. Do not
> download or command motion.

Eye disconnection implicates the input path but does not prove optical chatter rather
than wiring/noise, polarity, software rearming, startup behavior or repeated requests.

## Hybrid workflow

1. `mw_project_find` establishes the workspace. Inspect `mw_ide_state` for blockers
   and `mw_ide_status` for active project identity. Match the exact requested project.
2. Continue an already-open verified stage. Do not call stage/open/close to begin
   each coding request. Current tools permit guarded edits/builds only on verified
   stages. An arbitrary open production project is not automatically adopted: inspect
   read-only and obtain approval for a test copy. Never weaken identity guards.
3. Preserve unsaved UI edits. Reconcile visible text with saved files before relying
   on disk. Save through the API when authorized and check complete read-back. If a
   worksheet remains dirty or absent on disk, use observed File > Save All. Never
   replace an unsaved editor with an older disk body.
4. Read saved POU bodies/declarations, globals, libraries and tasks using file-level
   tools. Capture source manifests/backup evidence. This is inspection, not offline
   coding. Inspect graphical logic visually where tools lack semantic coverage.
5. Explain source-backed findings, label hypotheses, and establish missing physical
   requirements and acceptance criteria before selecting filter thresholds.
6. Prefer native editing in the verified IDE: `mw_ide_variable_change` for complete
   declarations/descriptions, `mw_ide_code_change` for ST/IL text, and
   `mw_ide_pou_change`/`mw_ide_task_change` for structural changes. Use
   `mw_ide_fb_insert` for installed-interface ST block calls. These operations do
   not need editor focus or coordinate clicks. Check every verification result.
   For graphical canvas and unsupported variable-grid operations, read the exact
   operation guide and installed shortcut help before using the computer MCP.
   Observe, one action, refresh. Match project and editable focus each time.
7. API Save; compare full saved read-back with intended changes. Native comments can
   reside in translation records rather than literal ST bodies.
8. API Build/Make; inspect current diagnostics and fresh-completion evidence. Native
   Rebuild is separate and version-dependent; prefer the proven fresh native
   Build/Make tools. Compare source manifests afterward.
9. Leave the project open unless a separately approved persistence test is requested.
   That test includes fresh Build/Make after reopening, not hashes alone. No controller
   download, Run/Reset, forces or motion commands.

## API failure and trial edition

API control is preferred for lifecycle/build operations but is not proven merely by
a visible IDE. A timeout or `ide_running:false` that conflicts with a screenshot is
an attach/detection failure, not permission to launch another IDE, replace the project
or edit disk underneath it. Preserve work and report the contradiction. Inspect modal
state before bounded recovery; never loop commands.

For the trial edition, inspect the startup dialog. The existing trial helper can
select the normally offered Use Trial option and must verify dismissal. Do not enter
keys, alter licensing, circumvent an expired trial or click unknown dialogs. If the
helper fails, use observed UI where permitted or ask the operator to select Use Trial.
Re-query state/status afterward; acknowledgement does not prove the project opened.
Do not relaunch a usable open IDE to repeat trial startup.

## Registration-eye investigation

Trace raw input -> qualification -> event -> captured position -> queue/scheduler ->
cam request -> completion acknowledgement. Find every writer/caller, task order/period,
retained state and startup/mode/reset behavior. Confirm polarity and whether capture
uses sampled I/O or a hardware latch.

Required facts before a production filter is chosen:

- Minimum legitimate mark width and clear gap at maximum line speed.
- Minimum legitimate registration spacing, task period and input latency.
- Eye/relay polarity and disconnect behavior; master direction/validity/reset rules.
- Whether marks while busy need buffering, and required cut-position tolerance.

Candidate design, subject to those facts:

- Require a qualified real clear/present state before arming; do not synthesize an
  eligible startup edge from a timer's initial Q value.
- Capture the candidate at the relevant raw transition or documented hardware latch.
  Qualify separately and retain the original captured position.
- Reject glitches and repeated edges using measured qualifications and a permitted
  distance lockout. Never assume a lockout longer than legitimate shortest spacing.
- Accept one event per valid mark independently of cutter-busy state. Queue where
  required; never overwrite unprocessed marks or cut a missed target.
- Define abnormal reset, master re-zero, mode/recipe change and controlled-stop rules.
  Saturate diagnostic counters and report accepted/rejected events and reasons.

Do not insert a generic 30 ms timer and claim position is unaffected. At 60 FPM the
master travels 12 inches/s: 30 ms capture delay is 0.36 inches plus sampling latency.
Preserving the raw position can require scheduler/cam engagement changes; an existing
immediate-cam design cannot be corrected by changing a position variable alone.

## Tests and evidence

Use isolated non-motion test inputs before integrating: initial low/high, stable valid
mark, brief low glitch, brief high bounce, repeated chatter, shortest valid mark and
spacing, long-held eye, stopped/reversed master, marks while busy, disable/re-enable,
and mode/reset/master-zero changes. Assert accepted count and original position, not
just zero compiler errors. Models supplement native compilation and hardware tests.

Verify the integrated pending/cut-request path on the disposable project without
download. Operator commissioning must prove no false cuts and no lost legitimate
registrations at required speed. State what remains untested.

## Approved open test-copy review, 2026-10-01

`TopCutterCutControl` calls `fbEyeFall` with `IN := NOT TopCutter_SI4_EXT1`,
`PT := T#30ms`, derives `xEyeDebounced := NOT fbEyeFall.Q`, and rearms whenever that
derived signal is true. `iMarkScans:INT` increments without saturation. It captures
`rMarkPosition := rMasterPosition` when the filtered event is consumed. These are
review findings, not a proven field diagnosis. No detection code was changed during
this review. API status timed out while the computer MCP showed the approved test
project open with no visible modal; API attachment remains unresolved.

## Follow-up detector prototype and native import, 2026-10-01

The stale plugin-owned bridge was identified by its exact process command line and
restarted outside the restricted execution context. API status then matched the
already-open disposable stage. This establishes a working attachment in this run;
it does not justify weakening identity checks or killing the IDE when attach fails.

The approved test copy received a non-motion `SheetDetectionPrototype` Program using
the IDE's **File > Import > Extended IEC 61131-3 Import** provider. A readable source
artifact contains declarations, descriptions and worksheet body; importing it lets
MotionWorks generate its own native stores. This is a native IDE operation, not an
offline VB/VGR/STB write. Select **Logical POUs** in the Project Tree before Import:
with a variable worksheet selected, the Object types dialog exposed no eligible
scope; cancel and select the proper tree node, rather than forcing the dialog.
Choose POU scope and only the reviewed new POU. Existing-name overwrite/replace
behavior was not tested and is not authorized by this smoke.

Native task assignment and Save worked through the public plugin API. Read-back
verified all 24 local variables with descriptions and the entire executable body.
Existing POU files matched the pre-import backup. Fresh Build completed with zero
errors and 21 warnings, none naming the detector; Make was already up to date and
the visible IDE showed zero errors/zero warnings afterward. The final API Warnings
read returned informational lines, so raw line counts must not be reported as
compiler warning counts. Program/declaration streams remained unchanged during
Build/Save. New detector close/reopen persistence was not tested.

Fourteen behavioral tests executed the actual exported ST subset with modeled TON
timers, not a controller. The detector qualifies paint and clear, captures raw paint
exit before the validation delay, rejects nearby duplicates, and reports saturated
INT counts. Defaults of 30 ms and 12-inch lockout are provisional. The user confirmed
48-inch legitimate spacing and 2–4-inch painted bands. The prototype has only local
inputs and no motion calls; it is not integrated into the immediate straight-cut cam.
Queue/absolute engagement, polarity, timing and machine commissioning remain required.

The accessible package is `SheetDetection_2026-10-01` in the session workspace,
including the importable ST, setup limitations, test runner and native JSON evidence.
