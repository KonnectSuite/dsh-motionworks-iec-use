---
name: motionworks-iec-use
description: Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code â€” stage and open a project, read the live object model, read and rewrite POU Structured Text, add variable declarations, compile, and read the compiler's verdict and error text. Use when the user wants the agent to actually drive MotionWorks IEC rather than only inspect files. Never downloads to a controller and never commands motion.
whenToUse: The user has MotionWorks IEC 3 Pro open or asks for work in it â€” a real build, a compile verdict, the live project model, reading or changing POU Structured Text, or reading the IDE's error list. For pure offline `.mwt` inspection without the IDE, the file-level tools alone are enough.
---

# MotionWorks Use

Twenty-one tools that drive a live MotionWorks IEC 3 Pro IDE and edit its code.
They come from the `motionworks-iec-use` Cordis plugin; nothing here needs to be
launched by hand, and no path needs to be configured.

## Most users have no licence â€” and that is fine

**Editing code does NOT need a MotionWorks licence.** The code half is pure file
I/O on the project container, so it works with the IDE closed, unlicensed, or
never installed:

`mw_ide_stage`, `mw_code_pous`, `mw_code_read_st`, `mw_code_write_st`,
`mw_code_pou_create`, `mw_code_pou_delete`, `mw_code_var_add`,
`mw_code_var_edit`, `mw_code_var_delete`, `mw_code_unsupported`.

Only the `mw_ide_*` tools need a running, licensed IDE â€” they add **compile
verification**, the live object model, the error list and screenshots.

So when someone has no licence: **carry on and edit the code.** Do not report the
task as blocked. Say what a licence would add (a compile verdict) and let them
decide.

If the IDE is unlicensed it shows a modal dialog **before** creating any window;
until it is answered the IDE has no project services and `OpenProject` fails with
`Internal error in 'OpenProject'`, which looks exactly like a broken install.
`mw_ide_start` detects that dialog and clicks "Use Trial" itself. If the dialog is
an **activation** form (`Activate Online` / `Activate by Phone` / `Retry`, no
`Use Trial`), no trial remains and no automation can proceed â€” that is licensing,
not a defect.

## Reading compiler errors

`mw_ide_errors` returns the compiler messages **verbatim** — a failed build is
actionable, not a dead end:

```
mw_ide_build   -> COMPILE FAILED (is_compiled=false)
mw_ide_errors  -> 24 message(s)
                    No matching global variable found for 'x:y' in resource 'Resource'!
                    Instance 'CalcSplineMatrix' is used more than once!
```

- `mw_ide_errors { pane: "Warnings" }` — warnings
- `mw_ide_errors { pane: "Build" }` — the compile phases, step by step
- Panes: `Errors`, `Warnings`, `Build`, `Infos`, `PLC Errors`, `Print`, `Statistics`, `SCC`
- **Zero lines is a clean result**, not a failure
- `limit` raises the 200-line cap; `screenshot: true` also captures the pane

`mw_ide_compile_state` reports `is_compiled` / `is_modified` without building, which
is the cheap check before deciding whether a build is needed at all.
## The .VGR variable grid, fully decoded

A POU's declarations live in **two** stores, and the compiler reads both:

| Where | What |
|---|---|
| `<POU>V.VB` | the text: `VAR` / `VAR_EXTERNAL` blocks |
| `<POU>V.VGR` | a binary grid: a header and one record per variable |

**The `row` field in each record is the declaration's 1-based LINE NUMBER in the `.VB`.**
Verified across a whole POU, 12 records for 12 declarations:

```
row=6  -> text line 5   TopCutterCamTableID      row=18 -> line 17  xGenerate
row=14 -> line 13       fbCamGen                 row=20 -> line 19  iState
row=25 -> line 24       TopCutterEyeToKnifeDistance
```

The grid and the text are two views of one list; `row` is the link between them.

### Record layout

```
+0    6 x uint32   handle, usage, group, flags, WORKSHEET ROW, final flags
+24   uint32 len + string 1  TYPE
      uint32 len + string 2  always empty
      uint32 len + string 3  INITIAL VALUE  ("" external, "FALSE" local BOOL,
                                             "0" local INT, "" for a struct)
      uint32 len + string 4  NAME
      trailing run           the EXTERNAL marker lives here: ffffffff for usage=5,
                             zeros for usage=1
```

