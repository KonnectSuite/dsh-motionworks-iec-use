# MotionWorks Use

**A DeepSeek Harness plugin that lets an AI agent operate a running Yaskawa MotionWorks IEC 3 Pro IDE — and edit its code.**

![license](https://img.shields.io/badge/license-MIT-blue)
![platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![tools](https://img.shields.io/badge/tools-16-informational)

An agent working on a PLC project normally has two bad options: read the project
files offline (and risk corrupting an undocumented binary format), or click
around a GUI. This plugin gives it a third: drive the IDE through the IDE's own
automation API, edit code through the project container, and get a **real compile
verdict** back.

> **Not affiliated with Yaskawa.** This is an independent interoperability tool.
> It ships no Yaskawa project files, samples, help content or binaries.

---

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Tool reference](#tool-reference)
- [How it works](#how-it-works)
- [API facts worth knowing](#api-facts-worth-knowing)
- [Safety](#safety)
- [Status: what is verified](#status-what-is-verified)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Ask your agent to work on a MotionWorks project and it can:

- **Find the IDE** it should be talking to, and what project is open in it
- **Stage a copy** of a project and open it in the real IDE
- **Read the live object model** — POUs, languages, and every variable with its
  type, initial value, IEC address and group
- **Read and rewrite Structured Text bodies** — this is the "code" part
- **Add variable declarations**
- **Compile** and report the verdict (`IsCompiled`)
- **Read the compiler's errors** — as an image, because the API never exposes them
  as text
- **See the IDE** — screenshots, and bring the Errors pane forward

### What it is not

| | |
|---|---|
| Not a download tool | It will never download to a controller. No such tool exists. |
| Not a motion tool | It will never command motion. No such tool exists. |
| Not a general Windows automation tool | It only ever attaches to `MotionWorks IEC 3 Pro` |
| Not a graphical-logic editor | Ladder/FBD bodies are proprietary binary — see [limits](#known-limits) |
| Not a clicker | It drives the IDE through its automation API, not synthetic input |

---

## Requirements

| | |
|---|---|
| **OS** | Windows. `Mwt.exe` is a 32-bit Windows app; nothing here works elsewhere. |
| **MotionWorks IEC 3 Pro** | Installed and licensed. A trial works, but a trial licence permits **only one instance**. |
| **DeepSeek Harness** | With a profile you can edit (`profiles\desktop` by default). |
| **Node** | ≥ 20. |
| **Python** | **You do not need to install it.** The code engine is stdlib-only and the plugin auto-discovers the interpreter AryaAI already ships. Override with `MW_PYTHON`. |

---

## Install

Two things must line up, and the package name has to match in both.

**1. Make the package resolvable** — clone anywhere and junction it in:

```powershell
git clone https://github.com/KphungFROMM/dsh-motionworks-iec-use.git "$env:USERPROFILE\dsh-plugins\dsh-motionworks-iec-use"

$nm = "$env:USERPROFILE\profiles\desktop\node_modules"
New-Item -ItemType Junction -Path "$nm\dsh-motionworks-iec-use" `
  -Target "$env:USERPROFILE\dsh-plugins\dsh-motionworks-iec-use"
```

**2. Register the bundle** — add it to `dsh.profile.bundles` in
`profiles\desktop\package.json`:

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        // …your existing bundles…
        "dsh-motionworks-iec-use"
      ]
    }
  }
}
```

The third piece — the plugin's row in the composition tree — is contributed by
the package's own `cordis.patch.yml`. Nothing else needs editing.

**3. Restart DSH.** Bundles are read at boot, so the tools will *not* appear in
the session that installed them.

> **If you want the agent to know the workflow**, copy `SKILL.md` into your
> project's `.dsh/skills/motionworks-iec-use/SKILL.md`. The plugin supplies the
> tools; the skill supplies the procedure.

---

## Quick start

The IDE must be **closed while code is written** — it caches project state and
rewrites whole files, so an external edit under a running IDE is discarded. That
single constraint shapes the whole loop:

```
stage  →  read  →  close IDE  →  write  →  reopen  →  build  →  read errors
```

In practice, a session looks like this:

```js
// 1. Copy the project somewhere safe. Only copies are ever touched.
mw_ide_stage   { source: "C:\\Projects\\MyMachine" }

// 2. What is in it, and what is actually editable?
mw_code_pous          // 6 POUs — 3 ST (editable), 3 LD (not)
mw_code_unsupported   // names the ones that CANNOT be edited

// 3. Read the code you are about to change.
mw_code_read_st { pou: "Initialize" }
//   → Axis1.AxisNum := UINT#1;
//     Axis2.AxisNum := UINT#2;

// 4. Preview the change. dry_run defaults to TRUE — nothing is written yet.
mw_code_write_st { pou: "Initialize", body: "...", dry_run: true }

// 5. Apply it. Backs the file up first, verifies the sibling streams are unchanged.
mw_code_write_st { pou: "Initialize", body: "...", dry_run: false }

// 6. Compile it and read the verdict.
mw_ide_start
mw_ide_open { path: "<stage>\\MyMachine.mwt" }
mw_ide_build          // { accepted, settled, is_compiled }

// 7. If it failed, look at what the compiler said.
mw_ide_errors         // → a PNG path; read it with your image tool
```

---

## Tool reference

### IDE tools (COM)

| Tool | Arguments | What it does |
|---|---|---|
| `mw_ide_status` | — | Which IDE is live, its version, and whether a project is open. **Call this first.** |
| `mw_ide_start` | `exe?` | Launch `Mwt.exe`. Needed after a close. |
| `mw_ide_close` | — | Close and wait until it is really gone. Required before any write. |
| `mw_ide_stage` | `source` | Copy a project into the plugin's own `stage/`. Copy only — never moves or deletes. |
| `mw_ide_open` | `path` | Open a **staged** project in the real IDE. |
| `mw_ide_pous` | — | Live POU list with language codes. |
| `mw_ide_variables` | `pou?` | The IDE's live variable model: type, initial value, IEC address, group. |
| `mw_ide_make` | — | `Compile(1)` = `adeCtMake`. |
| `mw_ide_build` | — | `Compile(2)` = `adeCtBuild`, then the verdict. **This is the verification step.** |
| `mw_ide_errors` | `pane?` | Activate an output pane (`Errors`, `Warnings`, …) and capture it. |
| `mw_ide_screenshot` | — | Capture the IDE window. |

### Code tools (project container)

| Tool | Arguments | What it does |
|---|---|---|
| `mw_code_pous` | `project?` | POUs from the files, with `has_st_body` — the **editability test**. |
| `mw_code_read_st` | `pou`, `project?` | A POU's ST body and its declarations. |
| `mw_code_write_st` | `pou`, `body`, `project?`, `dry_run?`, `run_lint?` | Rewrite an ST body. **`dry_run` defaults to `true`.** |
| `mw_code_var_add` | `name`, `type`, `pou?`, `section?`, `address?`, `initial_value?`, `description?`, `project?`, `dry_run?` | Add a variable declaration. |
| `mw_code_unsupported` | `project?` | Name the POUs that cannot be edited safely. |

`project` defaults to the newest staged project, and every code tool refuses a
path outside `stage/`.

---

## How it works

There are **two effectors**, and that is the central design decision — it was
forced by measurement, not preference.

```
        ┌──────────────────────── DSH host (index.js) ────────────────────────┐
        │                                                                     │
        │  req.json / res.json                    req.json / res.json         │
        ▼                        ▼                                            │
  ┌───────────────────┐   ┌──────────────────────┐                           │
  │  32-bit PowerShell │   │  Python (stdlib)     │                           │
  │  bridge            │   │  code engine         │                           │
  └─────────┬─────────┘   └──────────┬───────────┘                           │
            │ COM                    │ CFB container read/write              │
            ▼                        ▼                                       │
  ┌───────────────────┐   ┌──────────────────────┐                           │
  │  Mwt.exe          │   │  <project>/POE/**     │                          │
  │  (the live IDE)   │   │  (the code)           │                          │
  └───────────────────┘   └──────────────────────┘                           │
```

**COM owns the IDE.** MotionWorks registers an out-of-process automation server,
`Ade.Application.550`, and that is what gets driven. It must be driven from a
**32-bit** client — `Mwt.exe` is a 32-bit `LocalServer32`, and a
64-bit client cannot create its objects at all. Hence the PowerShell bridge.

**The container writer owns the code** — because the automation API cannot touch
code. All three candidate COM routes were tried and are closed:

| Route | Result |
|---|---|
| A body accessor on `_Pou` | **does not exist** — 35 members, none is Source/Body/Text |
| `ExecuteCommand(CommandId)` to drive menus | **a stub** — *"The method or operation is not implemented"* |
| `iec_61131-3_file_export` / `_import` providers | untyped IDispatch; `Execute()` returns OK and writes **0 files** |

So code is edited where it lives: the CFB container. The writer touches only the
textual `.STB`/`.VB` streams, **backs up first**, and **verifies the untouched
sibling streams are byte-for-byte identical** before reporting success.

### Why the transport is files, not pipes

A confined harness cannot open named pipes, so a piped child process fails with
`EPERM`. Both bridges exchange JSON through `req.json`/`res.json` with `stdio:
'ignore'`, which works under any sandbox mode. Requests are renamed into place and
replies are matched on an `id`, so a stale answer is never mistaken for a current one.

---

## API facts worth knowing

These were measured against a real install (automation version **1.19**) and
several correct widespread assumptions. They are recorded here because they are
expensive to rediscover — and because at least one is commonly stated wrongly.

### `AdeCompileType` is not what the internet says

```
1 adeCtMake   2 adeCtBuild   3 adeCtPatch   4 adeCtWorksheet   5 adeCtDataTypes
```

The frequently repeated "**1 = Build, 2 = Rebuild**" is **wrong**. `1` is Make and
`2` is Build — and there is **no Rebuild compile type at all**. Rebuild is an IDE
*command* (`adeCmdBuildRebuildProject = 36570`), and since `ExecuteCommand` is a
stub, **Rebuild is not reachable programmatically**.

### Other measured behaviour

- **`ApplicationState` is not a busy indicator.** Bit 2 (`adeASCompiling`) read
  "idle" 0 s into a build that was demonstrably still running. The reliable
  completion signal is to **re-offer the compile until the IDE accepts it** — a
  busy compiler refuses with *"Operation not possible while compiler is running."*
- **The IDE titles itself `MULTIPROG - <project>`** when `Mwt.exe` is
  launched directly, which is exactly what automation does. Match the caption by
  prefix against *both* names.
- **Startup creates small auxiliary windows with the same caption**, so a window
  search must pick the **largest** match — otherwise a "screenshot" silently
  returns a 426×166 sliver.
- **A cached COM proxy outlives the IDE.** After close → reopen it fails with
  `0x800706BA` until the connection is probed and dropped.
- **`OpenProject(Name, ConfirmConvert)` takes two arguments.** Passing one fails
  with *"Cannot find an overload"*.
- **POU language codes:** `1 IL, 2 ST, 3 FBD, 4 LD, 5 SFC, 6 MSFC, 7 FFLD`.
- **Interface sizes:** `_Application` 102 members, `_Project` 43, `_Pou` 35,
  `_Variable` 44, `_Variables` 16, `_VariableGroups` 13.
- **Compile error text is not exposed.** The `OutputWindows` collection has
  `Activate`/`Clear`/`AddEntry` but **no read accessor**, so the only route to the
  messages is to activate the pane and capture it.

The full type-library dump lives in [`docs/tlb_dump.txt`](docs/tlb_dump.txt) and
[`docs/tlb_enums.txt`](docs/tlb_enums.txt), with the scripts that generate them.

---

## Safety

These are invariants, enforced in code — not aspirations.

- **Never download to a controller. Never command motion.** No tool, no bridge
  verb, no helper flag exists for either.
- **Code tools only ever touch the plugin's own `stage/`.** Every path passes
  through a staging guard, so a real project tree cannot be opened for editing.
- **`mw_ide_stage` only copies.** It never moves, renames or deletes a source.
- **Writes default to `dry_run: true`** — the first call is always a preview.
- **Every write is backed up** before it happens, and is *refused* if a backup
  cannot be written.
- **Every write verifies its siblings** are unchanged, and reports the count.
- **The IDE must be closed for a write.** The engine refuses otherwise, because
  the IDE's cached state would discard the edit.
- **Graphical LD/FBD bodies are refused**, never guessed at.
- **Nothing calls `Quit` implicitly.** Your IDE is left as it was found.

---

## Status: what is verified

| Capability | State |
|---|---|
| Detect the live IDE | **Verified** |
| Stage and open a project in the real IDE | **Verified** |
| Read the live POU + variable model | **Verified** (6 POUs, 49 variables on the sample) |
| Read and rewrite an ST body | **Verified** — round-trip returns exactly what was written |
| Write safety (backup + sibling verification) | **Verified** |
| Compile and read the verdict | **Verified** — the verdict is read; see the caveat below |
| Capture compiler errors | **Verified** (image only) |
| Self-contained | **Verified** — passes from a fresh clone with no external paths |
| **A successful compile** | ❌ **never observed** |

**The honest caveat, stated first because it matters most:** every build run so
far has failed, and the cause is **not the code**. The Errors pane reports, 48
times:

```
Data type declaration or function block code body missing!
```

That is a **library / type-resolution failure in a copied project** — the copy
cannot resolve the libraries the project references. So `is_compiled` has only
ever been observed as `false`. The build verbs report `accepted`, `settled` and
`is_compiled` separately precisely so that "compiled and failed" can never be
confused with "never ran".

**If you get a clean build, that is new information — please open an issue.**

---

## Known limits

| Limit | Why | Workaround |
|---|---|---|
| **Ladder / FBD bodies cannot be authored** | Proprietary binary, no public grammar | Transplant a known-good body; `mw_code_unsupported` names them |
| **Compile errors are image-only** | `OutputWindows` has no read accessor | `mw_ide_errors`, then read the PNG |
| **Rebuild is not callable** | It is a command, and `ExecuteCommand` is a stub | `mw_ide_build` (`Compile(2)`) |
| **`mw_code_var_edit` / `_delete` not exposed** | Only `var_add` is wired so far | The engine already has both — see the roadmap |
| **Windows only** | `Mwt.exe` is 32-bit Windows | None |
| **Trial licences allow one instance** | Yaskawa licensing | Close the IDE before launching another |
| **No POU create / delete tools yet** | Not wired | The engine's `pou_writer` is vendored and ready |

**Roadmap, roughly in value order:** expose `var_edit`/`var_delete`, wire POU
creation/deletion/rename/move/language-conversion (all available in the vendored
engine and in COM), then investigate the library-resolution problem above.

---

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Tools don't appear | DSH was not restarted. Bundles load at boot. |
| `no running MotionWorks IDE window; refusing to instantiate` | Correct and deliberate. Instantiating COM without a live IDE would *launch a second one*. Use `mw_ide_start`. |
| `CO_E_SERVER_EXEC_FAILURE` (`0x80080005`) | COM activation was blocked. Under a confined harness the bridge must be started from outside the sandbox — the plugin does this itself, so if you see it, check `bridge/bridge.log`. |
| `The RPC server is unavailable` (`0x800706BA`) | A COM proxy outlived its IDE. Should self-heal; if not, stop and restart the bridge. |
| `IdeRunning: MotionWorks is running …` | A write was attempted with the IDE open. Call `mw_ide_close` first. |
| `WinError 5` on the first real write | The backup directory was not writable. The plugin points it at its own `backups/` — if you see this, that path is not writable. |
| A "screenshot" is tiny | The window search matched an auxiliary window. Should not happen; the search picks the largest. |
| Write says `applied: false` | `dry_run` was in effect. That is the default, not a failure. |

Every bridge request and reply is logged to `bridge/bridge.log` — that file is the
first thing to read when something is wrong.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). It leads with the two things that will
otherwise cost you an afternoon: **why code is not edited through COM** (so you
don't "simplify" the two-effector design away), and the **five safety invariants**
you must not weaken.

```powershell
node test/verify.mjs          # structural — no IDE needed
node test/selfcontained.mjs   # no external paths — no IDE needed
node test/verbs.mjs           # live COM verbs — needs a running IDE
node test/code_loop.mjs       # the whole loop — needs an IDE + a project you own
```

The live tests take their project from `MW_SAMPLE_PROJECT`, so **no sample project
ships with this repository** and none should be added.

## License

[MIT](LICENSE) © 2026 Kim Phung.

Not affiliated with, endorsed by, or sponsored by Yaskawa Electric Corporation.
"Yaskawa", "MotionWorks" and "MULTIPROG" are trademarks of their respective owners
and are used here only to describe what this software interoperates with.
