# Arya native engineering acceptance on the disposable fixture

## Fresh run after revised skill delivery

The same authorized chat completed a second lifecycle with `AryaFreshProbe` and
`AryaFreshInstance`, ending at sequence 892. No corrective message was sent during
this run. Native POU creation, three declarations, IEC TON insertion, populated
group rename, BG assignment, unassignment and deletion all returned accepted
mutation receipts. The initial read-only declaration check incorrectly expected
Delay in Support; Arya corrected its expectation to the actual Default group.

The first compiler verification was unverified because the Message Window was
hidden (report `1791187822490-bb5b9702-180a-4fff-a8ee-ed91e9bac397.json`). Arya
recovered its visibility using UI input without user help, then verified fresh
Build and Make while assigned and again after cleanup. Reports
`1791187969520-dd385385-8154-4209-b89d-fe196105dd3b.json` and
`1791188041428-ae6d8242-6711-4d14-846f-761085511191.json` both report
`ide_compile_verified_persistence_not_tested`. Errors were empty; fresh Build
reported the 25 existing warnings. Make subsequently cleared diagnostic rows.
An empty post-Make Warnings pane does not erase the preceding Build warnings.

After the chat ended, `test/arya_fixture_audit.mjs check` independently matched
every original POU, task, global declaration, program source and translation file
against the retained baseline: seven POUs, 164 globals, native structure equal,
compiled=true and modified=false. No controller behavior was tested.

This proves the bounded editing lifecycle with autonomous recovery, not the full
support-engineer goal. Arya explicitly omitted per-flag enumeration and had
truncated code-check output. Hidden-pane recovery still needs a direct plugin
path; broader graphical editing remains to be verified through Arya. The pending
fresh receipt harness is not yet an accepted gate: it currently expects direct
Build/Make calls instead of their retained `mw_ide_verify` substep evidence.

The user explicitly authorized creation of a dedicated Arya fixture chat and its
edit/build/read-back/cleanup test. Session
`d637dc30-4a0d-470d-8c45-f88c710d2be0`, displayed as
`MotionWorks IEC support probe …`, uses the existing
`motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266` workspace.
All 62 MotionWorks tools were exposed. The customer chat and projects were not
edited. The already open, proven stage was reused without restaging or reopening.

## Actual native editing and compiler evidence

Arya loaded the skill, confirmed the stage identity, and completed these native
operations without asking the user to perform an IDE edit:

- Create isolated ST PROGRAM `AryaSupportProbe` (result sequence 71).
- Create local group Probe and add Run/Ready BOOL and Elapsed TIME, with complete
  declaration verification (results 109, 115, 121, 127).
- Insert IEC TON instance Delay through `mw_ide_fb_insert`; both declaration and
  code phases were accepted (133). Exact saved code read-back (139) was:

```iecst
Delay(IN := Run, PT := T#50ms);
Ready := Delay.Q;
Elapsed := Delay.ET;
```

- Rename the populated Probe group to Support, preserving its three members and
  complete native flags/declarations (147). Delay remained in Default, which was
  the FB insertion tool's selected group. Arya initially expected Support for
  Delay, received a read-only mismatch, and corrected its expected inventory;
  it did not change the declaration to hide that mismatch.
- Assign exactly `AryaSupportInstance` to BG (165), then fresh Build (180):
  compiled=true. The Errors pane was empty (186). This assignment ensures the
  scratch PROGRAM was included in compilation.
- Open the exact scratch variables worksheet through native navigation (204),
  then inspect the active view and declarations. No grid/mouse editing occurred.
- Unassign exactly the scratch instance (218), delete exactly the scratch POU
  (224), and perform another fresh Build (230). Errors remained empty (238).

The fixture compiler also reported 25 warnings, including an existing empty
worksheet and unused/multiply used instances. Zero Errors does not mean zero
Warnings, and this test does not establish runtime timer or machine behavior.

## Independent preservation and limitations of the first run

`test/arya_fixture_audit.mjs` retained complete saved and native baselines before
the test. Its audit passed after cleanup, and its read-only check passed again
after the final follow-up. All original seven POUs, five tasks, 164 globals,
saved declarations, program streams, translations and native inventories match.
The IDE remains compiled and unmodified.

The initial Arya run did not completely satisfy the requested procedure:

- It guessed nonexistent `mw_ide_task_model` (171) and incorrectly described it
  as a missing tool referenced by the skill. The actual skill names the exposed
  `mw_code_task_model`.
- It omitted Make. It also tried `mw_code_validate` on the unstaged original;
  the workspace guard refused (320), without mutation.

A corrective verification-only follow-up was sent after the first turn ended.
`mw_ide_make` returned already up to date (353), correctly stating that no new
compilation occurred. `mw_code_task_model` succeeded (359), Errors remained
empty (361), and compile state was compiled=true, modified=false (363).
No edits or cleanup actions were repeated. The skill now explicitly names the
task-model tool and separate Build/Make calls, requires tracking requested
checks, and distinguishes routing mistakes from missing capabilities.

`test/arya_fixture_receipts.mjs` accepted all ten retained mutation receipts and
the completed follow-up, with `unassisted_request_complete:false` and the two
nonmutating tool errors retained. Do not describe this as a fully unassisted,
error-free acceptance run.

Local evidence is retained under the fixture's `.motionworks/verification/`:

- `arya-engineering-lifecycle.json`: complete before/after saved/native equality.
- `arya-engineering-receipts.json`: scoped acceptance, phase evidence hashes,
  corrective follow-up and preserved routing/refusal errors.
- `native-fb-342d6764-3a37-4961-85a7-58feb6cb759d.json`: exact FB/code phases.
- `native-group-93ff23e5-f62a-442b-8672-84a7079c2c5f.json`: populated group rename.

This proves the bounded assigned IEC TON ST lifecycle and local group rename in
the running Arya chat. Broader graphical engineering and a fresh autonomous run
with the revised guidance remain to be verified. No controller was contacted.
