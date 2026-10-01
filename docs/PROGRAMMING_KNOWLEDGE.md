# Versioned MotionWorks programming knowledge

Current workflow: IDE-first editing, read-only offline review, and guarded native
Build/Make verification. Read ENGINEERING_WORKFLOW.md for engineering decisions;
IDE_FIRST_WORKFLOW.md governs editing. Historical tests are not current capability promises.

## Tools and working sequence

| Tool | Purpose |
| --- | --- |
| `mw_code_reference` | Search original summaries offline, list sources, retrieve a reviewed FB interface, or search locally indexed PDF pages. |
| `mw_code_reference_sync` | Download four allowlisted official PDFs and build page indexes inside the current workspace. Optional `source_ids` selects a subset. |
| `mw_code_check_program` | Review existing ST or a proposed `body` for a specified `pou`, without writing it. |
| `mw_code_diagnose` | Map exact diagnostics to cited candidate causes and checks. Unknown messages remain unknown. |
| `mw_code_pattern` | Retrieve declarations, ST, assumptions and adaptation checks for four original examples. |

Discover and attach to the exact verified open stage; stage only when needed. Inspect native declarations,
resource globals, library identities and task instances. Retrieve the relevant
reference before choosing types, pins or execution semantics. Review proposed ST,
then implement through the native IDE editor, Save All and read back the intended change.
The offline editor tools are retired; static review never writes the program.
Run fresh Build/Make and inspect the actual compiler diagnostics. Reopen only with
exact-project consent and repeat Build/Make to establish persistence acceptance. Feed exact
diagnostics into the diagnostic tool; a candidate explanation is not a confirmed cause.

## Reviewed sources

Catalog review date: 2026-09-27. PDF page numbers are physical, one-based pages;
printed page labels can differ. Every retrieved topic carries its source, document
ID, revision, section, page references and official link. The catalog records SHA-256
and page count for each reviewed PDF.

| ID | Official source | Reviewed revision | Pages |
| --- | --- | --- | --- |
| basics | [IEC 61131-3 Basics with MotionWorks IEC](https://www.yaskawa.com/delegate/getAttachment?cmd=documents&documentId=TRM011-MotionWorksIEC-Basic&documentName=TRM011-MotionWorksIEC-Basic.pdf) | 1.10, 2014-03-06 | 197 |
| plcopen | [PLCopenPlus Function Blocks for Motion Control](https://www.yaskawa.com/delegate/getAttachment?cmd=documents&documentId=YEA-SIA-IEC-3&documentName=YEA-SIA-IEC-3_PLCopenPlus_2013-04-13.pdf) | 2013-04-13; cover 2013-04-12 | 396 |
| toolbox | [MotionWorks IEC Toolbox Manual](https://www.yaskawa.com/delegate/getAttachment?cmd=documents&documentId=TM.MWIEC.01&documentName=TM.MWIEC.01.pdf) | Help created 2023-11-14 | 913 |
| quick | [MPiec Series Quick Reference Guide](https://www.yaskawa.com/delegate/getAttachment?cmd=documents&documentId=QRG.MP2000iecSeries.01&documentName=QRG.MP2000iecSeries.01.pdf) | 3.4; catalog date 2016-12-05 | 24 |
| native-code | Yaskawa FAQ CNT-IWLS4T | Retrieved 2026-09-27 | Web |
| io-range | Yaskawa FAQ MTN-9GAU5W | Retrieved 2026-09-27 | Web |

The catalog includes 22 original topic summaries. The six reviewed historical
interfaces are MC_MoveAbsolute, MC_MoveRelative, MC_Power, MC_ReadActualPosition,
MC_Reset and MC_Stop. These are not automatically matched to installed libraries.
Native project-defined interfaces take precedence. An unknown library interface
is reported unresolved; never infer pin direction from a caller's variable table.
The 2013 manual's MC_Power Enable_Positive, Enable_Negative and BufferMode pins
are documented as unsupported in that edition. Check the installed help before
relying on them. MC_Power exposes Status rather than Done; MC_Reset Done alone
does not establish that all alarms have cleared.

## Checks and their limits

- Match POU externals against resource global names and types; flag local shadowing.
- Check integer initializers and simple assignments against declared ranges and
  identify direct elementary-type conversions needing review.
- Check resolved named FB argument names, duplicates, direction and simple types;
  inspect in-out constants, constant Execute, repeated calls and Error references.
- Report program names without matching task instance names as candidates.
  Preserve task execution order. Instance names may differ from program types;
  timing, priorities, watchdog values and indirect calls still need inspection.

Concrete native interface violations and integer overflows can be errors.
Historical interface findings remain warnings. The review is not a full IEC parser,
type checker, data-flow analysis or compiler: complex expressions, aliases, nested
structures, arrays and unavailable libraries need native validation. It does not
analyze graphical bodies. Multiple-resource global scope is reported unresolved.
Zero findings does not mean every symbol, interface or execution path was checked.

Diagnostics cover native-code generation, address/driver range problems, external
scope, incompatible types, selected axis errors, watchdog overruns and uncertain
IDE completion. Rules return source-linked hypotheses; they never reset axes,
relax watchdogs, rewrite interlocks or automatically repair a project.

## Reusable examples

The four patterns are `startup-initialization`, `request-edge`, `cyclic-sequence`,
and `cyclic-position-reader`. They are original illustrative ST, not copied vendor
implementations or commissioned machine logic. Each includes prerequisites and
checks. Bind startup code to the intended warm/cold task; preserve intentional
retention. Keep cyclic sequences nonblocking and add project-approved timeout
handling. Call feedback FBs cyclically and consume outputs under Valid/Error rules.
Examples require project-specific declarations and native compilation after adoption.

## Retrieval, privacy and maintenance

Curated topics, interfaces and patterns need no network or additional Python package.
Full PDF indexing needs `pypdf` in the runtime selected by the plugin and network
access to the official source. The plugin reports a missing dependency instead of
installing one silently. Cache location is `<workspace>/.motionworks/references`;
there is no fixed user project path and no cache write under Program Files.
Only catalog PDF IDs are accepted; no arbitrary URLs or project uploads are used.
Out-of-workspace cache links are refused.

The package ships original summaries and factual interface data, not vendor PDFs,
extracted full text or the supplied customer project. Downloads are verified against
reviewed hashes; a changed edition requires catalog review before old page citations
can be reused. Local index integrity is checked. Search returns short excerpts and
page links rather than full manual dumps. Installed-manual legacy extraction remains
available through `mw_code_manual`, explicitly marked as heuristic and unversioned.

To add an edition: obtain its official PDF, verify title/revision and the cited pages,
review differences, update its hash/page count and affected summaries/interfaces,
then run the reference tests. Never relabel a newer PDF with an older source's pages.

## Regression checks

`npm test` includes offline reference/checker unit tests and real host-to-Python tool
calls, alongside the existing workspace, native-format, transaction and bridge tests.
Tests use temporary workspaces and no controller connection. The optional supplied
native fixture can also be reviewed read-only to verify compatibility and file hashes.
