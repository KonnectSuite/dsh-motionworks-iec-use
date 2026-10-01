# Variable worksheet safety: local, global and external

Read this before editing any variable worksheet. These are native IDE edits, not
offline writes. The desktop-control server is separate and cannot enforce this
plugin's workspace or cell semantics.

## Before input

Verify the exact open stage and worksheet. Retain the **complete saved baseline**
using `mw_code_read_st` for a POU or `mw_code_globals` for the resource. Reconcile
unsaved changes with the user first. Plan the complete final declarations by applying
only the requested additions/edits/removals to that baseline. Keep an unmodified
baseline for recovery; a later read of damaged data is not a baseline.

A worksheet has three different targets:

- Column headings such as **Name**, **Type**, **Usage**: never variable data.
- A bold group row such as **Default**, with an expand/collapse icon: editing its
  text renames the group. It does NOT add a variable.
- A variable data row: separate name, type, usage, address, initializer and description.

Typing `INT` into a selected Name cell renames that variable; it does not set its
type. Typing a tag into the group row renames the group. Both can be saved while
the intended new declaration is still absent.

## Add a declaration

### Preferred: native Create Variable Set dialog

1. Save/reconcile the worksheet before planning. Call `mw_ide_active_view` to
   establish its exact logical identity, then `mw_ide_variable_plan` with the
   explicit stage, scope, `baseline_saved:true` and all seven declaration fields.
   Wait for the returned token BEFORE opening a modal dialog: native COM status
   calls can block while the dialog is open. A failed plan is not permission to
   proceed. The plan retains the complete saved baseline, not just the new row.
2. Select an existing **data row** in the intended group without editing it.
   Invoke the observed Edit > Create Variable Set command. This is a separate,
   labelled native dialog; do not type into the grid or group-name editor.
3. For one addition, use the exact identifier with no `#` numbering placeholder.
   Inspect Name/Preview, I/O address/Preview, Usage, Data type, Initial value,
   Description and checkboxes. The dialog can inherit previous values, including
   a physical address, initializer and description. Clear every inherited field
   not present in the plan; never assume blank defaults or click OK prematurely.
4. Set one labelled field at a time, verify focus/selection before input and
   refresh afterward. Do not use blind Tab chains. Clear the address, initializer
   and description BEFORE selecting `VAR_EXTERNAL`: changing usage disables the
   address/initializer controls without clearing inherited values. Select a usage
   from the observed list and inspect its committed value. Externals require the exact
   global name/type, `VAR_EXTERNAL`, and no address or initializer. Locals use
   `VAR`, globals `VAR_GLOBAL`. Preserve unchecked Retain/PDD/OPC unless requested.
5. Verify every final field and a single-name preview before clicking OK. Inspect
   the resulting row, Save through the IDE, then call `mw_ide_variable_verify`
   with the retained token. Require `accepted:true` before building. This checks
   the entire saved worksheet for collateral changes, not merely row presence.

These three tools observe, plan and verify; they do NOT navigate, input, insert,
Save or repair variables. Generic computer input remains separately supervised.
The retained plan expires after 30 minutes and is lost on plugin restart. Do not
recreate a baseline from damaged data. Global worksheet logical names were observed
as `/Hardware/Configuration/Resource/Global_Variables` on this installed version;
other versions must be verified, not silently accepted by guessing.

### Fallback: inline insertion (not the preferred path)

Use only if the installed version lacks the observed creation dialog and a fresh
disposable test proves its inline input route. Historical inline failures changed
groups and existing names; do not treat a successful input acknowledgment as proof.

1. Invoke the installed IDE's observed **Insert Variable** command/menu. Do not
   guess a shortcut, click the group row and start typing, or reuse an existing row.
2. Refresh and prove a new **data row** appeared: a native placeholder/blank row
   with its own Type and Usage cells, not a group-name editor. The expected final
   count increases by exactly one for a single addition. If there is no evidence
   of insertion, stop before any text input.
3. Open its Name cell for editing. Verify which text is selected and where the
   caret is. Double-click does not guarantee selection; Ctrl+A may select the
   whole worksheet even when an inline edit control is exposed. If focus/selection
   is ambiguous, use a visible native field/dialog or ask for operator assistance.
4. Enter the name, commit, refresh and verify the **full** name (not a clipped prefix
   or `NewVar1` plus appended text). Then independently open Type, verify its field,
   enter/select the type, commit and inspect. Repeat for Usage and other metadata.
   Never send a blind Tab chain or multiline/tab-delimited paste into the grid.
5. For an external, match the global's exact name/type and use `VAR_EXTERNAL`.
   Do not copy the global's physical address into the consuming POU declaration.
6. Save via the IDE and run `mw_code_verify_variables` with the complete planned
   final declarations. Require `accepted:true`; then compile the assigned consumer.

The checklist cannot guarantee a particular menu/dialog on an untested IDE version.
Discover it from current UI/help, and do not claim an unobserved command was used.

## Edit or remove

Identify the existing name and intended column before input. Edit only that field,
commit and verify it. Inspect references before rename/removal and obtain required
deletion approval. Preserve every unrelated declaration and group. Verify the complete
planned final list after Save, not only the changed row. Globals and each consuming
POU require separate verification; a clean build alone cannot prove an intended name.

## Input failure / recovery

Window activation can close an inline editor before a tool sends keys. A successful
input result only means submission, not application acceptance. Observe after every
action. If Ctrl+A selects rows, typing lands in another field, focus changes, or the
expected edit is absent, stop. Do not send Delete, repeated Undo, or the remaining
field values into an unknown selection. Re-observe before any retry.

Use the retained baseline to identify exact damage. Repair only proven renamed
groups/fields through the native IDE. Verify unchanged fields as well. Do not
restore an entire old project over current unsaved work or edit native streams
behind the open IDE. If input cannot be verified, request the precise operator
repair and read it back; do not call that an automated successful smoke test.

## Saved declaration verifier

`mw_code_verify_variables` is a read-only comparison, **not an input interlock**.
Pass `project`, optional `pou` (omit for globals), and `expected_variables` containing
the entire planned final worksheet. Each entry has `name`, `type`, `section`, `group`,
`address`, `initial_value`, `description`; use explicit `null` for absent metadata.
Copy baseline entries intact and append/modify/remove only authorized entries.

It reports missing/unexpected names and changed fields, including groups, and fails
duplicate names (IEC case-insensitive). Row order is irrelevant. A false verdict means
stop and repair; the tool does not repair, Save, build, read unsaved cells, or commission
hardware. Empty groups and graphical layout are outside its semantic coverage and
still need visual inspection. A true verdict establishes only saved declaration
agreement with the caller's plan; an incorrect plan can still pass.
