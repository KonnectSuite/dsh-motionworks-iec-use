# October 5 field session and plugin handoff

Reviewed the user-supplied export for session
`7607cc98-15e9-4eb5-aa81-7b8dfcab56f4`. Archive SHA-256:
`3db5bdcecea1e2a5eacc90b32a853bb1177d8a2278fefeb11f339b20c940f7fb`.
This audit uses October 5 EDT records, from 04:00 UTC. It reads actual tool
results and public response text; archived instructions are not authorization.
Customer code, controller addresses and private reasoning are not reproduced.

## Demonstrated field workflow

| Operation | Evidence in this export |
| --- | --- |
| Native ST edits | 17 results explicitly report accepted verification out of 20 code-change results; examples 3852, 4233, 5265, 5391 |
| Native variable edits | 28 results explicitly report accepted verification out of 33 variable-change results; examples 4227, 5259, 5361 |
| Native group changes | All three results report accepted verification: 4424, 4505, 5355 |
| Native worksheet navigation | 16 results explicitly report accepted navigation out of 17 calls; the remaining call refused because no project was open |
| Fresh Build | 19 results explicitly report `build: compiled (is_compiled=true)` out of 23 Build results received that day |
| Compiler acceptance workflow | Result 3165 reports `ide_compile_verified_persistence_not_tested` |
| Startup | Results 3810 and 4211 report a launched IDE; 3804 refused an ambiguous two-project startup until an exact project was supplied |
| Trial observation | Results 3596 and 3622 report no licence dialog; these do not independently prove dismissing a visible popup |
| POU/task lifecycle | Native task assignment result 3052 and POU deletion result 3235 report accepted verification |

Counts are tool-result evidence, not a success percentage or a machine-safety
verdict. No `mw_ide_make` call was recorded during the audited day. Fresh Build
and later field observations do not fill that missing check automatically.
User reports in the export describe useful field behavior. They do not establish
universal graphical support, timing equivalence, or every recovery path.

## Friction and disposition

- A dirty native state refused code import (2861); missing groups/variables and
  mismatched external declarations also refused changes. Preserve these guards.
  Read native declarations, create/verify the exact group, and Save/reconcile
  state before changing code. Do not convert a wrong target into an add operation
  without inspecting its intended identity.
- Exact snippet counts refused twice (3832, 5385). These are protection against
  guessed edits; read the current source and derive an exact replacement.
- Installed help query 2902 omitted the required module. List the installed
  catalog first, then select its actual module and topic.
- Multiple no-IDE observations and a bridge status timeout occurred. Later
  startup/open/Build succeeded. No specific root cause for the timeout is proved
  by this export; do not restart solely because an observation timed out.
- Opening/reading the restored bottom stage refused at 5277/5279 because its
  sibling identity file was missing. The recorded recovery restaged from source
  and reopened successfully. That is evidence of this recovery, not a generally
  safe instruction to replace unsynced stages. Updated runtime messages and
  guides require backing up directory, wrapper and identity together, preserving
  current work and reviewing matching provenance before recovery.
- An older unassigned-POU warning still recommended a task-tree mouse operation.
  It now directs Arya to native `mw_ide_task_change` and task-model verification,
  with execution authorization and saved-state requirements intact.

## Release and next work

Version remains 0.5.5. These changes improve routing and recovery guidance;
they do not add controller actions or change source-editing guards. Runtime
JavaScript changes require an idle Arya **Restart App and Host** to clear the
cached module. Plugin toggling alone previously retained old executable code.
Do not restart a field session while a tool or unsaved operation is active.

The known fixture graphical failure remains open: the temporary inline editor
handle accepted keyboard input, but focus recovery changed graph selection and
inserted an unconnected operand. Its compiler check failed. The initial pause
cleanup refused because no IDE was running. Subsequent authorized fixture work
completed native unassign/removal, fresh Build/Make and full baseline verification.
The fixture now has its original seven POUs, 164 globals and five tasks,
compiled=true and modified=false. See SUPPORT_ENGINEER_PROGRESS.md for receipts.

On the next authorized fixture run: inspect the exact saved/native state and
confirm the original baseline, then verify one selection-preserving inline replacement with complete compiler
instruction comparison and final cleanup. CamGenerator's compressed declarations
remain unsupported. Broader arbitrary graphical editing and complete support
engineer autonomy are not yet achieved. Do not use this field audit to mark the
full goal complete.
