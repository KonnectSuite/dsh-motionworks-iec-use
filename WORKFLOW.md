# MotionWorks IEC editing workflow

The current workflow and supported operations are defined in [SKILL.md](SKILL.md).
Format provenance and verification limitations are in [docs/RELIABILITY.md](docs/RELIABILITY.md).

1. Inspect `mw_ide_status`, then select the exact `.mwt` in Arya's workspace
   with `mw_project_find`. Ask before the first complete backup in this session.
   Call `mw_ide_attach` with `backup_approved:true`; if the project is already open,
   reconcile Save All and add `baseline_saved:true`. If closed, the tool backs up
   and opens the same workspace files. Once the approved backup exists, continue
   the project without asking again. Obtain exact-project save/close consent if
   another project is open.
2. Run `mw_workflow_check` on the selected project. Inspect sources and blockers.
   Read [engineering guidance](docs/ENGINEERING_WORKFLOW.md) for motion design.
3. Use the connected computer tool and native IDE commands to edit the selected
   project. Follow [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md).
4. Use native Save All in MotionWorks; read back the saved source/declarations/tasks and compare
   with the intended change. Retain baseline and observation evidence.
5. Use `mw_ide_verify` on the saved authorized project for fresh
   Build, Make, Errors/Warnings capture and Save evidence in one call.
6. With explicit consent, set `close_reopen: true` and `user_approved: true` to
   verify persisted native streams/descriptions and repeat fresh Build/Make after reopening.
   Inspect the report's verdict;
   `unverified` is not success even if the tool itself returned without throwing.

Offline code editor tools and the unsupported Rebuild API are retired. Use native
IDE commands for POU lifecycle and declarations. Private engine tests are historical
format coverage, not supported agent editing workflows.

Use `mw_code_source_manifest` for source provenance. Generated DLLs, `tmp.sto`,
cached compiler flags and transaction success alone are not IDE acceptance.
Normal Build/Save can change PROJECT.TRE bookkeeping: compare program/declaration
and description sources across compilation, then compare the saved baseline
against the reopened project. Retain differences rather than deleting the tree.

The selected workspace project is edited in place; it has no sync-back step.
Projects outside Arya's workspace remain read-only until the user places a copy in
the workspace. Offline writers remain stage-only.

Offline regression tests do not prove live IDE acceptance. Never substitute a cached
IsCompiled value for the result of the current build, or repair disk files while the IDE
has the project open. The selected workspace project is the deliverable.

On MotionWorks IEC 1.19, live Build passed on TopCutter. A created cyclic task with a newly
assigned POU stalled its Build with no compiler messages. Task creation and deletion without
an assignment passed. Treat newly created task assignments as unverified; see
[the capability audit](docs/VERIFICATION_2026-09-30.md).

See [session lessons](docs/SESSION_LESSONS.md) for the reproducible disposable
smoke command and evidence levels. Native tests never connect to controllers.
