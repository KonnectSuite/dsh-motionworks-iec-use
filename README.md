# MotionWorks IEC Use for AryaAI DSH

Version 0.5.1 is IDE-first. The agent codes in MotionWorks through the separately
connected computer-use MCP, using `mw_ide_edit_guide` for operation-specific steps.
Eight offline code/variable/POU editors and the unsupported Rebuild API are
removed from the public catalog, not merely gated. See [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md).
For an IDE already open, use the [attach-first Remote Engineer workflow](docs/OPEN_IDE_REMOTE_ENGINEER.md).
Continue a verified open stage; do not close/restage it for each coding request.
Read the [engineering workflow](docs/ENGINEERING_WORKFLOW.md) for requirements,
FB lifecycle, tasks, cams, registration, PLC authority, stops/recovery, IO scaling
and behavioral acceptance. `mw_ide_edit_guide` includes an `engineering` operation.
Guidance distinguishes vendor facts, original engineering judgment and open items.

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

- Current edits use native IDE editors; retired disk writers are not a fallback.
- Private native-format regression tests preserve historical parser/rollback coverage;
  they do not establish supported public editor capabilities.
- `mw_code_validate` reports offline consistency errors; unsupported layouts fail closed.
- IDE close is graceful and workspace-checked. Failed builds never repair live disk files.
- Closing the IDE or replacing its open project requires user approval tied to the exact
  project path. The bridge saves that project, then closes it; a changed project is refused.
- Build and Make remain distinct operations; the unsupported Rebuild API is retired.
- Compile completion is reported unverified when only a cached success flag is available.
- Persistence verification repeats fresh Build/Make after reopening and fails closed
  on missing validation/digests, changed program streams or unproven completion.

## Workflow

Version 0.3 adds five tools for source-linked programming review, diagnostic lookup,
reusable ST patterns and searchable official manuals. It includes 22 reviewed topics,
six historical FB interfaces, four original patterns and optional indexing of 1,530
PDF pages. Source revisions and unresolved coverage are returned explicitly. See
[Programming knowledge](docs/PROGRAMMING_KNOWLEDGE.md) for tool usage and scope.

Open, Build and close passed a live check on a disposable TopCutter copy with MotionWorks IEC
1.19. Rebuild through the bridge API was not accepted and is retired; observed native
menu Rebuild has separate evidence in the 2026-10-01 IDE smoke report.

Discover → attach to verified stage (or stage/open if needed) → engineering review →
edit inside IDE → Save All → read back → Build/Make → inspect diagnostics →
approved close/reopen → validate and fresh Build/Make again → handoff.

See [SKILL.md](SKILL.md) for current agent instructions. Native-format and 2026-09-30
audit documents are explicitly historical, not current edit routes. The plugin registers
the skill with the host. [IDE smoke evidence](docs/IDE_SMOKE_2026-10-01.md) records
individually tested UI operations; untested operations still require harness acceptance.

Run `npm test` for isolated regression checks. The optional `test/native_reference.py`
accepts a supplied native fixture path and edits only a disposable temporary copy.
No project data from the supplied ZIP is distributed in the package.

Reload the AryaAI DSH plugin after updating this installed directory. A package-manager
reinstall can replace local changes; retain this updated package as your source version.

Not affiliated with Yaskawa. Native IDE acceptance remains a separate check from the
offline suite. Arbitrary LD generation, generic offline library/task creation, automatic
crash recovery and machine commissioning are not claimed.
