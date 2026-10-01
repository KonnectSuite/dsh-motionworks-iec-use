# Import / export in the MotionWorks automation API

Probed live against `Ade.Application.550` (Version 1.19) with a project open. Recorded
here because the capability is real but **not reachable headlessly**, and knowing that
saves the next person the same afternoon.

## What exists

`Application.ImportExports()` returns a collection of **6 providers**. Each exposes
`Application`, `Attributes`, `Direction`, `ImportExportType`, `Parent` and one method,
`Execute`. Their `ImportExportType` values name exactly what they are:

| # | Direction | ImportExportType | Meaning |
|---|---|---|---|
| 1 | Import | `file_exchange_format_import` | vendor file-exchange format |
| 2 | Import | `iec_61131-3_file_import` | IEC 61131-3 text/file import |
| 3 | Export | `iec_61131-3_file_export` | IEC 61131-3 text/file export |
| 4 | Export | `cross_references_export` | cross-reference report |
| 5 | Export | `plc_open_xml_export` | **PLCopen XML export** |
| 6 | Import | `plc_open_xml_import` | **PLCopen XML import** |

`Application.ExternalImportExportProviders()` exists and returns **0** entries — the
collection add-ins would populate. Nothing is registered here.

Supporting enums, from the type library:

```
AdeImportObjectType   1 DataTypes  2 Pou  3 Hardware  4 Configuration
                      5 Resource   6 Task 7 IoConfiguration
                      8 GlobalVariables (also NetworkVariables)
AdeImportExportDirection  1 Export  2 Import
AdeLoadDirection          1 Down    2 Up          <- to/from the controller
AdeUpDownloadType         1 Project 2 BootProject 3 Changes 4 File
```

Also on `_Project`: `SaveAs(Path, flags)`, `SaveAsServer`, `Create(Path, Name,
TemplateName)`, `GetInstancePathForPou(PouName)`, `CheckProject`-side `Compile`, `Save`.
`_Application` additionally has `ExportEvcObject(objType)` and `ImportEvcObject(objType)`
taking an `AdeImportObjectType`.

## Why it is not usable headlessly

Every route was tried, and each fails in a way that points at the same conclusion -
these providers are driven by the IDE's own dialogs, not by arguments.

**1. Positional COM calls fail before reaching the method.**

```
$p.Execute($path)            -> DISP_E_NOTACOLLECTION (0x80020011)
$p.Execute($pous)            -> DISP_E_NOTACOLLECTION (0x80020011)
$p.Execute($pous, $path)     -> DISP_E_NOTACOLLECTION (0x80020011)
```

That is PowerShell's COM binder, not the method refusing the value.

**2. Reflection gets through, and shows `Execute` takes NO parameters.**

Calling via `InvokeMember('Execute', InvokeMethod, ...)` bypasses the binder. With any
argument at all:

```
Execute()                 -> provider 3: OK
                             provider 4: Not implemented
                             provider 5: One or more arguments are invalid
Execute(anything)         -> Number of parameters specified does not match the expected number.
```

So there is no path argument to supply. `Attributes` is empty on all six providers, so
there is no attribute to set beforehand either.

**3. The typed application-level calls fail with E_FAIL.**

```
ExportEvcObject(1..8)     -> 0x80004005 E_FAIL    (every AdeImportObjectType)
```

`ApplicationState` reads `0` while the project is open, which is consistent with these
entry points expecting an interactive IDE session.

## What this means for the plugin

Import/export via COM is a **dead end** in this build, the same way `ExecuteCommand` is a
stub. Do not build on it.

The practical routes that DO work, and what the plugin uses instead:

- **Reading a POU** — `mw_code_read_st` returns the body and declarations straight from
  the POU's own `src.st1` streams. No export needed.
- **Reading globals** — `mw_code_globals` reads `Global_Variables.VB` (161+ declarations
  with type, group, IEC address and description).
- **Writing a POU** — native IDE editors and project-tree commands. Offline POU,
  variable and ST writers are retired. Inspect inherited externals if using a native
  copy/import, then Save All, read back, Build/Make and verify approved reopen.
- **Cross-reference** — inspect the native IDE cross-reference and saved source.
  Offline text searches cannot prove all graphical or indirect references are absent.
- **Controller download/upload** — `AdeLoadDirection` / `AdeUpDownloadType` exist in the
  type library but no method taking them was found on the objects probed. Worth a
  follow-up outside this plugin's scope. This plugin never downloads or commands motion.

## Reproducing

The probes are in the scratch directory:

- `probe_importexport.ps1` — lists the providers and their properties
- `probe_ie_attrs2.ps1` — reads `ImportExportType` and the `Attributes` collection
- `probe_ie_execute.ps1` — positional `Execute` attempts
- `probe_ie_collection.ps1` — `Execute` with project collections
- `probe_ie_reflect.ps1` — reflection-based invocation, which is what established that
  `Execute` takes no parameters
- `probe_evc.ps1` — `ExportEvcObject` across all eight object types

All run under the 32-bit host, which is required for `Ade.Application.550`:

```powershell
& "$env:SystemRoot\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File <probe>.ps1
```
