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
## Global variables cannot be written, and that is deliberate

`mw_code_var_add` / `_edit` / `_delete` with **`pou` omitted** (a global) are
**refused**. They used to appear to work and silently wreck the project.

A global lives in **two** places:

| Where | What |
|---|---|
| `Global_Variables.VB` | the text declarations — writable |
| `Global_Variables.VGR` | a binary grid: header count + one record per variable |

Only the text stream could be written. Measured consequences of doing that:

```
after a global add : .VB declares 162, the .VGR header still says 161
build              : 125 errors — "No matching global variable found for ..."
                     naming globals that were NEVER touched, incl. PLCMODE_RUN
```

The compiler rejects the **entire** global table on that mismatch, so every POU in the
project fails at once — and the failing build then drops a task assignment too, which
is what made it look like corruption. Bumping the grid header count is not enough
either: tested, it takes 125 errors down to 29 and still does not compile, because a
new variable needs a real grid record.

So:

- **Read** globals freely with `mw_code_globals` — it reports the mismatch as a warning
  if a project is already in this state, which is how to recognise it.
- **Change** globals in the MotionWorks variable worksheet, then re-read them here.
- **POU-scoped** declarations (pass `pou`) are unaffected and write normally.
## The one that actually bites: assigning a CLONED POU

Isolated by bisection on one project, changing one step at a time:

```
create + declare variables        -> is_compiled=true    clean
+ write the body                  -> is_compiled=true    clean
+ add a global variable           -> is_compiled=true    clean
+ ASSIGN it to a task             -> is_compiled=false   125 reference errors
```

`mw_code_pou_create` clones a template, and a clone inherits the template's
**external variable records** — declarations that expect a matching VAR_GLOBAL. While
the POU is unassigned nothing compiles it, so nothing notices. Assign it and the
compiler evaluates those records:

```
No matching global variable found for 'TopCutterCamSetup:TopCutterCamTableID' in resource 'Resource'!
... 125 of them
```

**This is the root of the whole chain.** The failing build then drops the `Start`
task (see below), so the project ends up both uncompilable AND missing an assignment
— which reads exactly like corruption caused by whatever was written last.

What to do:

1. After `mw_code_pou_assign`, **always** run `mw_ide_build` and then `mw_ide_errors`.
   Never treat a successful assign as done.
2. If the messages say `No matching global variable found for '<POU>:<name>'`, the
   clone carried externals that do not resolve. `mw_code_pou_unassign` puts it back,
   or declare the missing globals with `mw_code_var_add`.
3. Prefer a template whose variables are plain locals. Check first with
   `mw_code_read_st` — its `variables` list shows a `group` on any declaration that is
   an external reference.
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
