# MotionWorks IEC editing workflow

The current workflow and supported operations are defined in [SKILL.md](SKILL.md).
Format provenance and verification limitations are in [docs/RELIABILITY.md](docs/RELIABILITY.md).

1. Discover and select the workspace project; stage its wrapper and expanded directory.
2. Inspect native source and run offline validation.
3. Close the workspace-bound IDE project gracefully, preview and commit the intended edits.
4. Retain the verified transaction journal and full before snapshot.
5. Validate, reopen the exact staged wrapper, run Build, and inspect diagnostics.
6. Save, close/reopen, inspect persistence and repeat acceptance checks as needed.

Offline regression tests do not prove live IDE acceptance. Never substitute a cached
IsCompiled value for the result of the current build, or repair disk files while the IDE
has the project open. The staged workspace copy is the deliverable; source promotion is explicit.

On MotionWorks IEC 1.19, live Build passed on TopCutter. A created cyclic task with a newly
assigned POU stalled its Build with no compiler messages. Task creation and deletion without
an assignment passed. Treat newly created task assignments as unverified; see
[the capability audit](docs/VERIFICATION_2026-09-30.md).