Strings are UTF-16LE with a NUL terminator, so `len` counts bytes and is always even.

`usage` is **1** local, **5** external, **0x00040001** a function-block instance.
Records are found by their field pattern, not a fixed stride, because the strings make it
uneven (84 to 258 bytes in the project measured).

### Reading is reliable

`variables.parse_grid_records` and `variables.read_grid_record` decode every record,
including the initial value. Measured across the project: **239 records, 239 clean names,
0 failures** - where the earlier reader, which skipped a fixed 12 bytes between the type
and the name, produced garbage for every local record because 12 is only correct when
strings 2 AND 3 are both empty.

### What a POU's state actually consists of

Worth writing down, because two rounds were spent looking in the wrong place. A POU is not
just a text file and a grid:

| Where | What | Input or output? |
|---|---|---|
| `POE/<pou>/src.st1` `.VB` stream | the declaration text | **input** |
| `POE/<pou>/src.st1` `.VGR` stream | the variable grid | **input** |
| `<pou>V.VB` inside the project | duplicate of the above text | input |
| `Resource/ICI<NNNNN>.DIT` | a text interface: `T: PROGRAM <pou>`, `QVE: 13`, then per variable `@V 1 6 0 / <name> / VAR_EXTERNAL / @TYP:7` | **OUTPUT** |
| `Resource/ICI<NNNNN>V.DBD` | every variable name in order, 3 x uint32 header, a uint32 count, then per entry two uint32 and a one-byte length with an ASCII name (`0x13` = 19 for `TopCutterCamTableID`) | **OUTPUT** |
| `Resource/ICI<NNNNN>.{CIC,SP,DBD,DIW,CIW}` | code, source paths, debug info | OUTPUT |
| `Resource/IR.{LCI,LDI,TDI}`, `IR_FULL.TDI` | project-wide indexes; `NUPG`/`NFBI` tallies, and the `.vb` path per unit | OUTPUT |
| `Resource/eCLRPouDependencies.dat` | the POU/library dependency map | OUTPUT |

The output rows are the ones that matter here, and they are distinguishable by experiment
rather than by guessing: **remove them and a successful build recreates them.** With a
declaration added and NOT used, deleted ICI files came back (7 of them) and the build passed.
With a declaration added and USED, the build stalled and they did **not** come back - because
the stall is the thing that stops them being written.

So they are a symptom, not a cause, and a stale one cannot be the reason a declaration stalls.
That was worth testing because they are ordinary files rather than streams inside a
container, so rewriting them would have needed no binary surgery at all. It does not work.

The `.VGR` grid remains the governing input, and the two limit rows below are unchanged.

### Declaring is safe; USING needs the grid

Isolated, each case on a freshly staged copy and each judged by a build:

```
declaration only                        is_compiled=true
declaration AND a body write            is_compiled=true
declaration AND a body that USES it     is_compiled=false  (STALLED, empty Errors pane)
body write only                         is_compiled=true
```

and in **every** case the POU was intact afterwards - the `.VB` stayed at 1134 bytes and the
grid at 1565. So `mw_code_var_add` for a POU works, and declaring is harmless.

**The one limitation is precise: a declaration that exists only in the text cannot be
USED.** The compiler resolves variables through the `.VGR` grid, and a variable declared
only in the `.VB` is not in it. Referring to it in the body makes the build **stall** -
`is_compiled=false`, `is_modified=true`, and an **empty** Errors pane, so nothing warns you.

To actually use a new variable, either:

- add it in the MotionWorks **variable worksheet**, then re-read with `mw_code_read_st`; or
- `mw_code_export_pou { format: "export" }`, edit the declarations in that file, and
  **import** it — the IDE writes the grid itself from the text.

An earlier version of this plugin REFUSED POU declarations outright. That was wrong: the
POU destruction seen at the time came from this plugin's own `.VGR` append, not from the
declaration. Removing the append removed the damage.
## Two traps that make a green build lie

Both were measured on a real project, not inferred.

### 1. An unassigned POU is never compiled

