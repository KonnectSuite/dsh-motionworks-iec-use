# Workflow adaptation and verification

The supplied MotionWorks IEC Offline Editing Workflow and MotionWorksTools scripts were
reviewed as reference evidence. Their project-specific absolute paths and fixed node/row
counts were not adopted. Source ZIP data stays in the unshipped `.workflow-reference` folder.

Implemented: bounded native variable records, trailer preservation, matching donors,
paired declaration/grid edits, descriptions/translation IDs, ST control-marker preservation,
POU clone semantics and view entries, workspace-bound backups/exports, full snapshot rollback,
static validation, graceful close and a separate native Rebuild request.

The supplied native data also uses blank binary initializer cells for explicit primitive
zero/FALSE initializers. Validation accepts these equivalents. It preserves segmented system
memory addresses without claiming to prove their aliasing; edits to unknown address dialects
are refused. A donor's initializer is inherited explicitly when none is supplied.

The regression suite covers malformed counts, duplicate rows, last-record insertion/deletion,
variable-length edits, native usages, overlaps, lock contention, unique snapshots, injected
failures and rollback. Native reference tests work on disposable copies and hash the supplied
source before/after. They do not launch the IDE or prove Rebuild/Make acceptance.

Native Rebuild uses the runtime-resolved adeCmdBuildRebuildProject command only when it
matches the known ID 36570. Posting WM_COMMAND is request evidence, not completion evidence.
Only an observed pending-to-compiled transition settles the bridge verdict. Fast builds whose
transition is missed report unverified. Always inspect diagnostics and save/reopen persistence.
This bridge route needs live acceptance on the installed IDE version.

No generic binary LD grammar, fixed-layout library insertion, or offline task-node assignment
was inferred from one successful project script. A graphical native POU can be cloned. The
internal transplant helper remains unexposed. Crashed transaction locks remain for inspection;
automatic crash recovery is not implemented. Journals and complete before snapshots provide
recovery evidence. Never remove a lock while its writer is active.
