# Contributing

Thanks for considering it. This is an interoperability tool for an industrial
IDE, so the bar for *not breaking someone's project* is higher than usual — read
the invariants below before changing anything.

## Read these two first

1. [README.md](README.md) — what the plugin does and the API facts behind it.
2. [SKILL.md](SKILL.md) — the agent-facing contract. If you change a tool's
   behaviour, this file changes in the same commit.

## The one design decision you must not undo

**Code is not edited through the IDE's automation API, because that API cannot
touch code.** Three COM routes were tried and are closed:

| Route | Result |
|---|---|
| a body accessor on `_Pou` | does not exist (35 members, none is Source/Body/Text) |
| `ExecuteCommand(CommandId)` | a stub — *"The method or operation is not implemented"* |
| `iec_61131-3_file_export` / `_import` | untyped IDispatch; `Execute()` returns OK, writes 0 files |

So the plugin has **two effectors**: COM for the IDE, and a CFB container writer
for code. If you find a genuine COM path to code bodies, that is a significant
discovery — please open an issue with the reproduction before restructuring.

## Invariants — do not weaken these

1. **Never download to a controller. Never command motion.** No tool, no bridge
   verb, no helper flag. A PR that adds one will be rejected regardless of merit.
2. **Code tools only ever touch the plugin's own `stage/`.** Every path passes
   through the staging guard. Do not add a way to point them at a real project.
3. **Writes default to `dry_run: true`**, back up first, verify the untouched
   sibling streams byte-for-byte, and refuse while the IDE holds the project.
4. **Graphical LD/FBD bodies are refused**, never guessed at. They are proprietary
   binary with no public grammar; only transplant from a known-good donor.
5. **Never report a success you did not observe.** The build verbs report
   `accepted` / `settled` / `is_compiled` separately on purpose — "compiled and
   failed" must never be confused with "never ran".

## Development setup

Requirements:

- **Windows.** `Mwt.exe` is a 32-bit Windows app; nothing here works elsewhere.
- **MotionWorks IEC 3 Pro** installed, for anything beyond the structural tests.
- **Node ≥ 20** to load the plugin.
- **Python 3** for the code engine — but you do not have to install one. The
  engine is stdlib-only (`win32com` is imported lazily inside a single function
  in `ide.py`), and the plugin auto-discovers the interpreter that ships with
  AryaAI. Override with `MW_PYTHON` if you want a different one.

Install it into your DSH profile the same way any local bundle is installed:

```powershell
# 1. make the package resolvable
$nm  = "$env:USERPROFILE\profiles\desktop\node_modules"
$src = "C:\path\to\this\repo"
New-Item -ItemType Junction -Path "$nm\dsh-motionworks-iec-use" -Target $src

# 2. register the bundle — add "dsh-motionworks-iec-use" to `dsh.profile.bundles`
#    in profiles\desktop\package.json
```

Restart DSH. Bundles are read at boot, so the tools will not appear until then.

## Tests

```powershell
node test/verify.mjs          # structural: loads, 16 tools, JSON Schema, guards
node test/selfcontained.mjs   # must pass with MW_SRC and MW_PYTHON unset
node test/verbs.mjs           # live COM verbs — needs a running IDE
node test/code_loop.mjs       # full loop — needs a running IDE + a project you own
```

`code_loop.mjs` takes a project from the environment, so no sample project is
needed in the repo and none should ever be added:

```powershell
$env:MW_SAMPLE_PROJECT = "C:\path\to\MyProject"   # folder, or the .mwt
$env:MW_SAMPLE_POU     = "MyStPou"                # optional, default Initialize
```

**Run `verify.mjs` and `selfcontained.mjs` in every PR.** The live tests need a
licensed IDE and real hardware-adjacent state, so say in the PR which ones you
ran and which you could not.

## The vendored engine

`code/engine/motionworks_iec_mcp/` is a **copy** of an engine that also exists in
another project. It is vendored so this plugin is self-contained.

- If you change engine behaviour, change it **upstream first**, then re-vendor —
  do not let the two diverge silently.
- ⚠ **Before publishing this repository, confirm you hold the rights to license
  the vendored engine.** It currently carries no per-file license header, and the
  root `LICENSE` covers the repository as a whole. Decide deliberately, and add
  per-file headers if the engine needs different terms from the plugin.

## The type-library dumps

`docs/tlb_dump.txt` and `docs/tlb_enums.txt` are generated from the IDE's
`Ade.tlb` and are the authoritative reference for the automation API — the
`AdeCompileType` mapping that corrects the widespread "1 = Build, 2 = Rebuild"
folklore came from here.

Regenerate with **32-bit** Python (the type library is 32-bit):

```powershell
$py32 = "C:\path\to\32bit\python.exe"   # needs pywin32
& $py32 docs\tlb_dump.py   > docs\tlb_dump.txt
& $py32 docs\tlb_enums.py  > docs\tlb_enums.txt
```

These dumps are factual interface information (member names, arities, enum
values). If you are uncomfortable shipping a dump derived from a vendor binary,
they are generated files and can be excluded — but please keep the *conclusions*
in the README either way.

## Style

- Match the surrounding code. The comments explain **why**, usually recording the
  measurement that forced the decision — keep that habit, it is the most valuable
  thing in this repository.
- No new package imports in `index.js`. A profile plugin cannot resolve
  `@deepseek-ai/*` (measured: `MODULE_NOT_FOUND`), so it uses only `node:`
  builtins and registers plain JSON Schema. `required` must be an **array** —
  the inline `required: true` form is `defineTool`'s spec DSL and will silently
  not be enforced here.
- Test `verify.mjs` asserts the schema shape; run it after touching any tool.

## Reporting bugs

Include, in order of usefulness:

1. The **exact tool call** and its JSON reply.
2. `bridge/bridge.log` — it records every request/response pair.
3. Your MotionWorks version (`mw_ide_status` reports it) and Windows version.
4. Whether the IDE was launched by you or by `mw_ide_start`. The caption differs
   (`MotionWorks IEC 3 Pro - X` vs `MULTIPROG - X`) and that has broken the window
   search before.

**Never paste a customer project** into an issue. Redact paths and POU contents,
or reproduce with a throwaway project.
