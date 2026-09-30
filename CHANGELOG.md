# Changelog

## 0.4.1

- Promoted the Arya-installed 0.4 engine and 50-tool surface into this repository.
- Fixed opening staged `.mwt` wrappers with no embedded absolute path, while retaining
  workspace identity checks.
- Replaced `Get-FileHash` with .NET SHA-256 for the installed 32-bit PowerShell bridge.
- Enforced the observed seven-character MotionWorks task-name limit before COM creation.
- Excluded transient code-engine request/response JSON from preflight BOM checks and updated
  the knowledge-tool count regression to the 50-tool surface.
- Recorded the live capability results and unresolved task-assignment Build, Rebuild,
  arbitrary LD editing, and library-add limitations.

## 0.4.0

Everything here came out of the 2026-09-28 session on the TopCutter MP2600iec project, and each
item was hit for real rather than inferred. The companion document is
`Docs/PLUGIN_IMPROVEMENTS_20260928.md` in that workspace.

### Fixed — five tools could not report anything

`mw_code_types`, `mw_code_library` and `mw_code_manual` were written `render: (r) =>`, but the
harness calls `output.render(exec.arguments, value)`. The parameter named `r` therefore held the
ARGS, not the VALUE: `r.types`, `r.blocks` and `r.manuals` were all `undefined` and the first line
that touched one threw. They now read the second parameter, and return `ContentBlock[]` from
`text()` rather than a bare string.

`mw_code_tasks` is the same class of bug in its schema rather than its render: the engine returns
`next_step`, the schema declared `additionalProperties: false` without it, and the harness **rejects
the whole value** with `"value.next_step" is not a declared property` before render is ever called.
So the tool's promise to say what to do next did not merely drop the field — it failed every call.
The field is now declared and rendered. `mw_code_restore_pou` was failing the same way on `result`.

A new `test/render_contract.mjs` checks the contract for **every** tool in three phases, and it is
the reason these were findable at all: the existing suite calls `execute()` and asserts on the
returned value, so the half of the contract where the harness validates and renders was never
exercised. It caught a schema error in this release's own `mw_code_sync_back` too.

### Fixed — `mw_ide_errors` reported a failed build as a clean one

The tool returned "The 'Errors' pane is EMPTY - nothing to report." for a build that had actually
failed. The pane is read through MSAA and returns zero rows both when it is genuinely empty and
when the control cannot be read, so `count === 0` never meant "clean" — and the tool said it did,
precisely when a caller had turned to it because something was wrong.

It now reads the compile state on every call and qualifies an empty pane: empty with
`is_compiled=false` is reported as a **stall or a destroyed POU, not success**, naming
`mw_code_restore_pou` as the next step; empty with `is_compiled=true, is_modified=true` warns that
the edits are not compiled; empty with a clean verdict says so; and an unreadable verdict says
there is no evidence either way. A screenshot is captured automatically in the failing case,
because the pane is the only other view.

### Added — `mw_code_var_add_many`

Declaring the 20 variables for one port was 20 calls. This takes an array and applies each item
through the same planner and donor matching `mw_code_var_add` uses. It deliberately does **not**
fail whole: a refused item is reported with its index and reason and the rest still apply, because
the usual cause is one duplicate name and discarding nineteen correct declarations over it is not a
safe default. A missing `name` or `type` is caught here rather than surfacing from the donor matcher
as `'NoneType' object has no attribute 'casefold'`.

### Added — `mw_code_sync_back`

The release loop — close IDE, edit the stage, build, copy back, re-stage, verify — had a tool for
every step except the copy back, which had to be an external script that knew by convention what to
carry. This takes its destination from the source directory `mw_ide_stage` recorded, refuses unless
that recording proves the destination lies inside the workspace, and carries **source only**: an
inclusion list, not an exclusion list, so an unlisted new build artifact is simply not carried.
Measured on TopCutter: 8 files, where a blanket "everything that changed" copy selected 90 and led
with `__1stResourceEx.exe` and `.pdb` files. The `.mwt` wrapper is never carried — its stored path
is bound to the stage. Every file is verified by sha256 after the copy.

### Added — `mw_code_wrapper_binding` and `mw_code_rebind_wrapper`

`mw_ide_open` refuses a wrapper whose stored path is not the staged directory, and that refusal
appeared after a POU creation had renumbered the project. Re-staging to clear it is the wrong
remedy: it overwrites the stage and takes the new POU with it. Re-binding in place is the right one,
and it is idempotent — an already-bound wrapper reports `would_change: false` with an unchanged
digest — so a caller may call it without first working out whether it needs to.

### Added — `mw_code_eip_map`

"Is there room for another status value?" took several steps to answer: the `%QW` base, the
`I.Data[n] = %QW(base + 2n)` rule, a declaration scan, and the module's `PrimCxnInputSize` /
`PrimCxnOutputSize` attributes in the L5X. It is now one call. The assembly is treated as a
**window** from the lowest address in each direction — measured, a naive min/max over the project
reported a 64-word assembly spanning 39,955 words because two separate I/O areas were folded
together, and both numbers were arithmetically faithful and completely wrong.

### Changed — the plugin loads on every platform and stops on the others

`package.json` no longer declares `"os": ["win32"]`. That field is an install-time platform gate, and
a **required** dependency that does not match the host fails `pnpm install` outright rather than
being skipped — so shipping this plugin built into AryaAI would have broken the install on every
Linux and macOS lane to no benefit. `apply()` now returns early on a non-Windows host after logging
why, which is the shape this repository already uses for platform-specific payloads: the dependency
edge stays installable everywhere, and the plugin states its own limitation.

### Documented — `mw_ide_rebuild` does not work on IDE build 1.19

It fails with `Command 'adeCmdBuildRebuildProject' not found`; the command is not in that build's
command table. `mw_ide_build` works and is the one to use. The limitation is now in the tool's
description as well as here, so a caller does not spend a turn discovering it.

### Added — an unassigned-POU warning on the write path

A POU assigned to no task never runs, and a clean build does not prove otherwise: measured, a POU
containing an undeclared variable compiled cleanly while unassigned. `mw_code_write_st` and
`mw_code_pou_create` now attach an `unassigned_warning` when their target is in that set, which is
the last point before a build that stalls for ~90 seconds and ends with an empty Errors pane.

### Notes on process

`test/render_contract.mjs` is the durable outcome of this release. Every one of the five failures
was a violation of a contract the harness enforces and the test suite never checked, and a suite
that exercises only the half of a contract its author was thinking about cannot see the other half
however many tools it names. It needs a staged project for its live phase and reports an unmet need
as SKIPPED rather than PASSED, because a skip counted as a pass is how these shipped.
