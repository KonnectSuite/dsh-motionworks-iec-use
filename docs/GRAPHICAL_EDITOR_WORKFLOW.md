# Graphical FB and ladder editing

Use native tools for project identity, declarations, POU/task operations, Save,
Build and read-back. Use the desktop companion for the actual graphical canvas.
Serialize native workflows and UI input: native automation can bring the IDE
forward between a screenshot and a click. A submitted input is not acceptance.
Observe the settled result before the next action; if an immediate screenshot
still shows the earlier state, observe again instead of repeating the input.

Native screenshot capture now preserves foreground/active/focused window identity
and never activates or restores the main frame. Minimized capture and an unsafe
screen fallback are refused. Own-window rendering may omit a separately owned
inline dialog, so use the companion observation for that editor. This change
has passed stable live capture and refusal tests. Capture with an actual inline
editor open remains unverified. The separate companion path below now passed a
correct connected CommWatchdog operand replacement and compiler comparison.

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

### Inline editor window identity

Tab can open a temporary `#32770` window at the selected operand. Its foreground
handle can differ from the main IDE handle. Use the actual companion's supported
input API. If it requires `window_handle`, a keyboard refusal against the main
handle does not mean the editor is broken: identify the visible inline window
and keep the required handle guard intact.

The current foreground-input companion also has a verified route when its API
does not accept a window handle. In the October 5 disposable CommWatchdog test:

1. One click selected the existing connected DINT#1000 operand. Tab opened its
   inline editor. An immediate screenshot showed only the selected label;
   `list_windows` returned only the main frame and accessibility returned null.
   These observations did not justify switching focus or repeating Tab.
2. Ctrl+A through the supported foreground keyboard API, without activating a
   window, followed by a fresh screenshot showed the actual combo-box editor
   with only DINT#1000 highlighted. The canvas objects were not selected.
3. Literal DINT#2000 was typed through that same API. A fresh screenshot showed
   the new text in the box before Enter. No native workflow, activation or focus
   recovery was interleaved while the box was open.
4. Enter committed the editor. The immediate capture still showed the old label;
   selecting blank canvas then revealed the settled connected DINT#2000. Do not
   repeat an acknowledged edit because its immediate capture is stale.

Fresh Save, graphical Build/listing and Make accepted exactly the changed typed
load feeding WatchDog, with the other instructions, seven pins, declarations,
flags and unrelated sources unchanged. Do not type unless the current
observation proves text selection inside the intended inline box. If Ctrl+A
selects canvas objects instead, stop and reobserve; do not send replacement text.
This route does not bypass a companion that requires a handle or prove arbitrary
editor focus. It was exercised through the foreground-input companion API.

For a handle-based companion, after observing the inline box use its element metadata on the
exact IDE window to identify that visible, enabled inline window. Match its
process and rectangle to the observed operand; refuse multiple or unrelated
dialogs. Use its freshly returned handle for Ctrl+A, literal replacement text
and Enter, observing each result. In the CommWatchdog fixture, element info for
`class_name: "#32770"` returned the inline window; Ctrl+A, `DINT#2000` and Enter
succeeded at sending input against that handle. This did not establish a correct
operand replacement: after focus recovery the probe inserted an extra unconnected
operand, leaving the original input unchanged, and fresh Build failed with
`Object not connected or invalid connection!`. Confirm only the intended operand
is selected after any focus recovery; Ctrl+A on the canvas selects graph objects.
If selection or connection changes, stop before typing. Compare the committed
canvas to its baseline before Save/Build. A previous handle became invalid after changing
focus. Never reuse it after closing/reopening the editor or focus recovery.

Do not focus the main frame between opening the inline box and typing, since
that can close the box. In the earlier handle-based runtime, `get_active` failed
and element metadata supplied the observed handle instead.
Close/commit the box before native Save, Build or other native workflows.

The new CommWatchdog receipt is
`comm-graph-92b2b405-c83a-464d-94a5-897f23d9801d.json`, phase cleaned,
accepted=true. Scratch unassign/delete, fresh Build/Make and complete saved/native
baseline comparison passed. The original failed receipt remains failed; this
fresh test establishes the corrected path without rewriting that evidence.

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
Selecting the wrong contact creates a different expression. The multi-object
Ctrl+T path is covered by the separate verified workflow below.

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

## Parallel branch spanning several contacts

Installed `ld001/InsertingParallelLDBranches.htm` documents selecting several
contacts and using Ctrl+T. Installed GraphEd001 topic
`movingthecursorandmarkingobjectsinthegraphiceditorusingthekeyboard.htm`
distinguishes the gray object cursor from explicit selection: arrow keys move
the object cursor, Space selects, Shift+Space extends selection and Ctrl+Space
toggles a member. Confirm the actual effect because shortcuts can be customized.

The disposable probe first created `Run` and `Enable` contacts in series and a
`Ready` coil through F6/F7 and observed Tab inline editing. Right moved the object
cursor from Enable to the coil; Space selected it before Tab bound Ready.
Fresh compiler read-back matched LD Run, AND Enable, ST Ready before branch work.

For the branch, focus was restored inside the observed Run contact after native
compilation. Right moved the object cursor to Enable, Shift+Space selected it,
Left moved the object cursor back to Run while preserving Enable's selection,
and Shift+Space extended the selection to Run. Both contacts were marked and the
coil was excluded. Ctrl+T inserted one lower contact with a branch beginning
before Run and rejoining after Enable. Tab opened that new contact's inline
editor; its selected placeholder was replaced with the existing Alternate BOOL.
The settled label and both branch junctions were inspected before native Save.

Fresh Build/listing matched exactly LD Run, AND Enable, OR Alternate, ST Ready,
representing `Ready := (Run AND Enable) OR Alternate`. Make passed. Complete
native declaration fields, all six flags and groups stayed unchanged, as did
tasks, globals and every unrelated source/translation. Saving introduced only
the target code worksheet's empty translation file; its parsed empty ItemList
was inspected and retained. Do not broadly ignore translation changes.

Native unassignment/deletion and fresh Build/Make restored the exact full
baseline, with zero errors. Evidence: `ld-branch-df0f0799-47e8-4b87-b07f-437bbe83dd7d.json`,
phase cleaned, accepted=true, cleanup_verified=true. This proves a branch spanning
two serial contacts, not arbitrary branch topologies or controller behavior.
Observe again when an immediate screenshot is stale; do not repeat keys solely
because the first capture still shows the old state.