`mw_code_pou_create` leaves the new POU assigned to **no task**. Such a POU never
runs, and â€” measured â€” the build does not check it either. A POU containing
`UndefinedThingXYZ := UndefinedThingXYZ + 1;` reported **`is_compiled=true`** while
unassigned, and **`is_compiled=false`** the moment it was assigned to a task.

So after creating a POU:

```
mw_code_pou_create { name: "Helper", template: "Main", dry_run: false }
mw_code_pou_assign { task: "SlowTsk", pou: "Helper", dry_run: false }   # or it is inert
mw_code_tasks                                                          # confirm
```

`mw_code_tasks` lists every task, what each one calls, and which POUs are assigned
to nothing. **Check that `unassigned` is empty before believing a clean build.**

### 2. Opening a project that contains a broken POU DROPS a task

Measured under control on a pristine copy:

```
after create + assign (before open) : 5 tasks  â€” SlowTsk(2) Start(1)
after OPEN, before any build        : 4 tasks  â€” Start GONE
```

`Start` and its `TopCutterInitialize` assignment disappeared from `PROJECT.TRE`,
`NODES.LST` **and** the resource `NODES.LST`. The raw tree shows why it is invisible:
one line is deleted, so the node header reads `13 0 0 0` (level 0) instead of
`13 5 1 0` (level 5), and the task simply ceases to exist as a task.

**This is almost certainly what "the first attempt corrupted the project" was** â€” not
a code write, but the IDE's own handling of a project holding a POU that does not
compile.

What to do about it:

- **Write code that compiles before you reopen.** The linter catches undeclared
  names for you; `mw_code_write_st` refuses such a body unless you pass
  `run_lint: false`. Do not override it casually.
- **After opening any project you know holds broken code, run `mw_code_tasks`** and
  compare with what you expect. A missing task is this bug, not your edit.
- The deleted assignment is recoverable: the plugin backs up before every write, and
  `mw_code_pou_assign` can put the task back.

## NEVER conclude "the IDE closed" without checking

This is the single easiest way to get lost here. An `mw_ide_*` call fails, or
reports no project, and it gets read as *"the IDE has closed"*. Almost always the
IDE is running fine and is simply **waiting for a button on a modal dialog**.

The automation API is silent while a dialog is up: `IsProjectOpen()` returns false
or throws, `OpenProject` fails with `Internal error`, and the frame window is
disabled. COM alone therefore *cannot* distinguish "no project" from "waiting for
an answer".

**Rule: after every `mw_ide_*` step, call `mw_ide_state`.**

- `blocked: false` â†’ carry on.
- `blocked: true` â†’ the IDE is waiting for a button. The result carries each
  dialog's **exact message text and button labels** (read with `WM_GETTEXT` from
  the standard Win32 dialog â€” exact, not an OCR guess). Answer it with
  `mw_ide_dialog`, then call `mw_ide_state` again to confirm.
- Pass `screenshot: true` when a dialog has no readable text â€” the .NET licence
  dialog is owner-drawn, and then the image is the only source. Read the returned
  PNG with the image tool; do not guess at what it says.

MotionWorks only ever asks about the **staged copy** ("defragment this project?",
"this project was not closed cleanly â€” load anyway?", licence notices), and the
plugin never opens your original project â€” so answering "Yes, load anyway" is
safe by construction.

Two safety nets mean you rarely hit this cold:

- `mw_ide_open` answers the recurring safe prompts (defragment â†’ No, load anyway â†’
  Yes, software-key notice â†’ OK) itself, while it waits.
- **Every failing bridge call already names any blocking dialog**, quoting its text
  and buttons, and says explicitly that the IDE is *not* closed. If a tool errors,
  read the error before concluding anything â€” the answer is usually in it.

## The one thing to understand: there are two effectors

**Code is not edited through the IDE's automation API, because that API cannot
touch code.** All three COM routes were tried and are closed:

| Route | Result |
|---|---|
| A body accessor on `_Pou` | does not exist â€” 35 members, none is Source/Body/Text |
| `ExecuteCommand` to drive menus | a stub â€” *"The method or operation is not implemented"* |
| `iec_61131-3_file_export` / `_import` providers | untyped IDispatch; `Execute()` returns OK and writes nothing |

