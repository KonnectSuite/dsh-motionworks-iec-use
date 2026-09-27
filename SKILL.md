---
name: motionworks-iec-use
description: Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code — stage and open a project, read the live object model, read and rewrite POU Structured Text, add variable declarations, compile, and read the compiler's verdict and error text. Use when the user wants the agent to actually drive MotionWorks IEC rather than only inspect files. Never downloads to a controller and never commands motion.
whenToUse: The user has MotionWorks IEC 3 Pro open or asks for work in it — a real build, a compile verdict, the live project model, reading or changing POU Structured Text, or reading the IDE's error list. For pure offline `.mwt` inspection without the IDE, the file-level tools alone are enough.
---

# MotionWorks Use

Sixteen tools that drive a live MotionWorks IEC 3 Pro IDE and edit its code.
They come from the `motionworks-iec-use` Cordis plugin; nothing here needs to be
launched by hand, and no path needs to be configured.

## The one thing to understand: there are two effectors

**Code is not edited through the IDE's automation API, because that API cannot
touch code.** All three COM routes were tried and are closed:

| Route | Result |
|---|---|
| A body accessor on `_Pou` | does not exist — 35 members, none is Source/Body/Text |
| `ExecuteCommand` to drive menus | a stub — *"The method or operation is not implemented"* |
| `iec_61131-3_file_export` / `_import` providers | untyped IDispatch; `Execute()` returns OK and writes nothing |

So:

- **COM** (32-bit `Ade.Application.550`) owns the *IDE*: lifecycle, live model,
  compiler, output panes, screenshots.
- **The CFB container writer** owns the *code*: it edits the textual `.STB`/`.VB`
  streams directly, backs up first, and verifies the untouched sibling streams
  byte-for-byte.

**Consequence for you: file writes require the IDE to be CLOSED.** The IDE caches
project state and rewrites whole files, so an external edit under a running IDE is
discarded. Anything code-changing is therefore: close → write → start → open → build.

## Read before you change

```js
mw_code_pous          // POUs + language + has_st_body  <- the editability test
mw_code_unsupported   // POUs that CANNOT be edited safely
mw_code_read_st { pou }   // the ST body, exactly as the container holds it
```

`has_st_body: false` means a graphical **LD/FBD** POU. Its body is proprietary
binary with no public grammar — **refuse it**, or transplant a known-good body.
Never guess at graphical bytes.

## The coding loop

```
mw_ide_stage   { source }          copy a project into the plugin's own stage/
mw_code_pous                       see what is there
mw_code_read_st { pou }            read the current code
mw_ide_close                       REQUIRED before any write
mw_code_write_st { pou, body, dry_run: true }    preview — changes nothing
mw_code_write_st { pou, body, dry_run: false }   apply (backs up first)
mw_code_read_st { pou }            confirm what actually landed
mw_ide_start                       bring the IDE back
mw_ide_open    { path: <stage>\X.mwt }
mw_ide_build                       compile
mw_ide_errors                      capture the Errors pane — the only error text
```

`dry_run` defaults to **true** on every write, so the first call is always a
preview. Read the `result` block: `applied`, `before_bytes`/`after_bytes`,
`siblings_verified`, and `backups`.

## Compile semantics — do not trust the folklore

From `Ade.tlb`, the real enum is:

```
1 adeCtMake   2 adeCtBuild   3 adeCtPatch   4 adeCtWorksheet   5 adeCtDataTypes
```

The widely repeated "1 = Build, 2 = Rebuild" is **wrong**. There is **no Rebuild
compile type** — Rebuild is an IDE command, and `ExecuteCommand` is a stub, so
Rebuild is not reachable programmatically. Use `mw_ide_build` (`Compile(2)`).

## Reading a result honestly

- **Never report a compile you did not observe.** Read `is_compiled` from the
  reply. `accepted` and `settled` separate "compiled and failed" from "never ran".
- **`ApplicationState` is not a busy indicator** — it reads idle 0 s into a running
  build. The plugin detects completion by re-offering the compile until the IDE
  accepts it; do not replace that with a state poll.
- **Error text exists only as an image.** The output panes expose
  `Activate`/`Clear`/`AddEntry` but no read accessor, so `mw_ide_errors` brings the
  pane forward and captures the window. Read the returned path with the image tool.
- `mw_ide_variables` returns the IDE's own live model (names, types, initial
  values, IEC addresses, groups) and is a good cross-check on the file view.

## Facts that cost real time to learn

- **The IDE titles itself `MULTIPROG - <project>`** when `Mwt.exe` is launched
  directly — which is what automation does. Match the caption by *prefix*, and
  pick the **largest** matching window: startup creates small windows with the
  same caption, and choosing one yields a 426×166 "screenshot".
- A **cached COM proxy outlives the IDE**. After close → reopen it fails with
  `0x800706BA` until the connection is probed and dropped.
- Writes need a **writable backup directory**; the engine refuses a write it
  cannot back up.

## Safety — non-negotiable

- **Never download to a controller. Never command motion.** No such tool exists.
- **Code tools only ever touch the plugin's own `stage/`.** Every code path refuses
  a real project tree, so stage a copy first.
- **Every write is backed up** and its untouched sibling streams verified.
- **Graphical LD/FBD bodies are refused**, not guessed at.

## Known limits

- LD/FBD graphics can be **transplanted, never authored**.
- Arbitrary menu commands are unavailable (`ExecuteCommand` is a stub).
- Compile error text is image-only.
- `mw_code_var_edit` / `mw_code_var_delete` are not exposed yet — only
  `mw_code_var_add`; the engine already has the other two.
