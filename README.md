# MotionWorks IEC Use for AryaAI DSH

An IDE-first engineering assistant plugin for **AryaAI's DSH/Cordis host on Windows**.
It helps an agent inspect, troubleshoot, design and maintain MotionWorks projects.
It is not a standalone desktop application or an MCP server: a separately connected
computer-use MCP performs visible editor actions.

**Safety boundary:** use supervised, disposable project copies. This plugin does not
download to controllers, force IO or command motion. Compilation is not proof of
machine behavior, motion performance or functional safety.

Use `mw_ide_variable_change` for native local/global/external add/edit/delete,
with complete saved/native read-back checks. Use `mw_ide_open_worksheet` to open
code or variables by exact saved tree identity and verify the active view. These
operations use COM without mouse input. The [worksheet workflow](docs/VARIABLE_WORKSHEET_WORKFLOW.md)
also covers dialog fallbacks and the retained planning/verification tools.

## Requirements and installation

- Windows with MotionWorks IEC 3 Pro installed and usable under your own license or
  the vendor's offered trial. Other versions require acceptance testing. The bridge's
  API version `1.19` is not the product marketing version or controller firmware.
- Node.js 20 or later; a recent supported release is recommended for the test suite.
- Python 3 accessible to the host. Arya's bundled interpreter is auto-discovered;
  otherwise set `MW_PYTHON` to its absolute path before starting Arya. The normal
  read-only engine uses the standard library. The IDE bridge uses Windows' 32-bit
  PowerShell and installed vendor automation components.
- AryaAI DSH/Cordis bundle support and a writable task workspace.
- A separately installed desktop-control companion for IDE editing. See
  [computer-use setup](docs/IDE_FIRST_WORKFLOW.md#architecture-and-dependency).
  Its permissions, dependencies and security updates are separate from this plugin.

Clone this repository locally and run `npm run preflight` there to check the package
and registered tool contracts. Install the checkout through Arya's plugin manager,
which owns the profile dependency/lockfile:

```text
plugin_manager install_bundle file:C:\path\to\dsh-motionworks-iec-use
```

This is a **host plugin-manager operation**, not a PowerShell command. If your host
exposes a graphical installer, select the same local bundle directory. Do not create
manual junctions in the profile's `node_modules`. Restart the host after updates,
connect the computer-use MCP separately, and confirm the `mw_ide_*` tools and
`motionworks-iec-use` skill are available. This bundle does not automatically register
a desktop-control server.

## First use: open IDE or a new test copy

Keep the `.mwt` wrapper **and its matching expanded project directory** together
inside your task workspace. A wrapper alone is not a complete project backup.

1. Discover the workspace project and inspect the running IDE's exact active path.
   A matching caption/project name alone is insufficient.
2. Continue an already-open **verified staged copy** without closing/re-staging.
   An arbitrary open project—even inside the workspace—is not automatically approved
   for editing. Inspect read-only and approve a disposable stage first. Preserve
   unsaved work before switching projects.
3. Review requirements/code, edit inside the IDE, Save All, and compare saved source,
   declarations and task bindings with the intended changes.
4. Build/Make and retain diagnostics. Approve exact-project close/reopen separately
   for persistence testing; leave the project open otherwise.
5. Source promotion back to the original requires a separate explicit request.
   Controller download and commissioning are outside this plugin's workflow.

Example requests:

> MotionWorks is open. Verify this is the project in my workspace, then investigate
> false registration cuts. Explain the cause or remaining hypotheses before editing.
> Do not download or command motion.

> Review unused declarations, duplicated logic and task/FB lifecycle problems.
> Propose cleanup that preserves behavior, apply approved changes in the IDE,
> then verify saved readback and compilation.

## Capabilities and evidence

| Capability | Current evidence / boundary |
|---|---|
| Source/declaration/task inspection and engineering guidance | Available; installed interfaces take precedence over historical FB references |
| Native COM variable lifecycle and named worksheet navigation | Local/global/external add/edit/delete and code/local/global navigation passed in a disposable stage; see implementation status |
| Native ST POU creation, local variable edits, existing-task assignment | Live IDE, saved readback and reopen evidence |
| Global add/edit/remove with external consumer | Live compilation and removal/reopen persistence evidence |
| Build/Make and approved persistence verification | Fresh compile evidence, exact identity and retained source-hash comparisons |
| LD/FBD, libraries, arbitrary POU rename/delete and newly created tasks | Guided workflows; broader live lifecycle acceptance still required |
| All FB/FU interfaces, high-speed motion, production behavior and safety | Not universally validated; project-specific engineering and supervised commissioning required |

See [initial IDE smoke](docs/IDE_SMOKE_2026-10-01.md) and
[global lifecycle smoke](docs/LIVE_GLOBAL_SMOKE_2026-10-01.md) for warnings,
failures/recovery and actual coverage. These are dated evidence, not universal guarantees.

## Documentation map

- [Attach-first workflow](docs/OPEN_IDE_REMOTE_ENGINEER.md): continue an open verified stage.
- [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md): companion setup and operation recipes.
- [Engineering workflow](docs/ENGINEERING_WORKFLOW.md): design/review and machine acceptance.
- [Workflow and verification](WORKFLOW.md): saved-source and compiler release checks.
- [Programming knowledge](docs/PROGRAMMING_KNOWLEDGE.md): reference/version limits.
- [Retired tools](docs/TOOL_RETIREMENT.md): old-to-current operation routes.
- [Contributing](CONTRIBUTING.md): development, tests and sanitized bug reports.
- [Changelog](CHANGELOG.md): release changes. Older native-format/audit documents are
  historical, not alternative editing instructions.

## Troubleshooting and support

| Symptom | Safe next step |
|---|---|
| Tools absent | Run preflight against the installed checkout, inspect host bundle errors, restart host |
| Python not found | Set `MW_PYTHON` before launching the host; verify the interpreter |
| Capture fails or another app is focused | Stop input; check companion permissions/focus; never click blindly |
| API cannot attach but IDE is visible | Preserve work and inspect modal/identity state; do not launch duplicates or kill the IDE |
| Wrapper/workspace refused | Inspect readiness/binding; do not re-stage over edits or bypass guards |
| Save/readback differs | Observe native Save All and verify complete saved source and clean state |
| Empty diagnostics/cached Make | Require observed compilation; empty panes/old flags are not a PASS |
| Trial dialog blocks startup | Use only the vendor-offered trial option; never bypass licensing |

Use [GitHub Issues](https://github.com/KonnectSuite/dsh-motionworks-iec-use/issues)
for reproducible bugs. Include plugin commit/version, host/Windows/IDE versions,
sanitized tool request/result, verifier phase and a minimal disposable reproduction.
Review logs/screenshots/reports before sharing: remove customer code, IP addresses,
paths and tokens. Do not upload customer projects or proprietary vendor manuals.

## Current architecture

Version 0.5.5 supports native COM declaration changes and worksheet navigation,
with Electron-packaged runtime paths/mailboxes. The agent uses native IDE APIs
first and the separately connected computer-use MCP for remaining editor actions,
using `mw_ide_edit_guide` for operation-specific steps.
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
