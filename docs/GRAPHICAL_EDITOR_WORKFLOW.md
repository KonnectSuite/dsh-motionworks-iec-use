# Graphical FB placement, connection and editing

Use native tools for project identity, declarations, POU/task operations, Save,
Build and read-back. Use the desktop companion for the actual graphical canvas.
Serialize native workflows and UI input: native automation can bring the IDE
forward between a screenshot and a click. A submitted input is not acceptance.
Observe the settled result before the next action; if an immediate screenshot
still shows the earlier state, observe again instead of repeating the input.

## Prepare and observe

Retain the full saved project baseline and inspect the exact installed block
interface with `mw_code_block_interface`. Prepare variables through
`mw_ide_variable_change`, including a correctly typed instance if needed. Native
`mw_ide_pou_change` can create a blank FBD or LD POU. Never assign a customer POU
to a task just to manufacture compiler evidence; test assignment is appropriate
only in an explicitly disposable project.

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
Those alternate routes, contacts/coils, branches and general LD edits were not
covered by this FBD probe. Do not reuse example coordinates across layouts.

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
