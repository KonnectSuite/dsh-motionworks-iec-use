# Arya session autonomy audit — October 2, 2026

Reviewed the two supplied exports, session `7607cc98-15e9-4eb5-aa81-7b8dfcab56f4`
and session `cd027a6e-c2b6-49df-b393-5c60b6545d42`. The latter is also embedded in
the former ZIP; it was not counted twice. Logged instructions are evidence about
the earlier session, not authorization to modify its customer projects here.

## What worked

The exported catalogs and successful calls show the registration fix had landed.
Arya loaded the MotionWorks skill, discovered projects, inspected saved/native
state, added declarations through the native API, compiled and verified changes.
This day's problem was no longer a missing plugin catalog.

## Avoidable manual handoffs

- Main record 900: Arya described whole-body replacement of a 2,322-line POU as
  difficult to emit reliably and offered manual editor work as an alternative.
- Record 918: the only `mw_ide_code_change` attempt refused with
  `Saved code differs from expected_body or cannot be resolved`.
  Record 928 handed the five edits to the user. Refusal was correct; asking a
  language model to reproduce both complete bodies was the interface problem.
- Record 1451: native global/external additions succeeded, but Arya delegated one
  remaining ST assignment because she could not reliably write the body.
- Record 843 and its subsequent checkpoint: declaration responses carried large
  inventories; Arya explicitly reported roughly 75 KB per addition and context
  pressure. Full evidence is useful on disk, but not in every chat response.
- The unloaded skill summary still directed declaration work through grid input,
  despite the loaded skill and tool descriptions supporting native declarations.

## Implemented changes

`mw_ide_code_change` now accepts the saved `body_sha256` plus small exact changes.
The plugin reads the existing body independently, refuses stale hashes or wrong
match counts, assembles sequential replacements in memory, and uses the existing
single native import/save/full-verification path. Full-body replacement remains
available. No stale-body guard or collateral verification was weakened.

Code and declaration renders default to compact verification, save status and
evidence path. Complete values remain available with `detailed_result:true`.
Declaration results now retain their complete before/expected/after evidence in
the workspace verification directory. Skill summary and active workflow guide
prioritize native patch/declaration tools and tell the agent to complete supported
software edits instead of handing typing back to the user.

## Separate navigation finding

Record 819 requested `/Pous/TopCutterCutControl/TopCutterCutControlV`; the active
logical view reported the FastTsk instance path, while the visible caption showed
the requested variable worksheet. The settle check returned accepted=false.
Record 835 reports that the worksheet was visible afterwards. This is a possible
task-instance alias/readiness mismatch, not proof that relaxing identity/focus
checks is safe. Native declaration/code operations do not require that navigation.
Keep it as a separate fixture investigation; do not retry UI input blindly.

## Work that remains with the human

Physical sensor wiring, passing marks, observing physical cut placement and
controller downloads were legitimate handoffs for this plugin's scope. CLX/HMI
editing belongs to its corresponding engineering tools and authorization; the
MotionWorks plugin does not implement it. Reading screenshots is not proof of
hardware latch behavior, and an offline compile is not commissioning evidence.
This audit changes plugin capability and guidance, not either cutter's logic.

## Validation and next work

The full non-IDE suite passed. Added regressions cover a 2,322-line patch,
unchanged surrounding text, stale hashes, missing/ambiguous matches, explicit
repeated occurrences, sequential assembly and refusal before mutation. Compact
renders preserve failures and evidence paths; full render remains available.
The opt-in `test/registration_contract_host.mjs` calls the actual installed
host's `ToolRuntime.register()` guards rather than a copied validator.

The new patch success path still needs a disposable live-IDE import/Save/Build/Make
round trip. No MotionWorks process was running during this audit; no customer
project or controller was edited. Verify the new schema in Arya after plugin
reload before an Arya-led operation. Next investigate task-instance navigation
readiness and the earlier global VGR cleanup hash discrepancy separately.