So:

- **COM** (32-bit `Ade.Application.550`) owns the *IDE*: lifecycle, live model,
  compiler, output panes, screenshots.
- **The CFB container writer** owns the *code*: it edits the textual `.STB`/`.VB`
  streams directly, backs up first, and verifies the untouched sibling streams
  byte-for-byte.

**Consequence for you: file writes require the IDE to be CLOSED.** The IDE caches
project state and rewrites whole files, so an external edit under a running IDE is
discarded. Anything code-changing is therefore: close â†’ write â†’ start â†’ open â†’ build.

## Read before you change

```js
mw_code_pous          // POUs + language + has_st_body  <- the editability test
mw_code_unsupported   // POUs that CANNOT be edited safely
mw_code_read_st { pou }   // the ST body, exactly as the container holds it
```

`has_st_body: false` means a graphical **LD/FBD** POU. Its body is proprietary
binary with no public grammar â€” **refuse it**, or transplant a known-good body.
Never guess at graphical bytes.

## The coding loop

```
mw_ide_stage   { source }          copy a project into the plugin's own stage/
mw_code_pous                       see what is there, and what is editable
mw_code_read_st { pou }            read the current code
mw_ide_close                       REQUIRED before any write (skip if no IDE is running)
mw_code_write_st { pou, body, dry_run: true }    preview â€” changes nothing
mw_code_write_st { pou, body, dry_run: false }   apply (backs up first)
mw_code_read_st { pou }            confirm what actually landed
mw_ide_start                       bring the IDE back
mw_ide_open    { path: <stage>\X.mwt }
mw_ide_build                       compile
mw_ide_errors                      READ THE MESSAGES AS TEXT (see below)
```

Structural edits use the same rhythm:

```
mw_code_pou_create { name, template, dry_run: false }   clone an existing POU
mw_code_pou_delete { name, force?, dry_run: false }     archived, not destroyed
mw_code_var_add    { name, type, pou?, section?, dry_run: false }
mw_code_var_edit   { name, pou?, type?/new_name?/description?, dry_run: false }
mw_code_var_delete { name, pou?, force?, dry_run: false }
```

`mw_code_pou_create` needs a `template`: creation clones an existing POU's
directory and renames its streams, so a POU cannot be authored from nothing. Use
an ST POU as the template when you want an ST POU. The new POU starts with the
template's body â€” replace it with `mw_code_write_st`.

`dry_run` defaults to **true** on every write, so the first call is always a
preview. Read the `result` block: `applied`, `before_bytes`/`after_bytes`,
`siblings_verified`, and `backups`.

## Compile semantics â€” do not trust the folklore

From `Ade.tlb`, the real enum is:

```
1 adeCtMake   2 adeCtBuild   3 adeCtPatch   4 adeCtWorksheet   5 adeCtDataTypes
```

The widely repeated "1 = Build, 2 = Rebuild" is **wrong**. There is **no Rebuild
compile type** â€” Rebuild is an IDE command, and `ExecuteCommand` is a stub, so
Rebuild is not reachable programmatically. Use `mw_ide_build` (`Compile(2)`).

## Reading a result honestly

- **Never report a compile you did not observe.** Read `is_compiled` from the
  reply. `accepted` and `settled` separate "compiled and failed" from "never ran".
- **`ApplicationState` is not a busy indicator** â€” it reads idle 0 s into a running
  build. The plugin detects completion by re-offering the compile until the IDE
  accepts it; do not replace that with a state poll.
- **Error text exists only as an image.** The output panes expose
  `Activate`/`Clear`/`AddEntry` but no read accessor, so `mw_ide_errors` brings the
  pane forward and captures the window. Read the returned path with the image tool.
- `mw_ide_variables` returns the IDE's own live model (names, types, initial
  values, IEC addresses, groups) and is a good cross-check on the file view.

## Facts that cost real time to learn

- **The IDE titles itself `MULTIPROG - <project>`** when `Mwt.exe` is launched
  directly â€” which is what automation does. Match the caption by *prefix*, and
  pick the **largest** matching window: startup creates small windows with the
  same caption, and choosing one yields a 426Ã—166 "screenshot".
