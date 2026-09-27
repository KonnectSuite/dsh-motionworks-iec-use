# WORKFLOW — MotionWorks IEC

How to drive MotionWorks IEC 3 from this plugin. Three workflows: editing an existing
project, authoring a new program, and recovering when something goes wrong.

Everything here is **build-verified** — each claim was measured by compiling a real project and
reading the IDE's own verdict, not by inspection.

---

## 0. The safety model

**Always work on a staged copy.**

```
mw_ide_stage { source: "C:\\path\\to\\Project.mwt" }
```

This copies the project into the plugin's stage directory and works there. **The file you named is
never modified.** Everything downstream — open, edit, build, save — happens on the copy. When you are
done, the staged project is yours to copy back or discard.

If you skip staging and point the IDE at a live project, every guardrail below still applies but you
have no undo.

**One IDE at a time.** The IDE is a licensed application and a trial permits a single instance. If
one is already running, connect to it rather than launching another.

---

## 1. Workflow A — editing an existing project

Fully supported. This is the path to use when the POUs already exist.

### Open

```
mw_ide_stage { source }        copy to the staging area
mw_ide_start                   launch the IDE on the staged copy
mw_ide_open  { path }          load it
```

On a trial licence the IDE shows a licence dialog first. `mw_ide_trial` handles it; `mw_ide_dialog`
reports whether any dialog is still waiting.

### Read

| tool | gives you |
|---|---|
| `mw_code_pous` | every POU on disk |
| `mw_code_read_st { pou }` | a POU's body **and** its declarations with types |
| `mw_code_globals` | the project's global variables |
| `mw_code_tasks` / `mw_code_task_model` | tasks, and which programs are assigned to them |
| `mw_code_types` | ~297 data types |
| `mw_code_library` | library members |
| `mw_code_manual { term }` | search the IDE's own PDF manuals |

`mw_ide_variables { pou }` asks the **running IDE** instead of the files — use it to confirm the IDE
agrees with what you wrote.

### Edit

| tool | does |
|---|---|
| `mw_code_write_st { pou, body }` | replaces a POU's body |
| `mw_code_var_add { pou, name, type, section }` | adds a declaration to an **existing** POU |
| `mw_code_var_edit { pou, name, ... }` | renames or retypes a declaration |
| `mw_code_var_delete { pou, name }` | removes a declaration |
| `mw_code_task_create / mw_code_task_delete` | add or remove a task |
| `mw_code_pou_assign / mw_code_pou_unassign` | put a program into a task, or take it out |

**All of the above are build-verified on existing POUs.** `mw_code_var_add`, `var_edit` and
`var_delete` will refuse if any POU still references the declaration — remove the references first,
or the tools are protecting you from a compile error.

### Build and save

```
mw_ide_build          compile; returns the verdict
mw_ide_errors         all four panes: Errors, Warnings, Infos, Build
mw_ide_save           write the staged project back to disk
```

---

## 2. Workflow B — authoring a new program

For *"write me a program that does X"*. Seven steps.

```
1  mw_code_pou_create { name, template }
2  mw_code_read_st    { pou }        see what it inherited
3  mw_code_write_st   { pou, body }  write against THOSE declarations
4  mw_code_pou_assign { task, pou }  ← without this it is never compiled
5  mw_ide_build
6  mw_code_tasks                     confirm the assignment stuck
7  mw_code_pou_unassign → mw_code_pou_delete    clean up
```

### Step 1 is the design decision

A POU cannot be authored from nothing — it is cloned from a template, and it **inherits that
template's declarations**. So **choosing the template is choosing the program's variable set.**

Pick a template that already declares what the program needs. A clone of `TopCutterCamSetup`
arrives with 12 declarations — globals and locals — ready to use.

### Step 3 is where the program is written

The body uses the inherited declarations directly. **Nothing needs to be added.** This is the path
that compiles.

### Step 4 is not optional

**An unassigned POU is never compiled.** A green build while your new POU sits unassigned is
evidence of nothing — it was never looked at. Assign first, then build.

### What a created POU cannot do

**Adding a new declaration to it stalls the build.** Measured 28 times out of 29, for every kind of
body — including one that never mentions the declaration. The failure is silent and delayed: the add
reports success, the declaration reads back correctly, and the stall only appears at the next build
with an **empty Errors pane**.

`mw_code_var_add` therefore **refuses** on a created POU and names the three alternatives:

1. choose a template that already declares what you need — the supported path
2. add the declaration to an **existing** POU
3. add it once in the MotionWorks editor, then edit the POU from here

---

## 3. The three guardrails

Things that will stop you. Two are refused by the tools; one stalls silently.

### 3.1 A type error destroys the POU — refused

```iecst
TopCutterCamReady := TopCutterCamTableID;     (* BOOL := UINT *)
```

The compiler does not report this. It **destroys the POU**: `.VB` to 0 bytes, the resource grid to
79 MB. A type-correct body with a different fault merely stalls and leaves the POU intact.

