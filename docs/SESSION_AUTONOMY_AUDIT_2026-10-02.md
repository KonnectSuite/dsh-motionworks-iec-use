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

`mw_ide_code_change` now accepts the readable `text_body_sha256` from
`mw_code_pous` as `expected_body_sha256`, plus small exact changes.
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

## Live follow-up

The disposable live-IDE round trip passed in
`native-patch-live-41bb526a-682c-4df1-bf40-e642077b6e31.json`, under the fixture's
`.motionworks/verification`. Final verdict: accepted=true, phase=cleaned.

- Native startup dismissed the real trial prompt: trial_dialog=true,
  trial_answered=true. No mouse or keyboard automation was used.
- Created CodexPatchProbe, imported a 2,322-line commented ST body, applied two
  exact snippets and verified the complete readable result. Build and Make passed.
- Stale readable hash and missing snippet attempts refused before mutation.
- Cleared and deleted the scratch POU. Final fresh Build/Make passed with
  is_modified=false. POUs, tasks, globals, program streams and comment translation
  hashes matched the original baseline exactly.

The first attempt exposed a real hash contract defect: existing `body_sha256`
hashes native comment references, while the patch reader restores comments from
Translation.xml. It correctly refused before mutation. Added `text_body_sha256`
for the readable ST/IL body, keeping the old raw hash unchanged for conversions.
Python regressions prove comment-only changes invalidate the readable hash even
when the raw native hash stays unchanged, for both ST and IL. Missing translations
report an error and do not produce a usable readable hash.

The retained test continued only after confirming the scratch body and every
saved inventory/source against its completed native import receipt; no create or
import was repeated. A later cleanup Build returned is_modified=true and stopped
the test. Subsequent inspection found is_modified=false with original saved/native
inventories restored. Final fresh Build/Make and complete source comparison passed;
no extra save was needed. Both stops remain recorded as evidence.

No customer project or controller was edited. Verify the updated schema in Arya
after plugin reload before an Arya-led operation. Next investigate task-instance
navigation readiness and the earlier global VGR cleanup discrepancy separately.