- A **cached COM proxy outlives the IDE**. After close â†’ reopen it fails with
  `0x800706BA` until the connection is probed and dropped.
- Writes need a **writable backup directory**; the engine refuses a write it
  cannot back up.

## Safety â€” non-negotiable

- **Never download to a controller. Never command motion.** No such tool exists.
- **Code tools only ever touch the plugin's own `stage/`.** Every code path refuses
  a real project tree, so stage a copy first.
- **Every write is backed up** and its untouched sibling streams verified.
- **Graphical LD/FBD bodies are refused**, not guessed at.

## Known limits

- LD/FBD graphics can be **transplanted, never authored**.
- Arbitrary menu commands are unavailable (`ExecuteCommand` is a stub).
- Compile error text is image-only.
- `mw_code_var_edit` / `mw_code_var_delete` are not exposed yet â€” only
  `mw_code_var_add`; the engine already has the other two.


## The IDE's own tree output, kept as a reference

`docs/reference/` holds three snapshots of the SAME project tree, captured in one run of
`test/tree_diff_damage.mjs`:

| file | what it is |
|---|---|
| `pristine-tree.tre` | the staged project, before any edit |
| `plugin-spliced-tree.tre` | after this plugin's assignment splice, before the IDE has seen it |
| `ide-rewritten-tree.tre` | after the IDE opened the project |

**This is the artifact that was missing for many rounds.** Every earlier attempt at task
assignment reasoned about what the IDE MIGHT object to; these three files show what it
actually does, and the answer is narrow and specific.

Opening the project after a splice rewrites **only the one generated node** and leaves every
real instance byte-for-byte alone:

    real instance, untouched                 generated node, rewritten by the IDE
    562 | '19'                               571 | '19'
    563 | '46 6 0 0'                         572 | '62'          <- my '62 6 0 0', split
    564 | 'ServoTaskSlow\t0\t0\t'            573 | '12 0 0 0'    <- a line that was never written
    565 | 'ServoTaskSlow\teCLR\t...'          574 | 'DiffProbe\t0\t0\tCYCLIC\t-1\t'
    566 | ''                                 575 | '\t\t\t\t-1\t'
    567 | '0\t-1\t0\t0\t0\t0\t0\t0\t0'     576 | '0'
    568 | ''                                 577 | '10410112\t0\t0\t0\t0\t0\t0\t0\t0'
    569 | 'B7C90EAD 919B ...'                  578 | 'D861BDEB 0535 ...'   <- my GUID, kept
    570 | '0\t0\t0\t0\t0\t0\t0\t0\t0\t0' 579 | '00000000 0000 ...'   <- zeroed

Two facts follow, and neither was knowable from reasoning:

* the IDE PARSED the generated node (it kept the marker `19` and my GUID), so the block is
  recognised as a node rather than skipped;
* it read the fields at DIFFERENT OFFSETS than this plugin writes them - `62 6 0 0` came back
  as `62` followed by `12 0 0 0`, and the name line came back with the path's cycle field
  folded into it.

So the remaining question is a field-offset question, not a "does the format match" question,
and the three files settle it by comparison instead of by guesswork.

The assignment stays REFUSED. A tool that reports success and returns a project whose task
list the IDE has rewritten is worse than one that declines.


### The IDE's own node format, read off its output

The three snapshots in `docs/reference/` show the IDE writing nodes in a form that does NOT
match what this plugin reads and writes. Side by side, for the same three nodes:

    this plugin reads / writes            the IDE writes
    ----------                            ----------
    id 13 @563  '13 4 0 0'                id 13 @442  '13' / '9 2 16 0' / 'Configuration'
    id 25 @533  '25 5 1 0'                id 25 @582  '25' / '13 0 0 0' / 'C\...\Start'
    id 35 @543  '35 6 0 0'                id 35 @592  '35' / '25 0 0 0' / 'TopCutterInitialize'

Two differences, and the first is the one that matters:

* **the id is on its own line**, and the numbers that follow are a DIFFERENT SET OF FIELDS -
  ``<parent> <children> <flags> <unknown>`` rather than ``<id> <level> <children> <flags>``.
  A node's "level" in this plugin's model is really a node TYPE, and the IDE does not carry it
  in that position at all.
