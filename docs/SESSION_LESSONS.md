# Native MotionWorks editing: lessons incorporated into 0.5

## Evidence, not repeated guesses

This workflow comes from native editing and commissioning failures recorded in the
provided session. These are reproducible workflow lessons, not instructions to apply
the machine-specific cam or timer patches to other projects.

| Failure | Tool/workflow response |
|---|---|
| A declaration appears but LD says variable not found | Inspect paired VB/VGR, native usage, handles and rows; compile the assigned POU. |
| File error or MSILv2ResManager internal error | Preserve diagnostic and journal; validate native stores. Close before restoring. |
| Editing src.st1 as Latin1 text destroys the container | Edit individual CFB streams through native writers, preserving untouched siblings. |
| IDE overwrites an offline change from its cache | Refuse writes while Mwt runs; save/close only the explicitly approved project. |
| Workspace copied to a new folder | Read-only readiness reports stale identity. Never restage over unsynced edits. |
| Wrapper has no absolute path | Native sibling-directory mode is valid with provenance; verify the active IDE path. |
| Clean build of an unassigned POU | Check task instances and program types; build acceptance does not establish execution. |
| Cached IsCompiled flag | Require observed compile transition for fresh Build; no-op Make is labeled separately. |
| Empty error pane | Keep compile evidence and diagnostics together; empty text is not success. |
| Notes say filtering removed, source still has timers | Read native ST and timer presets; reconcile notes rather than trusting recency alone. |
| Proposed TON cooldown uses NOT Q then resets in idle | Review cyclic semantics; it is not a proven lockout. No blind machine patches. |
| Batch fails halfway through | One full-project transaction rolls back the complete batch unless partial behavior was explicitly requested. |
| Compiled DLL contains expected constants | Not proof the current source was compiled or that the controller received it. |

## Agent UX

Discover the calling workspace, select a project explicitly, stage once, then inspect.
For a pre-existing stage use `mw_workflow_check` before attempting a mutation. Its
read-only stale-identity inspection does not expand writer permissions. If the stage
was relocated, preserve both stage and source before choosing any recovery plan.

Preview native operations, then commit using the same supported writer. Read failures
and journals. Unsupported native layouts remain refusals: never use a raw binary regex
replacement to bypass the format parser. Donors must match type, usage AND addressed
versus unaddressed layout; a system BOOL with a segmented memory address is not an
unaddressed global BOOL donor.

Open the exact staged wrapper and call `mw_ide_verify`. It returns one of:

- `unverified`: inspect evidence and stop the acceptance claim.
- `ide_compile_verified_persistence_not_tested`: fresh Build and Make observed, saved;
  no reopen comparison was requested.
- `ide_acceptance_and_persistence_verified`: fresh Build, Make, save/close/reopen and
  identical native source streams observed on the explicitly consented project.
  Only PRMVIEWALL.DAT/PRMVIEWHARD.DAT navigation-view normalization is permitted;
  those hashes remain in the evidence and `normalized_view_metadata` is reported.

Every report states that controller download and machine behavior were not tested.
Live testing showed Build/Save updates native PROJECT.TRE compiler bookkeeping.
The verifier retains those differences, verifies VB/VGR/STB/GB/TXT program streams
against the pre-build snapshot, then compares all native streams from the saved
baseline to the reopened project. It does not discard the tree from persistence checks.
The live LD-clone test showed the IDE updates the two navigation-view streams on
reopen. The reopened clone and SlowTsk assignment were still present. Persistence
keeps strict hashes for PROJECT.TRE, program/declaration streams, descriptions and
registry metadata while separately recording those two measured UI-only streams.
Reports are JSON inside workspace `.motionworks/verification`. Read the evidence
before promoting source with `mw_code_sync_back`; promotion is not a download.

## Acceptance test

`test/live_acceptance.mjs` requires an explicit source wrapper, existing writable
parent and disposable-close consent. It copies the supplied fixture into a unique
workspace, hashes the original, and uses the public registered tools with real session
context. It tests preview immutability, local/global/external variables, descriptions,
batch declarations, ST round-trip, compiler acceptance, persistence, deletion and a
POU clone/assignment lifecycle. Failures stop the run and retain evidence, not hide
behind a blanket PASS. There is no force-kill, original-source promotion or controller
connection. The final report verifies whether the original source and wrapper changed.

Run `npm test` and `npm run test:contract` separately for isolated regression and
render/schema checks. Those tests alone are not IDE acceptance. Offline LD donor
cloning can preserve a graphical layout; arbitrary graphical rung synthesis and
generic offline library insertion remain unsupported and must not be advertised.

The current production-derived fixture has historical eight-GUID NodeProperties
records on several ST POUs. They are refused as clone donors. Its four-GUID
ServoHoming donor is LD, so the acceptance test preserves its graphical body.
This distinction is deliberate: successful ST body editing does not authorize
converting a graphical POU by replacing binary bytes with text. Preview clones
early; the refusal includes compatible-layout candidates without claiming they
are fully validated templates.

Keep one harness/IDE owner during native acceptance. The current bridge uses one
request/response channel; its in-process queue is not proof of cross-process
serialization. Concurrent independent harness instances against the same plugin
bridge are not covered by this test. Do not run parallel IDE mutation workflows.
The source-edit transaction lock protects a project, not an entire shared IDE.
