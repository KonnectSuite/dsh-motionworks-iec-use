# MotionWorks IEC editing workflow

The current workflow and supported operations are defined in [SKILL.md](SKILL.md).
Format provenance and verification limitations are in [docs/RELIABILITY.md](docs/RELIABILITY.md).

1. Discover and select the workspace project; stage its wrapper and expanded directory.
2. Run `mw_workflow_check` on the explicitly selected stage. Inspect native sources,
   identity, wrapper binding and blockers before any write. Session notes are
   historical evidence, not a substitute for reading current VB/VGR/STB streams.
3. Open the exact stage. If replacing another open project, obtain save/close consent.
   Use the connected computer tool to edit in the MotionWorks IDE, not native files.
   Follow [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md) and `mw_ide_edit_guide`.
4. Save in MotionWorks; read back the saved source/declarations/tasks and compare
   with the intended change. Retain baseline and observation evidence.
5. Use `mw_ide_verify` on the saved stage for fresh
   Build, Make, Errors/Warnings capture and Save evidence in one call.
6. With explicit consent, set `close_reopen: true` and `user_approved: true` to
   verify persisted native streams and descriptions. Inspect the report's verdict;
   `unverified` is not success even if the tool itself returned without throwing.

Offline code editor tools and the unsupported Rebuild API are retired. Use native
IDE commands for POU lifecycle and declarations. Private engine tests are historical
format coverage, not supported agent editing workflows.

Use `mw_code_source_manifest` for source provenance. Generated DLLs, `tmp.sto`,
cached compiler flags and transaction success alone are not IDE acceptance.
Normal Build/Save can change PROJECT.TRE bookkeeping: compare program/declaration
and description sources across compilation, then compare the saved baseline
against the reopened project. Retain differences rather than deleting the tree.

Offline regression tests do not prove live IDE acceptance. Never substitute a cached
IsCompiled value for the result of the current build, or repair disk files while the IDE
has the project open. The staged workspace copy is the deliverable; source promotion is explicit.

On MotionWorks IEC 1.19, live Build passed on TopCutter. A created cyclic task with a newly
assigned POU stalled its Build with no compiler messages. Task creation and deletion without
an assignment passed. Treat newly created task assignments as unverified; see
[the capability audit](docs/VERIFICATION_2026-09-30.md).

See [session lessons](docs/SESSION_LESSONS.md) for the reproducible disposable
smoke command and evidence levels. Native tests never connect to controllers.
