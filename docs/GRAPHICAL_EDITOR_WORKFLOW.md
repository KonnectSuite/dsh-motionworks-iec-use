# Graphical FB and ladder editing

Use native tools for project identity, declarations, POU/task operations, Save,
Build and read-back. Use the desktop companion for the actual graphical canvas.
Serialize native workflows and UI input: native automation can bring the IDE
forward between a screenshot and a click. A submitted input is not acceptance.
Observe the settled result before the next action; if an immediate screenshot
still shows the earlier state, observe again instead of repeating the input.

Assigned two-block acceptance on October 3 used native ST insertion of IEC TON
and Yaskawa_Toolbox_v375 TON_Retentive followed by reviewed native FBD conversion.
The fresh listing resolved both timer instances and both Accum in-out directions
to the same local variable. The actual canvas displayed those connections.
The Retentive Preset operand was selected, Tab opened its inline edit box, Ctrl+A
selected only its text, `T#200ms` replaced the observed `TIME#100ms`, and Enter
committed the label. Immediate captures after Tab/Enter were stale; an additional
observation revealed the settled result, without repeating the key.

Fresh graphical listing and exact instruction comparison verified one change:
the constant feeding Retentive Preset became 200 ms. All other instructions,
including TON and both Accum directions, were identical after ignoring compiler
source coordinates. Saved declarations, native flags, task assignments and
unrelated streams/translations stayed unchanged. Make passed with zero errors.
Evidence: `toolbox-graph-299eeadd-536c-4b46-9905-20b3bd1c93d0.json`.
This verifies that observed path; it does not establish every graphical operation.

## Prepare and observe

For new supported FB logic, prepare an isolated ST POU and declarations through
native tools, insert the calls with `mw_ide_fb_insert`, and use reviewed native
`mw_ide_pou_convert` to generate FBD. Inspect the resulting canvas and full fresh
listing. This route passed with both TON and TON_Retentive, including in-out
bindings. It replaces that POU's original language/layout/comments and needs the
conversion tool's exact source hash and compile evidence. A POU outside intended
task execution can lack compiler artifacts; inspect the refusal rather than
assigning a task merely to obtain evidence. For changes within an existing graph,
use the observed canvas path below and preserve its other instructions.

Retain the full saved project baseline and inspect the exact installed block
interface with `mw_code_block_interface`. Prepare variables through
`mw_ide_variable_change`, including a correctly typed instance if needed. Native
`mw_ide_pou_change` can create a blank FBD or LD POU. Never assign a customer POU
to a task just to manufacture compiler evidence; test assignment is appropriate
only in an explicitly disposable project.

For an existing graphical POU, use `mw_ide_pou_change` for copy/rename/delete
and `mw_ide_pou_package` for guarded export/import. Copy or rename can retain
the original code and variable worksheet names. Resolve the saved worksheet
through `mw_ide_open_worksheet`; never construct a worksheet URN from the new
POU name. Preserve graph stream hashes, complete declarations/native flags,
task assignments and unrelated sources. Review graphical/indirect references
before rename/delete, and package dependencies before import. Require accepted
verification and fresh Build/Make after the intended changes.

Open the exact code worksheet through `mw_ide_open_worksheet`. Require accepted
navigation, then inspect the actual editor through the companion. Click inside
the observed work surface and confirm it remains the intended worksheet before
typing. Caption readiness alone does not establish keyboard focus. Stop on an
unexpected dialog, foreground app, worksheet or selection.

## Insert a block and connect its pins

The following path was observed on a disposable MotionWorks IEC 3 Pro FBD POU:

1. Click a free canvas position, then press **Tab**. Confirm the inline edit box
   appeared. Installed GraphEd001 help also documents F2; F2 did not establish
   insertion in this live probe, so do not assume it worked.
2. Enter the **block type**, such as `TON`, and confirm the text before Enter.
   Entering an instance name such as `ProbeTimer` instead inserted a variable
   operand. Do not mistake that operand for an FB call.
3. In the observed Variable Properties dialog, select or enter the intended
   instance. Confirm type, local/global scope, usage, group, address, initializer,
   description and flags before accepting. Reuse an existing compatible instance
   only after checking its declaration. Verify the resulting block name and all
   visible pin names/directions against the installed interface.
4. Select the actual pin connection point and confirm its selection. Press Tab,
   confirm the inline box, enter the declared variable or valid input constant,
   inspect the text, then Enter. Insertion at a selected pin established its
   connection automatically in this probe. Observe the connected operand and
   line before moving to another pin. Never infer a connection from proximity.
5. For an existing operand, select it, open the inline box with Tab, verify focus
   and select only its text before replacing it. Confirm the committed label and
   retained connection. Stale hover tooltips can show the previous value; inspect
   the actual settled label and saved/compiler evidence.

