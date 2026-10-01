# MotionWorks IEC Use for AryaAI DSH

Version 0.5 is IDE-first. The agent codes in MotionWorks through the separately
connected computer-use MCP, using `mw_ide_edit_guide` for operation-specific steps.
Eight offline code/variable/POU editors and the unsupported Rebuild API are
removed from the public catalog, not merely gated. See [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md).
For an IDE already open, use the [attach-first Remote Engineer workflow](docs/OPEN_IDE_REMOTE_ENGINEER.md).
Continue a verified open stage; do not close/restage it for each coding request.

It also adds `mw_workflow_check`, `mw_code_source_manifest` and `mw_ide_verify`:
readiness with actionable blockers, native-source fingerprints, and retained IDE
acceptance reports. A cached no-op Make is explicitly distinguished from a freshly
observed compilation. See [session lessons](docs/SESSION_LESSONS.md).

Run isolated regressions (no IDE input) with:

```powershell
npm test
```

For live UI smoke tests, follow the operation matrix in the IDE-first workflow on
a disposable staged project. Capture actual computer-tool observations and compile
reports. Isolated regressions do not operate the IDE or prove live UI acceptance.
Historical offline write probes are not a supported smoke workflow.

Windows plugin for workspace-bound MotionWorks IEC discovery, staging, IDE-first
editing and verification. It never downloads to a controller or commands motion.

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
- Multi-variable writes are atomic by default; best-effort partial writes require explicit opt-in.
- `mw_code_validate` reports offline consistency errors; unsupported layouts fail closed.
- IDE close is graceful and workspace-checked. Failed builds never repair live disk files.
- Closing the IDE or replacing its open project requires user approval tied to the exact
  project path. The bridge saves that project, then closes it; a changed project is refused.
- Build and Make remain distinct operations; the unsupported Rebuild API is retired.
- Compile completion is reported unverified when only a cached success flag is available.

## Workflow

Version 0.3 adds five tools for source-linked programming review, diagnostic lookup,
reusable ST patterns and searchable official manuals. It includes 22 reviewed topics,
six historical FB interfaces, four original patterns and optional indexing of 1,530
PDF pages. Source revisions and unresolved coverage are returned explicitly. See
[Programming knowledge](docs/PROGRAMMING_KNOWLEDGE.md) for tool usage and scope.

Open, Build and close passed a live check on a disposable TopCutter copy with MotionWorks IEC
1.19. Native Rebuild remains version dependent and has not been accepted on this IDE build.

Discover → select → stage → inspect → open exact stage → edit inside IDE → Save →
read back → Build/Make → inspect diagnostics → approved close/reopen → verify.

See [SKILL.md](SKILL.md) for the agent instructions, [native edit workflow](docs/NATIVE_EDIT_WORKFLOW.md)
for the on-disk format and proof procedure, and [RELIABILITY.md](docs/RELIABILITY.md)
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
