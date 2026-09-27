# MotionWorks Use — a Cordis plugin for DeepSeek Harness

Lets the agent **operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its
code**: stage and open a project, read the live object model, read and rewrite
POU Structured Text, compile, read the compiler's verdict and its error messages,
and see the IDE.

## Install

**Requirements:** Windows, MotionWorks IEC 3 Pro, Node ≥ 20.

Python is needed by the code engine, but you do **not** have to install it: the
engine is stdlib-only (`win32com` is imported lazily inside a single function), and
the plugin auto-discovers the interpreter AryaAI already ships. `MW_PYTHON`
overrides it; `MW_SRC` points the engine at a different tree for development.

Two things must line up, and the package name has to match in both:

```powershell
# 1. make the package resolvable
$nm = "$env:USERPROFILE\profiles\desktop\node_modules"
New-Item -ItemType Junction -Path "$nm\dsh-motionworks-iec-use" -Target "C:\path\to\this\repo"
```

```jsonc
// 2. profiles\desktop\package.json — add the bundle
"dsh": { "profile": { "bundles": [ /* … */ "dsh-motionworks-iec-use" ] } }
```

The third piece — the row itself — is contributed by this package's own
`cordis.patch.yml`, so nothing else needs editing.

**A DSH restart is required.** Bundles are read at boot, so the tools will not
appear in the session that installed them.

Once published, `npm install dsh-motionworks-iec-use` replaces step 1.

## The two effectors, and why there are two

**Code is not edited through the IDE's automation API, because that API cannot
touch code.** All three candidate COM routes were tried and closed:

| Route | Result |
|---|---|
| A body accessor on `_Pou` | **does not exist** — 35 members, none is Source/Body/Text |
| `ExecuteCommand(CommandId)` to drive menus | **stub** — *"The method or operation is not implemented"* |
| `ImportExports` providers (`iec_61131-3_file_export/import`) | untyped IDispatch; `Execute()` returned OK and wrote **0 files** |

So the plugin uses **two effectors**:

- **COM** (`Ade.Application.550`, 32-bit only) for the IDE: project lifecycle,
  the live object model, the compiler, output panes, screenshots.
- **The CFB container writer** (Python, via `code/mw_code.py`) for code: it edits
  the textual `.STB`/`.VB` streams directly, backs up first, verifies the
  untouched sibling streams byte-for-byte, and refuses while the IDE holds the
  project.

That split is forced by measurement, not preference.

## Tools (16)

**IDE — COM**

| Tool | Does |
|---|---|
| `mw_ide_status` | Live instance: version, window, project open |
| `mw_ide_start` | Launch Mwt.exe (needed after a close) |
| `mw_ide_close` | Close and wait until really gone (required before code writes) |
| `mw_ide_stage` | Copy a project into the plugin's own `stage/` |
| `mw_ide_open` | Open a **staged** project in the real IDE |
| `mw_ide_pous` | Live POU list + languages |
| `mw_ide_variables` | Live variable model (name, type, init, address, groups) |
| `mw_ide_make` | `Compile(1)` = `adeCtMake` |
| `mw_ide_build` | `Compile(2)` = `adeCtBuild` + verdict |
| `mw_ide_errors` | Activate the Errors pane and capture it — the only route to error **text** |
| `mw_ide_screenshot` | Capture the IDE window |

**Code — CFB writer**

| Tool | Does |
|---|---|
| `mw_code_pous` | POUs + language + `has_st_body` (the editability test) |
| `mw_code_read_st` | Read a POU's ST body and declarations |
| `mw_code_write_st` | Rewrite an ST body. **dry_run defaults to true** |
| `mw_code_var_add` | Add a variable declaration. **dry_run defaults to true** |
| `mw_code_unsupported` | Name the POUs that cannot be edited safely |

## The coding loop — verified end to end

