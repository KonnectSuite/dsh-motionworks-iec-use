# Version 0.5 tool migration

The public catalog contains 45 tools. These nine definitions were removed, not hidden
by a runtime flag. Reload the harness plugin to replace its previously cached catalog.

| Retired tool | Replacement |
| --- | --- |
| `mw_code_write_st` | Native ST editor or verified native import |
| `mw_code_var_add`, `mw_code_var_add_many` | Native declaration worksheet/import |
| `mw_code_var_edit`, `mw_code_var_delete` | Native declaration worksheet; inspect references |
| `mw_code_pou_create`, `mw_code_pou_delete` | Native project-tree commands/import |
| `mw_code_restore_pou` | Approved recovery from a verified backup through the IDE |
| `mw_ide_rebuild` | Observed native Rebuild menu; API Build is not Rebuild |

Use `mw_ide_edit_guide` for operation-specific instructions. It returns guidance,
not an executed UI edit. Computer use remains a separately connected MCP dependency.
Read-only native source inspection, Save, Build, Make, verification, task object-model
operations and separately guarded staging/source promotion remain available.

Private offline engine code/tests remain for format diagnostics and regression history.
They are not registered editor tools. The legacy offline-write opt-in does not restore
public tools. The historical offline live-acceptance runner is excluded from the package.

`npm test` runs isolated regressions without IDE interaction. `npm run test:guards`
checks retirement and guidance. Misleading `test:live`, `test:loop` and `test:smoke`
aliases were removed: they did not execute live UI tests. For actual native evidence,
follow `IDE_FIRST_WORKFLOW.md` and retain observed compiler/persistence reports.
