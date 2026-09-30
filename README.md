# MotionWorks IEC Use for AryaAI DSH

Windows plugin for workspace-bound MotionWorks IEC discovery, staging, native offline
editing and IDE verification. It never downloads to a controller or commands motion.

The selected `.mwt` and expanded directory must be inside the calling agent workspace.
Editable copies live in `<workspace>/.motionworks/stage/`; there is no hard-coded user
project path. Outside references are read-only. Exports, backups and transaction journals
stay inside that workspace too.

## Reliability changes

- Declaration and native grid changes are synchronized, including global variables.
- Native donors preserve record usage, group trailers and worksheet row semantics.
- Description edits synchronize native IDs and translation XML.
- POU clones preserve external/local/FB semantics and update tree, registry and view state.
- Real edits use complete verified snapshots, project locks and rollback on failure.
- `mw_code_validate` reports offline consistency errors; unsupported layouts fail closed.
- IDE close is graceful and workspace-checked. Failed builds never repair live disk files.
- `mw_ide_rebuild` requests native Rebuild; Build and Make remain distinct operations.
- Compile completion is reported unverified when only a cached success flag is available.

## Workflow

Version 0.3 adds five tools for source-linked programming review, diagnostic lookup,
reusable ST patterns and searchable official manuals. It includes 22 reviewed topics,
six historical FB interfaces, four original patterns and optional indexing of 1,530
PDF pages. Source revisions and unresolved coverage are returned explicitly. See
[Programming knowledge](docs/PROGRAMMING_KNOWLEDGE.md) for tool usage and scope.

Open, Build and close passed a live check on a disposable TopCutter copy with MotionWorks IEC
1.19. Native Rebuild remains version dependent and has not been accepted on this IDE build.

Discover → select → stage → inspect → close IDE → preview → commit → offline validate →
open the staged wrapper → Build → inspect diagnostics → save → close/reopen → verify.

See [SKILL.md](SKILL.md) for the agent instructions and [RELIABILITY.md](docs/RELIABILITY.md)
for scope and verification details. The plugin registers the skill with the host.
The [live capability audit](docs/VERIFICATION_2026-09-30.md) records the task, LD and library
limitations measured on this host.

Run `npm test` for isolated regression checks. The optional `test/native_reference.py`
accepts a supplied native fixture path and edits only a disposable temporary copy.
No project data from the supplied ZIP is distributed in the package.

Reload the AryaAI DSH plugin after updating this installed directory. A package-manager
reinstall can replace local changes; retain this updated package as your source version.

Not affiliated with Yaskawa. Native IDE acceptance remains a separate check from the
offline suite. Arbitrary LD generation, generic offline library/task creation, automatic
crash recovery and machine commissioning are not claimed.