```
0. mw_ide_stage        copy, 98 files
1. mw_code_pous        6 POUs — 3 ST (editable), 3 LD (not)
2. mw_code_read_st     Axis1.AxisNum := UINT#1; …
3. mw_ide_close        closed
4. mw_code_write_st    dry_run → preview only, nothing changed
5. mw_code_write_st     applied: 80 → 115 bytes, 3 siblings verified, backup taken
6. mw_code_read_st     returned exactly what was written
7. mw_ide_start + open IDE came up, project loaded
8. mw_ide_build        accepted, settled, IsCompiled read
9. mw_ide_errors       1936×1048 capture of the Errors pane
```

## Corrected facts (each measured, each previously wrong)

- **`AdeCompileType` is not 1=Build / 2=Rebuild.** It is
  `1 adeCtMake, 2 adeCtBuild, 3 adeCtPatch, 4 adeCtWorksheet, 5 adeCtDataTypes`.
  There is **no Rebuild compile type** — Rebuild is a command, and
  `ExecuteCommand` is a stub.
- **`ApplicationState` bit 2 is not a usable busy indicator** — it read "idle" 0 s
  into a build that was still running. Completion is now detected by re-offering
  the compile until the IDE accepts it.
- **The IDE titles itself `MULTIPROG - <project>`** when `Mwt.exe` is launched
  directly, which is what automation does. Matching only
  `MotionWorks IEC 3 Pro*` made the plugin blind to an IDE it had just started.
- **Startup creates small auxiliary windows carrying the same caption**, so the
  window search must pick the **largest** match — otherwise "IDE screenshot"
  silently returned a 426×166 sliver.
- **A cached COM proxy outlives the IDE.** After close→reopen it fails with
  `0x800706BA` (RPC server unavailable) until the connection is probed and dropped.
- **Writes need `MOTIONWORKS_MCP_BACKUP_DIR`.** The engine refuses a write it
  cannot back up, and its default `~\.motionworks-iec-mcp` is not writable here
  (`WinError 5`). The plugin points it at its own `backups/`.

## Safety

- **Never downloads to a controller. Never commands motion.** No tool exists.
- **Code tools only ever touch the plugin's own `stage/`.**
  `mw_ide_open` and every code tool pass through a staging guard.
- **Writes default to `dry_run`**, back up first, verify sibling streams unchanged,
  and are refused while the IDE holds the project.
- **Graphical LD/FBD bodies are refused** — proprietary binary, no public grammar.
  `mw_code_unsupported` names them rather than letting the agent promise work it
  cannot do.

## Known limits

- **LD/FBD graphics cannot be authored.** Only transplanted from a known-good
  donor. This is a format limit, not an API limit.
- **Arbitrary menu command driving is unavailable** — `ExecuteCommand` is a stub.
- **Compile error text is only readable as an image.** The output windows expose
  `Activate`/`Clear`/`AddEntry` but no read accessor.
- **`mw_code_var_edit` / `mw_code_var_delete` are not wired yet** — the engine has
  `plan_variable_edit` / `plan_variable_delete`; only `var_add` is exposed.
- **The 48 errors on `RK_DemoOnMP2300Siec` are a library/type-resolution failure**,
  not bad code. The Errors pane says *"Data type declaration or function block code
  body missing!"* — the copied project cannot resolve its libraries. No successful
  compile has been observed yet on this sample.

## Verifying

```powershell
node test/verify.mjs          # structural: loads, 16 tools, JSON Schema, guards
node test/selfcontained.mjs   # must pass with MW_SRC and MW_PYTHON unset
node test/verbs.mjs           # live COM verbs (needs a running IDE)
node test/code_loop.mjs       # the full loop (needs an IDE + a project you own)
```

`code_loop.mjs` takes its project from the environment — `MW_SAMPLE_PROJECT`
(folder or `.mwt`) and optionally `MW_SAMPLE_POU` — so **no sample project ships
with this repository**, and none should be added.