`mw_code_write_st` refuses a type error, naming the line and both types:

```
line 1: assigning a INTEGER to 'TopCutterCamReady', which is BOOL - a type error makes the
build DESTROY this POU rather than report it, so the body is refused
```

The check is deliberately narrow. A false refusal would block correct code, so it only flags
assignments whose right-hand side type is known with confidence and whose family differs.
`INTEGER` → `REAL` is allowed; the reverse is caught; an unknown right-hand side is left alone.

**This is almost certainly what "the first attempt corrupted the project" was.**

### 3.2 Reading a `VAR_EXTERNAL` global stalls — stalls silently

```iecst
xSelect := TopCutterCamReady;      (* a READ of a global    → STALLED *)
TopCutterCamReady := TRUE;         (* a WRITE to a global   → CLEAN   *)
xSelect := TRUE; iState := iState + 1;   (* locals only     → CLEAN   *)
```

Correctly declared, correctly typed, and it stalls. **Prefer POU-local declarations in bodies.**
This is the third face of one rule: a global referenced without `VAR_EXTERNAL` stalls, a global
added by this plugin stalls until the grid carries it, and a global correctly declared still stalls
when it is read.

### 3.3 Adding a declaration to a created POU — refused

See step 1 of workflow B above.

---

## 4. What "done" looks like

**`is_compiled=true` is the only real evidence.** The four states:

| state | meaning |
|---|---|
| `accepted=false` | the build was never run |
| `is_compiled=true` | **clean** |
| `is_compiled=false`, `is_modified=false` | **rejected** — the compiler refused it, and said why |
| `is_compiled=false`, `is_modified=true` | **stalled** — the compiler produced no verdict at all |

**A stalled build with an empty Errors pane is the signature of a guardrail**, not of a syntax error.
Check §3.

**And remember the ordering trap:** build → unassigned POU → green → you conclude it works. It was
never compiled. **Assign, then build.**

---

## 5. When the IDE wedges

The IDE can end up holding a project it cannot open, reporting `Internal error in OpenProject`.

```
mw_ide_close                       close cleanly through the plugin
taskkill Mwt                       only if that did not work
mw_ide_start                       launch fresh
mw_ide_open { path }               reopen
```

**Never kill `node` or `powershell` by name on this machine.** The harness runs on them; killing
them takes the harness with it. Use the bridge's own `stop` verb, or `mw_ide_close`.

If re-staging fails because the IDE is holding the stage directory, close the IDE and retry after a
few seconds.

---

## 6. Tool reference

<details>
<summary>All 36 tools</summary>

**IDE lifecycle** — `mw_ide_status` · `mw_ide_start` · `mw_ide_open` · `mw_ide_close` ·
`mw_ide_stage` · `mw_ide_save` · `mw_ide_trial` · `mw_ide_state` · `mw_ide_dialog` ·
`mw_ide_screenshot`

**Build and diagnostics** — `mw_ide_build` · `mw_ide_make` · `mw_ide_compile_state` ·
`mw_ide_errors`

**Reading** — `mw_code_pous` · `mw_code_read_st` · `mw_code_globals` · `mw_code_types` ·
`mw_code_library` · `mw_code_manual` · `mw_ide_pous` · `mw_ide_variables` · `mw_code_export_pou`

**Writing** — `mw_code_write_st` · `mw_code_var_add` · `mw_code_var_edit` · `mw_code_var_delete` ·
`mw_code_pou_create` · `mw_code_pou_delete`

**Tasks and assignment** — `mw_code_tasks` · `mw_code_task_model` · `mw_code_task_create` ·
`mw_code_task_delete` · `mw_code_pou_assign` · `mw_code_pou_unassign`

**Other** — `mw_code_unsupported`

</details>

---

## 7. How this was verified

Four suites, all green:

| suite | covers |
|---|---|
| `test/capability_matrix.mjs` | 13 operations, each followed by a real build |
| `test/author_program.mjs` | workflow B end to end |
| `test/tool_sweep.mjs` | 12 IDE-facing behaviours |
| `test/tool_coverage.mjs` | every one of the 36 tools, plus a rule that a tool cannot ship untested |

Run any of them with:

```
MW_PLUGIN=<installed plugin path> node test/<suite>.mjs
```

The guardrail tests keep their run counts so the claims can be re-measured rather than believed:
`test/stall_rate.mjs` (five identical runs), `test/added_decl_rule.mjs` (three per variant),
`test/global_write.mjs` (the read-versus-write table).

---

## 8. Known open question

**Whether `mw_code_var_edit` and `mw_code_var_delete` also stall a created POU is unmeasured.**
They are verified on existing POUs; whether the §3.3 guard needs to cover them as well is not yet
known. Probing it has failed twice for test-construction reasons rather than because of anything in
the plugin, and the answer would only widen a guard, not change a workflow.
