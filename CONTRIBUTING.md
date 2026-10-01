# Contributing

This is an interoperability tool for an industrial IDE. Preserve user work and
distinguish observed evidence from assumptions. Read [README](README.md),
[SKILL.md](SKILL.md), [IDE-first workflow](docs/IDE_FIRST_WORKFLOW.md) and
[engineering guidance](docs/ENGINEERING_WORKFLOW.md) before changing behavior.

## Current architecture

The plugin supplies workspace identity, stages, read-only native inspection,
engineering references, supported IDE object-model operations and verification.
A separately connected computer-use MCP performs source/declaration/graphical edits
inside the IDE. Native import through an observed IDE dialog is also an IDE operation.

Historical offline CFB writers remain private regression fixtures, not a supported
public editing route. Do not re-expose them or recommend them after a UI failure.
Automation body access, command execution and import/export providers were not
proven usable for general source editing on the tested installation. New API
discoveries need an isolated reproduction and explicit version boundaries.

## Invariants

1. Never add controller downloads, Run/Reset, forces, jogs or motion commands.
2. Mutations/builds operate only on the proven workspace stage. Outside references
   stay read-only. Verify the active full project path before acting.
3. Preserve unsaved IDE work. Obtain approval tied to the exact project before
   closing/replacing it; GUI deletion needs scoped confirmation.
4. Use native editors. No unknown graphical binary edits, blind clicks, lock
   deletion, force-killing the IDE or silent source promotion.
5. Save All and compare complete readback. Task assignments and installed FB
   interfaces must be checked separately from compiler success.
6. Never report success without evidence. Cached flags/no-op Make and empty panes
   are not fresh-build proof. Reopen repeats compilation/source checks. Retain failures.
7. Follow tool-specific dry-run/approval defaults for permitted infrastructure.
   GUI actions do not have automatic transaction rollback.

## Setup

Use Windows, MotionWorks IEC 3 Pro, Node >=20, Python 3 and AryaAI DSH/Cordis.
See README for interpreter selection and plugin-manager installation. Restart the
host after updates; do not manually junction its dependencies. The desktop-control
companion is separate and needed for live editor tests, not isolated regressions.

## Tests and review

From the repository root:

```powershell
npm run preflight
npm test
node test/guidance_contract.mjs
node test/verification_flow.mjs
npm pack --dry-run
```

`npm test` is the maintained isolated suite and does not start the IDE or controller.
Older scripts in `test/` include historical probes that may mutate project files or
operate a live IDE. Do not run them indiscriminately or use retired writer probes
as current acceptance. Consult the suite and IDE-first smoke documentation instead.

On sandbox permission failure, identify denied fixture/subprocess access and request
appropriate test-only access. Do not weaken workspace guards to pass tests.

For live acceptance use a disposable stage, disconnected/non-motion workflow and
observed desktop companion. Capture baseline diagnostics, perform a scoped operation,
Save All/read back, fresh Build/Make, and—with exact-project consent—close/reopen
and repeat verification. Record warnings, failures and recovery. Test UI operations
separately; ST success does not prove LD/library support. Never label planned or
mocked checks as live tests.

In a PR state tests actually run, those not run, tested versions and affected contracts.
Update documentation with behavior changes and SKILL.md when its agent contract changes.
Keep active instructions consistent; label historical evidence explicitly.

## Source and packaging

The engine in `code/engine/motionworks_iec_mcp/` is vendored. Record provenance and
coordinate upstream changes rather than silently diverging. Never add customer
projects/backups, controller data, tokens or proprietary vendor PDFs. Link official
references and state revision limits. The repository declares MIT licensing in LICENSE;
maintainers must establish rights/attribution for contributed and vendored material.
This review does not certify third-party redistribution rights.

Type-library observations in `docs/tlb_dump.txt` and `docs/tlb_enums.txt` describe
the tested interfaces, not every IDE release. Regeneration helpers require matching
installed type libraries and 32-bit Python/pywin32—not normal plugin-user requirements.

Use Node built-ins for the host plugin and plain JSON Schema (`required` is an array).
Check schema/render contracts after tool changes; preserve measured limitations.

## Bugs and security

Use GitHub Issues for ordinary bugs with sanitized reproduction, version/commit,
exact request/result and verifier phase. Logs/reports can contain paths/project data;
review before sharing and never upload customer projects.

For security issues use GitHub private vulnerability reporting if enabled, or request
a private contact without disclosing exploit details publicly. Never publish tokens
or unsafe desktop-control endpoints. Desktop control must remain local/supervised;
optional HTTP transport needs authentication and loopback binding. This project is
not affiliated with Yaskawa and does not certify machine safety.