For free connections or other graphical objects, read the installed
`GraphEd001/GE_ConnectObjects.htm` and inspect the current geometry. It documents
dragging between provided connection points and connecting selected points.
Those alternate connection routes were not covered by this FBD probe. The
separate LD proof below covers basic contacts, a coil and a single-contact
parallel branch. Do not reuse example coordinates across layouts.

If a recent scratch insertion is wrong, inspect the actual Undo command and
its result. One observed Ctrl+Z removed the mistaken operand here. Do not use
Undo when the history or affected customer content is unknown.

## Save and verify

Close inline editors/dialogs only after inspecting their outcomes, then use
`mw_ide_save`. Compare the complete saved declarations, tasks, globals, unrelated
POU sources and translations against the retained baseline. Inspect native
declaration flags and groups after dialogs that could change them. The intended
graph should change; unrelated sources should match exactly.

Run a fresh `mw_ide_graphical_listing` and native Make. Require accepted fresh
Build evidence, matching artifact identities, a clean saved native state and
source preservation. Match the actual canvas connections to the generated
instructions. Compiler pin ordinals are not necessarily the order of pins in
the installed parameter table or on screen. The observed TON compiler
declarations numbered IN=1, PT=2, ET=3, Q=4, while the installed interface listed
IN, PT, Q, ET. Read the matching compiler block declaration before interpreting
an `@IFBP` ordinal. `mw_ide_graphical_listing` resolves public pin names and
directions from the exact matching FB compiler dependency, requires its type to
match the saved instance declaration and checks that Build regenerated it.
Inspect `dependency_artifacts` and `compiler_dependency_freshness_verified`.
Private compiler declarations and unknown ordinals remain unresolved.

The disposable probe placed TON, connected Run→IN, T#100ms→PT, Q→Ready and
ET→Elapsed, then edited PT to T#200ms. Both versions compiled as one network.
All four declarations and native flags were preserved. After explicit native
unassignment/deletion, the original seven-POU source baseline matched exactly
and Build/Make were clean. Evidence: `graphical-canvas-live.json` in the
disposable workspace verification directory. This is a bounded live proof,
not acceptance of arbitrary graphs, running Arya's catalog or controller behavior.

## Ladder contacts, coil and parallel path

Prepare the exact BOOL declarations through native APIs, retain their full
fields and flags, then navigate to the exact LD code worksheet. Inspect the
current Objects menu and installed `ld001` help. The following shortcuts were
both displayed in this IDE's menu and exercised in a disposable live probe:

| Observed shortcut | Context and result |
| --- | --- |
| F6 | At a free insertion mark, Contact Network inserted a contact, coil and power rails. |
| F7 | On the selected contact, Contact Right inserted and connected a serial contact. |
| Ctrl+F7 | On the selected contact, Contact Below inserted and connected a parallel contact below it. |
| Tab | On the selected contact/coil, opened the inline variable-name editor. |

Observe the inserted object before naming it. Default names such as C000 are
placeholders; they are not proof of a declared variable. In the inline box,
inspect focus and select its existing text with Ctrl+A before replacing it with
the exact declared BOOL name. Inspect the new text before Enter, then confirm
the committed label and retained connections. Do not type while the menu or a
different editor has focus.

Double-clicking the actual contact icon opened Contact / Coil Properties.
Entering an existing variable name loaded its declaration fields, including
its initializer. Check Name, BOOL type, usage, scope, group, initializer,
address, description and flags independently before accepting. Contact/Coil
and the lower Type list control the graphical object. Selecting the displayed
normally closed contact symbol changed the Stop contact without changing its
BOOL declaration. Inspect the actual symbol and connections after OK.

For a single parallel contact, select the intended contact and use the observed
Ctrl+F7 command; confirm the branch rejoins before the next serial object.
Selecting the wrong contact creates a different expression. Installed
`ld001/InsertingParallelLDBranches.htm` also documents multi-object branches
with Ctrl+T, but that separate path was not exercised here. Verify it before use.

The live canvas contained Run and Alternate in parallel, followed by normally
closed Stop and the Ready coil. Fresh Build/listing and Make were clean and
matched exactly: LD Run, OR Alternate, ANDN Stop, ST Ready. This represents
`Ready := (Run OR Alternate) AND NOT Stop` in the compiler evidence; no runtime
or controller behavior was tested. All four complete native declaration rows,
flags and collateral sources were preserved. Saving the populated scratch body
removed its empty body translation file; its variable translation and all
unrelated translations remained identical. Review target-body translation
changes explicitly, rather than ignoring translation collateral broadly.

Evidence and explicit native cleanup are retained in `ld-canvas-live.json` in
the disposable verification directory. This proves the described basic ladder
workflow, not arbitrary LD graphs or active Arya execution. Keep native
workflows and companion input serialized throughout, and observe again after
native calls before relying on keyboard focus or screen geometry.
