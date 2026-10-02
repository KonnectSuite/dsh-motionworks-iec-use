# Native ST and IL code editing

Use `mw_code_read_text` to read the exact supported ST/IL body and declarations.
`mw_code_read_st` remains scoped to ST for compatibility. Check the returned
language and `body_error`; unresolved comment translations must stop editing.
Retain the exact readable body, including comments, as `expected_body`.

Reconcile and save existing IDE edits. Use `mw_ide_pou_change` to create an
explicitly requested blank ST or IL POU; ST remains the default language. The
native IL body is an `.AB` text stream with a matching saved IL worksheet node.
Do not treat its absence from an older reader as an empty body. Copy/rename
retains the actual source language, declarations and body. Reference review and
deletion approval remain required for rename/delete.

Prepare declarations with `mw_ide_variable_change` rather than typing a variable
table. Read the installed programming help and exact block interface before
writing unfamiliar instructions or FB calls. ST FB insertion through
`mw_ide_fb_insert` remains ST-only; do not reuse its emitted ST call syntax as IL.

Replace the full text through `mw_ide_code_change` with the exact project, POU,
`baseline_saved:true`, retained `expected_body` and reviewed `code`. The tool
matches saved/native ST or IL language, imports once through native ChangeCodeWS
with that language, saves, and verifies the complete readable body/comments,
declarations/groups/flags, tasks, globals and unrelated source streams and
translations. An empty code string clears the body while preserving its
declarations. Printable ASCII plus tab/newline is the supported input encoding.
The tool normalizes line endings and appends a final newline to nonempty input.

Require `verification.accepted:true`. On failure, inspect the retained plan and
actual native/saved state before another action. A partial import is not safe to
retry automatically. Stale `expected_body` is refused before mutation. Never
remove comments or weaken collateral checks to make verification pass.

Run fresh Build and Make and inspect diagnostics. Check source preservation
across compilation. Successful import/read-back does not establish syntax or
execution; an unassigned PROGRAM does not execute. Test-only task assignment is
appropriate in the explicitly disposable fixture, not as an automatic way to
generate evidence in a customer project.

Native code import requires no editor focus or desktop input. Use
`mw_ide_open_worksheet` only when viewing the result helps, then inspect actual
editable focus before any fallback typing. Serialize native operations and
desktop input. Use the current installed TextEd001/il001/ST001 help for editor
commands and language semantics instead of assuming shortcuts or syntax.

Bridge protocol 4 includes the explicit ST/IL import language. A stale bridge is
refused; reload the updated plugin and restart its stale bridge rather than
accepting an older import handler. The installed module's catalog and a running
Arya chat's loaded catalog are separate verification results.