* **the name and path are merged onto one line**, with the path's cycle and runtime fields
  appended: ``C\Configuration\R\Resource\Start<TAB>0<TAB>0<TAB>SYSTEM<TAB>317``.

The ids do not correspond between the two formats either - the IDE's 13 is ``Configuration``
where this plugin's 13 is ``IO_Configuration`` - so any comparison has to go by NAME, not id.

**What this explains.** The parser in ``tree.py`` reproduces the stream byte-for-byte and its
spans tile the source, so reading is consistent with itself; but a node WRITTEN in the read
format is not what the IDE expects, which is why it re-emits the affected nodes rather than
accepting them. The damage is confined to nodes adjacent to the insert, and the ids it hits
are the same three every time (13, 35, 40 by this plugin's numbering), independent of which
program is being assigned and of the tree's size.

**What is still missing: an IDE-written instance.** Every node the IDE wrote in these
snapshots is one it was REWRITING, so its output shows the field layout but not a clean
example of a program instance it created itself. That is the artifact that would settle the
assignment, and the same request as before: add a program to a task in the MotionWorks
Project Tree, save, and the tree will contain one.

Until then ``mw_code_pou_assign`` stays refused. The evidence is committed rather than
described, so the next attempt compares files instead of reconstructing them.


### The resource grid, `Global_Variables.VGR` - a third layout

A POU's grid is `<name>V.VGR`. The resource's is `Global_Variables.VGR`, so a check written as
"ends with V.VGR" never matches it and this plugin had never read it. It is 22,893 bytes and its
header says `count=161`, which is exactly the number of globals.

**Header is THREE uint32**, not four:

    magic = 524289      last_handle = 1438      count = 161

and the fourth number at offset 12 is not a field - it is record 1's handle, so the first record
starts there. Getting that wrong is what made the first attempt find one record.

**A record is six uint32, four strings, then a VARIABLE-LENGTH trailing run:**

    offset 12   record 1
                head   = 1025, 6, 1, 0, 6, 0        handle, 6, 1, 0, <n>, 0
                str 1  len=10   "DINT"
                str 2  len=14   "%MD1.0"
                str 3  len=2    ""                  the initial value
                str 4  len=34   "PLC_SYS_TICK_CNT"
                tail   16 bytes

Strings are length-prefixed UTF-16LE with a NUL terminator, exactly as in a POU grid, and the
four fields are the same four in the same order: type, address, initial value, name. So the
*fields* are familiar; only the container differs.

Fifteen records decode perfectly this way - real names, real types, real addresses, handles
ascending 1025..1040:

    @    12  h=1025  DINT             %MD1.0       PLC_SYS_TICK_CNT
    @   128  h=1026  INT              %MW1.4       PLC_TASK_DEFINED
    @   242  h=1027  BOOL             %MX1.2016.0  PLCMODE_ON
    @  1662  h=1040  TASK_INFO_ECLR   %MB1.5000    PLC_TASK_1

**The sixteenth is where a fixed tail stops working.** Record 15 is `PLC_TASK_1 : TASK_INFO_ECLR`,
a struct, and its trailing run is SIX uint32 rather than four:

    1780:  00000104  00040000  00000000  00000000  ffffffff  00000000
    1804:  00000411 = 1041            <- record 16's handle

So the tail carries per-type structure and its length varies, exactly as in a POU grid, where a
scalar record's run is 16 bytes and `CamSegmentStruct`'s is far longer. Reading it needs the
same extent-finding approach `parse_grid_records` uses for a POU grid - locate the next record
by its shape rather than assuming a stride.

**Consequence for the plugin.** `mw_code_var_add` writes `Global_Variables.VB` and nothing else.
A global added that way is declared and readable, and it builds cleanly, but it cannot be USED:
the chain a user would ask for is

    add a global  ->  declare it VAR_EXTERNAL in a POU  ->  use it  ->  build

and measured, the middle step stalls even when the variable is never used:

    global + VAR_EXTERNAL + USE      stall
    global + VAR_EXTERNAL, not used  stall      <- stalls WITHOUT being used
    global only, then use            clean      <- the lint refuses the body, as designed

Stalling while unused is the informative one: it is not about the use, so the missing half is
the global's own record here. That is the next implementation, and it is now a known format
with a known catch rather than an unknown one.


### Verify your own writes with `mw_ide_variables`

The most useful thing found by sweeping the tools that had never been exercised. `mw_ide_variables`
reads the IDE's OWN live variable model over COM - not the files this plugin wrote - so it is an
independent check rather than the plugin vouching for itself:

    mw_ide_variables                      -> {"pous":[{"pou":"TopCutterFFCamSetup","count":24,...}]}
    mw_ide_variables {pou:"TopCutterCamSetup"} -> count=12, each with data_type, initial_value,
                                                  iec_address

Measured: after `mw_code_var_add` declared a variable, asking the IDE reported it **present**.
So the sequence an agent should use to be sure a write landed is:

    write it       mw_code_var_add / mw_code_var_edit / mw_code_write_st
    confirm it     mw_ide_variables, or mw_code_read_st for the file view
    compile it     mw_ide_build, then mw_ide_errors

A file read proves the bytes are there; `mw_ide_variables` proves the IDE agrees.

### Also verified by the same sweep

| tool | what it does |
|---|---|
| `mw_ide_pous` | 7 POUs from the live model, with language codes |
| `mw_ide_make` | Make (Compile 1): `accepted=true, settled=true, is_compiled=true` |
| `mw_ide_errors` | every pane works - Errors 19 lines, Warnings 8, Infos 8, Build 19 |
| `mw_ide_variables` | the live model, whole project or one POU |

`mw_code_pou_unassign` was exercised for the first time and REFUSES, like assign - writing a tree
is what triggers the IDE to rewrite it. Its message now names the direction the caller asked for
rather than always saying "assign"; before this it answered an unassign request with instructions
for assigning, which is confusing in exactly the place an agent is already stuck.

Removing a node renders cleanly (-9 lines for one instance, structurally valid) but the
open-and-build check could not be completed when it was tried: the IDE's COM state returns
"Internal error in OpenProject" after a force-kill and needs the environment restarted. So
unassign stays refused on the evidence that ADDING damages the tree, not on evidence that
removing does.


### Both directions of tree editing break the project, and they break it differently

Round 30 left this open: removing a node renders cleanly, so unassign might be safe even though
assign is not. It is not, and the two failures are not even the same shape.

On one restarted IDE, one staged project, with the tree the only variable:

    C1  nothing changed       open OK,  build is_compiled=true
    C2  one instance removed  OPEN FAILS: "Internal error in OpenProject"

So a REMOVAL does not damage the tree on open the way an INSERT does - it stops the project
opening at all. The insert path is the milder of the two: the project opens, and then three nodes
have been rewritten and the build reports 125 unresolved-global errors. Removal is worse.

**The structural check sees nothing wrong.** The removed tree is 563 lines, nine fewer, with no
malformed node header anywhere - ``badIds=[]``. It looks valid by every test this plugin has, and
the IDE will not open it. That is the same lesson the POU grid taught: a binary structure can
satisfy every field that can be READ and still be refused, because the constraint that matters is
in something that cannot be read.

### Recovering a wedged IDE

An "Internal error in OpenProject" that survives ``mw_ide_start`` is not permanent. What clears it:

    1. mw_ide_close      the bridge's own close, which kills the process it knows about
    2. taskkill          the remaining Mwt
    3. mw_ide_start      returns already_running=false with a fresh window
    4. mw_ide_open       succeeds

Step 3 matters: ``mw_ide_start`` on an already-running process reports ``already_running`` and
attaches to the stale one, so the COM state is never rebuilt. The close-then-start pair is what
does it, and a force-kill ALONE leaves the bridge holding a dead COM object so every later
OpenProject fails. This cost time twice before it was written down.

``mw_code_pou_assign`` and ``mw_code_pou_unassign`` both stay refused, now on evidence for each
direction rather than by analogy from one.


### PLCopen XML export / import exists, and is LIVE

Round 5 recorded import/export as a dead end. That was measured on `ExternalImportExportProviders`,
which is EMPTY - the probe never reached the collection that matters.

`Ade.Application.ImportExports` holds SIX operations, and enumerating them (1-BASED - index 0 is
out of range) gives:

    item  Direction  ImportExportType               Execute()
    1     2 import   file_exchange_format_import    Not implemented
    2     2 import   iec_61131-3_file_import        returns
    3     1 export   iec_61131-3_file_export        returns
    4     1 export   cross_references_export        Not implemented
    5     1 export   plc_open_xml_export            One or more arguments are invalid
    6     2 import   plc_open_xml_import            One or more arguments are invalid

**"Arguments are invalid" is not "not implemented".** Items 5 and 6 are implemented code waiting
for parameters, and item 6 matters more than anything else found in this project so far, because
the PLCopen help states Task is exportable and importable, and the schema on disk
(`TC6_XML_V10.xsd`) defines `<pouInstance name type>` INSIDE `<task>` - which is precisely the
program assignment this plugin cannot otherwise write.

The argument shape is still unknown: 0, 1 and 2 arguments all report "Number of parameters
specified does not match the expected number", so the arity is fixed and hidden behind IDispatch
late binding. `SetAttribute` and `GetAttribute` are stubs.

### The route to an object: GetObjectByLogicalName

    ActiveProject.GetObjectByLogicalName : IDispatch GetObjectByLogicalName (string, AdeObjectType)
    ActiveProject.GetInstancePathForPou  : string   GetInstancePathForPou (string)      STUB
    Application.ExportEvcObject          : void     ExportEvcObject (AdeEvcObject)
    Application.ImportEvcObject          : void     ImportEvcObject (AdeEvcObject)

The two-argument signature is why a first attempt failed on arity rather than on the name. With a
project genuinely open, `GetObjectByLogicalName` answers **"Cannot find BG in Project."** for every
name tried and every type value 0..24 - so it SEARCHES, the project IS reachable over COM, and the
only missing piece is the logical name format. `GetInstancePathForPou` is a stub, so the
assignment question cannot be asked that way.

### Two traps worth recording

**A standalone `New-Object -ComObject Ade.Application.550` is not the plugin's IDE.** With no IDE
running it LAUNCHES one, bare, so `ActiveProject.Name` is empty and every call reports "There is
no project open" - which reads like a missing feature and is really a missing project. Start the
IDE and open a project through the plugin FIRST, then probe.

**`[void](Function ...)` discards the function's whole output stream**, not just its return value,
so a probe written that way prints nothing and looks like it hung. Probes should use Write-Host.


### Never kill node or powershell by name on this machine

The COM bridge needed restarting, so:

    Get-Process node | Stop-Process -Force

killed the harness running the command. The shell died mid-sentence, the call returned
``[exit code: 4294967295]`` with no output, and every long test afterwards failed the same way
until the environment recovered. **The DSH harness runs on node and spawns powershell**, so a blunt
kill by process NAME takes out the thing doing the killing.

The same mistake in miniature: stopping powershell from a child shell whose ``$PID`` was the
CHILD's, which killed the parent and produced no output at all.

The bridge has its own ``stop`` verb. Use it. Never match a process by name alone - filter on
CommandLine, or let the tool that owns the process end it.

### Open: does the stale-App fix also cure create-then-declare?

Round 45 found that ``Connect-App`` cached ``$script:App`` and served the project it FIRST saw,
making mutation verbs fail with errors that name the operation instead of the cause. Dropping that
cache whenever a project is opened or the IDE is closed fixed it.

That may be more than plumbing. **Every create-then-declare test in rounds 40 to 44 ran through a
long-lived bridge across many restages**, and the failure was the IDE REWRITING files during a
build. If a stale Application reference reaches the IDE's own writes, the "landmine" documented in
round 44 - and the tool description currently telling agents NOT to add declarations to a created
POU - may describe a bug that no longer exists.

**The test, not yet run:** create, add a declaration, reopen, assign, build, with the bridge
restarted between every step so no cached COM object survives. If it passes, the warning comes out
of ``mw_code_pou_create`` and a feature is restored. If it fails, the warning stays and it is known
to be a real format problem rather than a stale handle.
