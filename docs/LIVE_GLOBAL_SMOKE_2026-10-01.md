# Live global-variable smoke test — 2026-10-01

Status: live global add/edit/remove and close/reopen persistence verified.
This is partial live coverage, not a full-plugin PASS or controller test.

## Target and safety

The already-open disposable project was:
`motionworks-ide-smoke-72cd6e2a-0ecc-48e2-a65f-5e3ac6f942d1/.motionworks/stage/TopCutterS5.mwt`
under `C:/Users/Admin/Desktop/Codex Workspace`.
The plugin verified that exact staged identity using the child workspace context.
No production source was promoted; no download, Run, reset, force or motion command was issued.

## Actual IDE actions

1. Opened the resource Global_Variables worksheet.
2. Inserted `CodexGlobalSmoke`, an unaddressed, non-retained VAR_GLOBAL.
3. Set type INT, initializer 42, description
   `Disposable global lifecycle smoke test; no motion IO.`
4. Saved and read the declaration with `mw_code_globals`; all fields matched.
5. Added matching INT VAR_EXTERNAL in the existing disposable `CodexIdeSmoke` POU.
6. Appended `NewVar1iSmokeValue := CodexGlobalSmoke;` to its ST worksheet.
7. Used native Save All and then the guarded API Save to establish clean state.
8. Ran `mw_ide_verify`: fresh observed Build, settled Make, saved readback and unchanged
   program/declaration digests passed. Reopen was not requested yet.
9. Edited the existing global initializer from 42 to 73 in the IDE, committed it,
   saved it, and confirmed initializer 73 in saved native declaration readback.
10. Repeated acceptance; fresh Build/Make and program integrity again passed.
11. After explicit deletion approval, selected only `CodexGlobalSmoke` by its row
    gutter in Global_Variables and removed it with native Delete Variable
    (`Ctrl+Shift+D`). Removed the matching VAR_EXTERNAL row the same way.
12. Selected only the appended ST assignment and deleted it. The original comment
    and two assignments remained. Used native Save All followed by API Save;
    saved readback confirmed no test global, external or consumer assignment.
13. Fresh Build and settled Make passed. Approved close succeeded, but startup
    refused wrapper metadata naming the earlier sheet-detector import folder.
    Kept the refusal report; did not re-stage or delete locks. Used the existing
    wrapper inspection and dry-run rebind tools, then re-bound only the disposable
    wrapper to its exact staged directory and reopened it through the native API.
14. Repeated the complete verifier: fresh Build, Make, Save, approved close,
    API startup/trial handling, exact staged reopen, source-persistence comparison,
    and fresh Build/Make/Save after reopening all passed.
15. Post-reopen readback confirmed the global absent, only the original two POU
    declarations present, and both original executable ST assignments preserved.

## Evidence retained in the disposable workspace

- `.motionworks/verification/1790838644331-3c92a346-cf88-432a-88b0-1f66c3062a33.json`:
  expected preflight refusal while modified state was still true; no false PASS.
- `.motionworks/verification/1790838668657-f0470ffa-f85c-4888-8ef0-238146e4cc64.json`:
  initial global/external consumer accepted; `ide_compile_verified_persistence_not_tested`.
- `.motionworks/verification/1790838882904-748f12ea-7489-4cf4-b374-65bccdb102b7.json`:
  edited initializer accepted with the same verdict.
- `.motionworks/verification/1790839899179-1d40401b-e532-46c9-8332-f8a407e8c5b1.json`:
  removal compiled; reopen stopped at the wrapper-binding guard, verdict `unverified`.
- `.motionworks/verification/1790840062101-dd71bc01-feb0-4e03-b638-f1f4a3083cb8.json`:
  complete removal/reopen acceptance, `ide_acceptance_and_persistence_verified`.
  Native/source streams matched exactly across reopen; program streams were
  unchanged by compilation. Trial dialog was reported answered successfully.

Build diagnostics retained 21 warning entries in the first accepted run, including
empty worksheet, repeated CalcSplineMatrix instances and unused historical declarations.
This was NOT a zero-warning rebuild. Diagnostic `count` measures returned text rows,
not compiler error count: the API's requested Errors pane can contain informational
build lines. Acceptance uses fresh compiled/settled flags, not that text count.

## Findings incorporated into guidance

- Codex window capture timed out twice. The existing KonnectSuite computer MCP
  succeeded after launching its loopback-authenticated HTTP companion with desktop
  access outside the filesystem sandbox. No blind input was sent on capture failure.
- The companion's input acknowledgement can precede visible completion. A second,
  settled screenshot showed the completed ST line after the first showed partial text.
- Cell highlighting and Ctrl+A do not reliably select cell text. The first external
  name entry appended to NewVar1; it was detected and corrected in the IDE.
- Home then Shift+End in a confirmed single-line cell selected the full editable text.
  Correct committed name/type/usage were checked before compilation.
- Save All cleared the worksheet marker but API modified state still required Save;
  the verifier correctly refused rather than certifying unsaved state.
- Removed a retired `mw_code_var_add` recommendation from the globals tool and corrected
  conflicting offline-writer recommendations in SESSION_LESSONS and companion guidance.

## Coverage boundary

The approved deletion removed only the disposable global, its external declaration
and appended consumer line. These items can be recreated from the names, types,
initializer and ST recorded above. The existing disposable POU remains intact.
Full live POU, task, graphical and library lifecycle coverage is not established by
this global-variable test alone.
