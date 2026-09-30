---
name: motionworks-iec-use
description: Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code — stage and open a project, read the live object model, read and rewrite POU Structured Text, add variable declarations, compile, and read the compiler's verdict and error text. START HERE: run mw_project_find before anything else, and work only on a project inside the workspace — never on one from elsewhere on the machine, even if you know where it is. Use when the user wants the agent to actually drive MotionWorks IEC rather than only inspect files. Never downloads to a controller and never commands motion.
whenToUse: The user has MotionWorks IEC 3 Pro open or asks for work in it — a real build, a compile verdict, the live project model, reading or changing POU Structured Text, or reading the IDE's error list. ALSO USE WHEN a MotionWorks project is mentioned at all, even to ask a question about it, because the first step is always to find which project is actually in the workspace. For pure offline `.mwt` inspection without the IDE, the file-level tools alone are enough.
---

# MotionWorks IEC workspace editing

Use the installed tools for discovery, staging, offline editing and IDE verification.
The workflow below replaces historical workarounds based on incomplete grid parsing.
A successful file write is offline evidence only. Report native IDE acceptance separately.
Never download a project, start a controller, or command machine motion.

## Select and bind the project

1. Run `mw_project_find` first. Discovery is confined to the calling session workspace.
2. If no project exists there, ask the user to provide the project in that workspace.
   Do not search Desktop, Downloads, other chats, or remembered paths for a substitute.
3. Select the intended `.mwt` and its expanded directory. If several exist and intent
   cannot be determined from the request, clarify which one is intended.
4. Call `mw_ide_stage`. It copies both into `<workspace>/.motionworks/stage/`, rewrites
   the wrapper binding and records source identity. Edit this workspace copy.
5. Pass the selected project explicitly when multiple staged copies exist. Opening
   validates the wrapper's embedded directory and its digest before the bridge acts.

The session header determines the workspace. The DSH profile and plugin installation
folder are not project workspaces. Missing context is a refusal, not an invitation to
fall back to the shell directory. Shared plugin-stage projects from older versions are
not eligible. Another open IDE project is not authorization to edit, save or build it.
Outside references may be inspected using explicitly read-only reference tools; they
must never become the opened or edited target. Do not bypass these guards with COM,
shell scripts, hard-coded project paths, or copied examples from reference documents.
Exports and backups also belong inside the workspace.

## Inspect before changing

Inventory POUs, read the relevant declarations and bodies, and inspect globals and tasks.
`mw_code_validate` checks readable containers, paired declaration/grid records, unique
handles and worksheet rows, supported direct-address overlaps, and tree IDs/counts.
It reports errors instead of silently repairing an unknown layout. Existing segmented
runtime memory addresses are preserved; their aliasing is not proven by this validator.
Static validation does not establish every task binding, external library, graphical
connection, or machine behavior. Capture baseline errors before deciding what to change.

The expanded directory is the source, not the small `.mwt` wrapper. A POU container
holds `.VB` declarations and `.VGR` worksheet records as redundant stores. ST bodies
are `.STB`; graphical LD/FBD bodies are `.GB`. Additional XML stores descriptions and
worksheet identities. Never replace one redundant store and call the variable usable.
Never edit generated `tmp.sto` as a substitute for changing the native source.

## Close, preview, commit

Use `mw_ide_close` before offline mutations. The bridge first proves the open project's
workspace identity, saves it, and requests a graceful native close. It does not force
kill the process. If a modal dialog prevents closing, inspect `mw_ide_state`, resolve
only the relevant authorized dialog and verify closure before continuing. Write tools
refuse a running IDE; environment flags cannot make them silently kill it.

Write tools default to `dry_run: true`. A preview changes no project bytes and does not
close the IDE. Read the plan and any refusal. Execute the intended change with
`dry_run: false` once its scope matches the user's request; routine previews do not
require a new human approval. Do not invent a project format to bypass a refusal.

Actual dispatched mutations take a complete snapshot under
`<workspace>/.motionworks/transactions/`, verify its hashes, and hold an exclusive
per-project lock. The journal records changed files, before/after hashes and offline
validation. A failed operation restores the previous file set and verifies it.
Backups have unique names so successive operations cannot overwrite recovery evidence.
A crash or failed rollback retains its lock and journal. Do not delete the lock to
force another write: inspect the recorded state and recover the snapshot with the IDE
closed. Automatic crash recovery is not implemented. Retain the journal path in the
user-facing failure report when recovery is required.

