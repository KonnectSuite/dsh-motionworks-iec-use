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

| Requirement | Evidence needed / current status |
|---|---|
| Startup and trial | Passed disposable launch; install reload still required |
| Named worksheet navigation | Native code/local/global navigation passed; exact saved-tree URNs and active views verified in two POUs |
| POU add/edit/delete | Native lifecycle with independent saved inventory and reference checks; incomplete |
| Local/global/external variables | Public native add/edit/delete and full saved/native comparisons passed for all three scopes; group moves remain refused |
| Tasks and POU assignment | Existing tools need complete live lifecycle verification for required operations |
| POU code editing | Deterministic native editor route, full saved body comparison and compilation; incomplete |
| Toolbox and FB insertion | Installed interface/pin inspection, editor insertion/wiring, declaration and build verification; incomplete |
| Support-engineering judgment | Version-aware reference lookup, engineering diagnosis and tested operation workflows; existing guidance alone is insufficient |

Next implementation: native POU/task lifecycle, deterministic code editing, and
toolbox/FB insertion. Do not mark the support-engineer objective complete from
startup, navigation, and declaration evidence alone.
