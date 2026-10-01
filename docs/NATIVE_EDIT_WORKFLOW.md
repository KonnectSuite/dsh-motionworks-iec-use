# Historical native-format findings — not an editing workflow

Superseded by IDE_FIRST_WORKFLOW.md and TOOL_RETIREMENT.md. Public offline editors
are removed, even with legacy opt-in. The following describes private format-test
mechanisms only; never execute it as agent instructions or edit behind an open IDE.
POU deletion was subsequently quarantined after corruption; earlier success is not
evidence that generic offline deletion is safe. Use native IDE lifecycle commands.

This records what was learned by editing disposable copies of expanded MotionWorks IEC
projects and then checking them in MotionWorks IEC 3 Pro. It is not a specification of
every MotionWorks version. A file-level success is **not** an IDE Build/Make result and
is never permission to download to a machine.

## Project boundary

An `.mwt` wrapper points to an expanded project directory. Discover the exact pair,
stage **both** in the calling workspace, and keep the original untouched. Refuse a
wrapper pointing outside the selected staged project. Save and close the named IDE
project before editing. Never edit a project while MotionWorks has it open, even if the
IDE offers to open a second copy. Project identity, closed-IDE state, and workspace
confinement are checked again immediately before a write.

Every write takes a full, hashed before snapshot, acquires a project lock, changes the
staged files, reads them back, validates them, and journals the changed paths. Any
failure restores the entire before snapshot, including hidden/generated files. A
crashed writer leaves its lock and journal for inspection; do not blindly remove it.
After a successful offline edit, inspect the changed-file list and hashes. The caller
still has to reopen the staged wrapper, Build/Make, inspect diagnostics, save, close,
reopen and confirm persistence. Sync-back to the real project is a separate explicit
step after acceptance.

## Native stores and editing rules

| Change | Stores that must agree | Reliable method |
| --- | --- | --- |
| Add/edit/delete POU variable | POU `src.st1` `.VB` declaration and `.VGR` worksheet | Clone a compatible native donor record; update both in one commit; parse and compare read-back. |
| Add/edit/delete global | Resource global `.VB` and `.VGR` | Same paired-store operation, including native address cell and overlap checks. |
| Description | Declaration comment, native translation ID, translation XML | Allocate a fresh ID, XML-escape content, retain unrelated translation items. |
| ST body | `.STB` in `src.st1` | Preserve native control markers and unrelated CFB streams. |
| New POU | Donor POU directory, renamed container streams, project tree/registry/view records | Clone a same-language POU and its native metadata; generate distinct IDs; validate tree and reopen. |
| Delete POU | POU directory and project metadata | Offline deletion is quarantined; use the native IDE command after reference review. |
| Existing-task assignment | Project/task metadata | Use the supported IDE route and read back assignment; compile afterwards. Do not infer generic offline task grammar from one project. |
| Library addition | Library manager metadata and installed `.mwt` | Not currently exposed as an offline tool; use the IDE and verify the project. |

The `.VGR` worksheet has a native header, length-prefixed UTF-16 record cells and a
group trailer. The trailer belongs **after** the final record, even when the group is
empty. A declaration added only to `.VB` can appear in text yet fail with a missing
variable or file error. A record inserted after the trailer can produce file errors
or internal resource-manager errors. Keep native handles, row IDs, usages, group and
addressed/unaddressed layout coherent; worksheet row IDs are not source line numbers.
An omitted initializer inherits the compatible donor value unless the caller supplies
an explicit one.

CFB replacement is first performed into a scratch container. Reopen it and compare
every intended stream plus all untouched sibling streams before committing; then
read back the committed container. This catches the measured CFB stream-growth
failure and the measured one-sided `.VB`/`.VGR` commit failure. Reject unknown record
layouts instead of synthesizing plausible-looking bytes.

Graphical LD/FBD `.GB` is **not** generic ladder text. Cloning a complete native LD
POU was verified; arbitrary contacts, blocks and rung generation are not a supported
plugin capability. A past hand-built LD change could render but refer to missing
symbols until the paired declarations and native caches were synchronized. Build and
reopen, not appearance alone, decide acceptance.

## Batch variable behavior

Private batch-engine tests exercise preview, full rollback and explicit partial
results. No public batch-variable editor remains. Use native declaration worksheets
and verify the exact saved set instead of invoking a historical writer.

## Verification levels

1. Static parser/read-back: paired stores, record/trailer bounds, addresses,
   translations, CFB siblings, project references.
2. Native regression on a disposable copy: add/edit/delete and batch rollback,
   POU clone, exact source hash unchanged. Run `python -B test/native_reference.py
   <expanded-project-directory>` with a compatible user-supplied TopCutter fixture.
3. IDE acceptance: open the staged wrapper, Build then Make where applicable,
   inspect errors and warnings, save, close and reopen. A cached `IsCompiled` flag
   is not a new build result. Native Rebuild is unavailable on the tested IDE 1.19.
4. Bench/field testing: separate from code acceptance; apply machine safety,
   controller download and commissioning procedures. This plugin never downloads or
   moves a controller.

The measured capability matrix and limitations are maintained in
[VERIFICATION_2026-09-30.md](VERIFICATION_2026-09-30.md).