## Promoting the stage back, and the wrapper

The release loop is close IDE -> edit the stage -> build -> copy back -> re-stage -> verify.
`mw_code_sync_back` is the copy-back step, and it takes its destination from the source
directory `mw_ide_stage` recorded rather than from a convention:

- It carries SOURCE ONLY - POU containers (`src.st1`), declaration and grid streams, the
  project tree, the type list, the resource files. It never carries the `.mwt` wrapper, whose
  stored path is bound to the stage and would point the real project at a temporary copy of
  itself, and it never carries compiler output (`.DLL`, `.pdb`) or scratch files. An inclusion
  rule, not an exclusion list: an unlisted new build artifact is simply not carried.
- Every file is verified by sha256 after the copy. A non-empty `failures` means the release is
  NOT synced even though the call returned.
- `dry_run` defaults to true. Read `would_copy` before applying.

If `mw_ide_open` refuses a wrapper as not bound to the staged project, do NOT re-stage: that
overwrites the stage and takes any POU created since with it. Call `mw_code_wrapper_binding` to
see which wrapper is stale and whether re-binding clears it, then `mw_code_rebind_wrapper`. That
is idempotent, so it is safe to call when already bound; it reports `would_change: false` and
leaves the file digest unchanged.

A POU that is assigned to no task never runs, and a clean build does not prove otherwise - a POU
containing an undeclared variable compiled cleanly while unassigned. `mw_code_tasks` lists the
unassigned set; `mw_code_write_st` and `mw_code_pou_create` attach an `unassigned_warning` when
their target is in it. Assign the program in the MotionWorks Project Tree, then re-run
`mw_code_tasks` to confirm. A build attempted while a POU is unassigned can stall for ~90 s and
end with an empty Errors pane, which is not a clean result.

To ask whether an interface has room for another status value, use `mw_code_eip_map` rather than
reconstructing the address arithmetic: it reads the declared assembly size from the L5X and the
used range from the project's own `%I`/`%Q` addresses. `next_free_word_address` is arithmetic over
what was read, not a claim that the peer program leaves that word alone - confirm the offset on
the CompactLogix side before writing it.

## Variables and descriptions

Declaring several variables at once: use `mw_code_var_add_many` rather than repeating
`mw_code_var_add`. It takes an array of `{name, type, section?, address?, initial_value?,
description?}` and applies each item on its own, so a bad item does not discard the good ones:
read `failures`, which names each rejected item by index and reason, and re-issue only those.
A partial batch is a normal outcome, not an error.

`mw_code_var_add`, `mw_code_var_edit` and `mw_code_var_delete` update `.VB` and `.VGR`
together and verify all replaced streams and untouched siblings. The last record ends
after its fixed native tail; the following group trailer must stay in place. Worksheet
row IDs are native identifiers, not declaration text line numbers.

Use an existing native variable as donor. The donor must match type, usage, group and
addressed versus unaddressed layout. Specify `donor` when hidden record fields differ.
For an empty local worksheet, `donor_pou` can supply a compatible Default-group donor
from the same project. Supported usages are local VAR, VAR_EXTERNAL and VAR_GLOBAL;
unknown usages/layouts are refused. Function-block instances retain native usage flags.
An omitted initializer inherits the donor initializer explicitly in both stores; set
`initial_value` when another value is intended. Do not assume the donor was initialized
to zero. Global variables use the resource grid too and are no longer text-only edits.

Descriptions update the declaration comment, a fresh native translation ID, and the
matching translation XML. Existing translation items are retained because they may be
shared. New variables do not reuse another variable's description ID. Type or address
layout changes need a compatible donor; unsupported segmented address edits are refused.
Known existing system memory bindings are preserved. Referenced renames/deletions are
refused even with the legacy force argument. Remove or safely restructure references
first; there is no automatic whole-project symbol rename.

## POUs and graphical code

`mw_code_pou_create` clones a compatible native template in the same staged project.
It preserves local, external and function-block declaration semantics, renames streams,
allocates GUIDs and node IDs, and updates tree counts, registry and view entries.
It does not convert external variables into unrelated local variables. Compatible
variable additions to cloned POUs use the same paired-store editing path as originals.
There is no blanket rule that a cloned POU must never receive another declaration.

