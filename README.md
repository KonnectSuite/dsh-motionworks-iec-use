# MotionWorks IEC Use for AryaAI DSH

An IDE-first engineering assistant plugin for **AryaAI's DSH/Cordis host on Windows**.
It helps an agent inspect, troubleshoot, design and maintain MotionWorks projects.
It is not a standalone desktop application or an MCP server: a separately connected
computer-use MCP performs visible editor actions.

**Safety boundary:** use supervised workspace projects. Select the project inside the workspace, approve its first full backup in the session,
then edit those same files in place. A closed IDE is started and opens that project. This plugin does not
download to controllers, force IO or command motion. Compilation is not proof of
machine behavior, motion performance or functional safety.

Use `mw_ide_code_change` for native ST body replacement with an exact saved
body precondition, full code/comment read-back and collateral source checks.
Follow its accepted verdict with fresh Build/Make.
Use `mw_ide_verify` with `mode:"capture_baseline"`, the exact workspace project and
`baseline_saved:true` before an authorized lifecycle. Retain its `baseline_id`.
After cleanup, `mode:"compare_baseline"` compares complete supported saved
sources, declarations/task settings, translations, native package state and every
bound library file. These modes never edit, save or compile; fresh Build/Make
and runtime acceptance are separate. A failed comparison must be inspected.
Use `mw_code_block_interface` to inspect installed block pins and directions,
then `mw_ide_fb_insert` to declare a new instance and insert its ST call with
explicit bindings. Check the retained phase evidence on partial failure and
compile after successful insertion.
For protected blocks already used by the project, `compiler_verified:true`
requests a fresh, uniquely bound compiled contract with complete project/library
preservation. CamGenerator insertion, build, read-back and scratch cleanup passed
on the disposable fixture. This does not decode protected source or establish
runtime behavior; default cached interfaces remain diagnostic only.
`mw_code_check_program` can review existing or proposed ST against the same
current compiled contract: explicitly request `installed_interfaces:true`,
`refresh_compiler:true`, `baseline_saved:true`, and one exact type-to-library
entry in `interface_libraries`. This runs guarded native Build/Make without
writing the proposed body. Findings retain compiler provenance and coverage
limits; default review remains read-only.
Use `mw_ide_graphical_listing` to diagnose saved LD/FBD compiler networks without
desktop input. It runs a fresh Build, checks unchanged sources and regenerated
matching artifacts, and annotates known declaration symbols. Raw compiler tokens
remain available for inspection; this does not verify canvas placement or wiring.
Use `mw_code_installed_help` to search the actual installed CHM editor and
programming help, including shortcut and toolbox workflows. Text is cached in
the calling workspace with source/topic hashes; vendor help is not bundled.
Use `mw_ide_variable_change` for native local/global/external add/edit/delete,
with complete saved/native read-back checks. Use `mw_ide_open_worksheet` to open
code or variables by exact saved tree identity and verify the active view. These
operations use COM without mouse input. The [worksheet workflow](docs/VARIABLE_WORKSHEET_WORKFLOW.md)
also covers dialog fallbacks and the retained planning/verification tools.
`mw_ide_state` reports `ide_minimized` and `ide_visible` independently of modal
blocking. A minimized diagnostic request refuses before pane activation and
identifies the frame to restore through the connected Windows tool. Restore,
reobserve, then read; an unchanged failed pane read should not be repeated.
An existing IDE blocked by an observed ordinary dialog makes `mw_ide_start`
refuse immediately with the exact frame and dialog identity. Inspect state and
resolve that dialog deliberately; the refusal sends no input, connects no COM
and launches no duplicate IDE. The verified native Use Trial path is unchanged.

For the verified MotionWorks IEC 3 Pro SDK, the bridge generates local interop
to read complete declarations more efficiently. Unknown SDKs or loader failures
use the complete legacy reader. Native read failures remain errors. Generated
SDK binaries are not bundled; no .NET loader policy change is required.

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
2. Continue an already-open workspace project after its approved verified backup.
   An arbitrary open project—even inside the workspace—is not automatically approved
   for editing. Inspect read-only and approve its first verified backup before editing. Preserve
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
| Native COM variable lifecycle and named worksheet navigation | Local/global/external add/edit/delete and ST/LD code/local/global navigation passed; navigation also checks responsive, settled editor frames. Keyboard focus requires current computer-tool observation |
| Native POU/task structure | Blank ST/FBD/LD creation; populated ST copy/code edit/rename/delete; populated LD copy/rename/delete; task lifecycle passed with saved/native and collateral checks. Functions need their input signature before compiling |
| Native ST code editing | Public body replacement and clearing, exact comment read-back, stale-body refusal and fresh Build/Make passed on a disposable POU; printable ASCII input |
| Native ST POU creation, local variable edits, existing-task assignment | Live IDE, saved readback and reopen evidence |
| Global add/edit/remove with external consumer | Live compilation and removal/reopen persistence evidence |
| Build/Make and approved persistence verification | Fresh compile evidence, exact identity and retained source-hash comparisons |
| Graphical worksheet editing and libraries | LD lifecycle preservation passed; graphical body import/insertion/wiring remains unverified. Reference review is required; broader library lifecycle acceptance remains incomplete |
| All FB/FU interfaces, high-speed motion, production behavior and safety | Not universally validated; project-specific engineering and supervised commissioning required |

See [initial IDE smoke](docs/IDE_SMOKE_2026-10-01.md) and
[global lifecycle smoke](docs/LIVE_GLOBAL_SMOKE_2026-10-01.md) for warnings,
failures/recovery and actual coverage. These are dated evidence, not universal guarantees.

## Documentation map

- [Attach-first workflow](docs/OPEN_IDE_REMOTE_ENGINEER.md): continue an open backed-up workspace project.
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
Continue the backed-up workspace project without closing it for each coding request.
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
a backed-up workspace project. Capture actual computer-tool observations and compile
reports. Isolated regressions do not operate the IDE or prove live UI acceptance.
Historical offline write probes are not a supported smoke workflow.

Windows plugin for workspace-bound MotionWorks IEC discovery, staging, IDE-first
editing and verification. It never downloads to a controller or commands motion.

The selected `.mwt` and expanded directory must be inside the calling agent workspace.
The selected project stays at its original path inside the workspace; there is no hard-coded user
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

Discover → approve and verify backup → open the workspace project → engineering review →
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
