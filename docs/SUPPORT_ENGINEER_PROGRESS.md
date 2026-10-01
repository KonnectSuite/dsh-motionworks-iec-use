# MotionWorks support-engineer implementation status

This is work in progress. Version 0.5.5 did not establish complete IDE control.

## Proven follow-up patch for 0.5.5

- Trial detection selects only mwctVerify-owned Windows Forms dialogs containing
  an exact Use Trial button, and keeps that button paired with its own dialog.
  Regression cases cover unrelated Windows Forms windows, absent/hidden controls,
  a later buttonless verifier window, and multiple matching dialogs.
- Startup checks trial prompts even when a process or blocked IDE frame exists.
  It performs one UI Automation Invoke (or posted native button action if Invoke
  is unavailable before submission), then checks closure; no blind mutation retry.
- Live startup on 2026-10-01: already_running=false, trial_dialog=true,
  trial_answered=true, IDE version=1.19, ide_enabled=true, blocked=false,
  dialog_count=0. The disposable stage was opened; no controller action occurred.
- Installed Ade.tlb proves Variables.Create has seven inputs: Name, Type,
  BlockType, Description, InitialValue, IecAddress, Retain. The previous probes
  included incorrect argument shapes; these do not disprove the actual API.
- `test/native_api_probe.ps1` created and saved CodexApiLocal in the disposable
  TopCutterCutControl: count 149→150, INT, block type 1, initializer 7, empty
  address, description Native API probe. This is a native-call probe, not yet a
  public guarded addition tool or whole-worksheet collateral-change proof.
- OpenDocument's earlier failures used slash-style logical names or physical
  paths. The native API requires an internal document URN. `@POUS.Name.Sheet`
  and `@HW.Configuration.Resource.Global_Variables` now pass with an explicit
  SAFEARRAY(VARIANT)* in both PowerShell and Python. Public navigation resolves
  the exact saved tree name (including differently named bodies), verifies the
  active logical name, and checks unchanged modified state. Code views report
  `/Pous/Name`; variable views include the worksheet child.
- Public `mw_ide_variable_change` passed local add/edit/delete in the disposable
  stage: counts 150→151→151→150, complete saved and raw native declarations
  matched, with native flags preserved. Saved comment padding is normalized only
  for baseline alignment; exact raw native before/after checks remain intact.
- Full regression suite and package dry-run passed. Native global/external
  lifecycle additionally passed: globals 164→165→165→164, externals/local
  150→151→151→150, complete declaration/flag preservation throughout. Group
  moves remain refused.
- After the local lifecycle, fresh Build passed with an observed pending-to-
  compiled transition (6.9 seconds), modified=false. Make settled successfully
  as already up to date (2.2 seconds). No controller action occurred.
- After global/external lifecycle and navigation, fresh Build again passed with
  an observed compile transition (4.7 seconds), modified=false; Make settled
  already up to date (2.2 seconds).

## Required remaining capability evidence

Native structure follow-up: public POU PROGRAM create/rename/copy/delete passed
with counts 7→8→8→9→8→7. Blank ST FUNCTION_BLOCK and FUNCTION (INT return type)
create/delete passed. Function return types live in the PROJECT.TRE POU record;
LIST.POU's third column is blank. All unrelated program streams, declarations,
globals and tasks remained unchanged. Public task create/settings edit/assign/
unassign/delete passed with counts 5→6→6→6→6→5. Settings changed interval to
T#20ms and priority to 5, preserving watchdog and empty display fields. A distinct
instance name was assigned and removed by that exact name. Native cross-reference
Update/ExportToCsvFile also passed without source edits, producing a local CSV;
this export is variable-reference evidence, not proof of every indirect call.
After cleanup, fresh Build passed with an observed compile transition (4.8 s),
compiled=true and modified=false; Make settled already up to date (2.3 s). The
installed package exposes 53 definitions in a fresh module load and reads the
same native inventory (7 POUs, 5 tasks). The running Arya host still needs reload.
Structural plans are saved before mutation; full saved/native before/after
evidence remains available even when a native operation fails partway through.

POU rename/delete still requires reviewed graphical/indirect references: the ST
token scan does not cover three LD POUs in this fixture. The evidence lists those
POUs. Current live structure proofs use disposable, newly created unused POUs;
do not generalize them to arbitrary populated or protected POU conversions.

| Requirement | Evidence needed / current status |
|---|---|
| Startup and trial | Passed disposable launch; install reload still required |
| Named worksheet navigation | Native code/local/global navigation passed; exact saved-tree URNs and active views verified in two POUs |
| POU add/edit/delete | Public native blank ST create/rename/copy/delete passed with independent saved/native inventory and collateral checks; populated/graphical conversions remain unverified |
| Local/global/external variables | Public native add/edit/delete and full saved/native comparisons passed for all three scopes; group moves remain refused |
| Tasks and POU assignment | Public native create/settings edit/assign/exact-instance unassign/delete passed; controller-specific timing acceptance remains separate |
| POU code editing | Deterministic native editor route, full saved body comparison and compilation; incomplete |
| Toolbox and FB insertion | Installed interface/pin inspection, editor insertion/wiring, declaration and build verification; incomplete |
| Support-engineering judgment | Version-aware reference lookup, engineering diagnosis and tested operation workflows; existing guidance alone is insufficient |

Next implementation: deterministic code editing, populated POU workflows, and
toolbox/FB insertion. Do not mark the support-engineer objective complete from
startup, navigation, and declaration evidence alone.