For ST, `mw_code_write_st` preserves native leading control markers and checks source
read-back plus sibling streams. Lint is useful but is not the MotionWorks compiler.
For LD/FBD, clone a known native graphical POU and preserve the complete donor layout.
Arbitrary graphical rung generation is not implemented. The supplied five-object rung
example was specific to one binary profile and must not be generalized to unknown FBs.
The internal donor transplant helper is not a public supported tool. Offline task-node
and library creation are not generalized from fixed-record examples; use existing
supported IDE operations and report format refusals. Never claim unsupported edits ran.

## IDE acceptance after edits

1. Validate the changed project offline and open the exact staged wrapper.
2. Use `mw_ide_build` for Compile(2), which is Build. Make is Compile(1).
   Native Rebuild is a separate command and was not accepted on the installed 1.19 IDE.
3. Inspect the returned verdict, `mw_ide_state`, and `mw_ide_errors`. A posted command
   or cached IsCompiled flag alone does not prove this invocation completed. The bridge
   requires an observed pending-to-compiled transition. If completion cannot be observed,
   it reports unverified; inspect the IDE instead of fabricating a clean verdict.
4. Run Make, inspect errors and warnings, save, close gracefully, reopen the same
   wrapper and inspect the changed declarations/body, task bindings and project state.
   Repeat Rebuild/Make when establishing persistence acceptance for a completed change.
5. Report exactly which checks completed, their evidence and any remaining errors.

Native menu automation is version-dependent and can be blocked by dialogs. The bridge
checks the Rebuild command ID before posting it. A failed compile does not trigger disk
repair underneath the running IDE. Close safely before restoring a verified backup.
Empty Errors output is not proof of a successful compile. Compiler acceptance is not
machine commissioning, safety validation, or proof that hardware motion is correct.

## Programming references and review

Use `mw_code_reference` before choosing unfamiliar FB pins, variable scope, startup
semantics or task behavior. Omit query to list the reviewed sources; `block` retrieves
one of six reviewed historical interfaces. Return the source revision and page with
advice. Confirm installed IDE, controller and library versions before treating an old
manual interface as authoritative. Native project FB declarations take precedence.
Do not infer pin direction from a caller declaration or guess an unknown interface.

`mw_code_reference_sync` optionally downloads the official catalog PDFs into this
workspace's `.motionworks/references`; it sends no project data. It requires pypdf
and network access. Curated search remains available offline. A source-hash mismatch
requires catalog review, not bypassing the check. Installed legacy manual extraction
is heuristic and must not be presented as a verified source revision.

Call `mw_code_check_program` for existing ST or pass `pou` and proposed `body` before
writing. Check scope/type/range findings, named FB arguments and task candidates.
Read coverage and unresolved interfaces as well as error counts. A missing instance
name match does not prove a program never runs. Preserve native task execution order;
inspect actual bindings, startup/cyclic context and timing in the IDE. The ST writer
also includes this advisory review in preview and commit responses. It supplements
existing validation and compiler acceptance, and performs no automatic repairs.

Pass exact diagnostic text to `mw_code_diagnose`. Its documented causes are candidates,
not diagnoses proven by the message alone. Correlate with source locations, types,
library versions and current IDE state. Unknown diagnostics remain unresolved.

Use `mw_code_pattern` for initialization, request edges, nonblocking cyclic sequencing
and Enable/Valid position feedback. Read its assumptions and adaptation checks before
using declarations or ST. These are illustrative examples requiring native compilation;
they do not assign tasks or establish safe machine behavior. Consult
`docs/PROGRAMMING_KNOWLEDGE.md` for versions, supported checks and limitations.

## Delivery report

Summarize the changed workspace project and files, transaction journal, offline checks,
IDE acceptance actually observed, and remaining limitations. The staged copy is the editable
deliverable; promote it to the source project only when the user asks, and do it with
`mw_code_sync_back` so the promotion carries source only and is verified by hash - not with a
blanket directory copy, which drags compiled output over the real project. Reload the AryaAI DSH
plugin after changing its installed code so updated tool schemas and bridge logic are used.
Restart a stale bridge when its protocol version is refused; never weaken the workspace checks
to retain an old bridge.
