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

The provider-based COM import/export routes above were not usable headlessly in
these probes. Do not generalize this to every native entry point: the follow-up
`ExecuteDdeCommand` route is independently proven for ST import. Prefer
`mw_ide_code_change`, which guards its input/baseline and verifies native saved
code/comments and collateral source. `ExecuteCommand` and `ExecuteDdeCommand`
are separate interfaces.

## Verified native POU exchange investigation

On MotionWorks IEC 3 Pro / Ade 1.19, the installed DDE dispatcher additionally
binds `ExportPou <POU-name> "<existing-destination-directory>"` and
`ImportPou "<native-export-directory>"`. The binding was established before
execution by inspecting the installed command table and handlers: name table
base `this+0x598`, ExportPou index 73 / handler RVA `0x1c22f`, ImportPou index 72 /
handler RVA `0x1c091`. Export formats the first argument as `@POUS.%s`, checks
the second argument with `_access(path,0)`, and passes the POU object plus that
destination to its export interface. Import passes its existing path to the
corresponding import interface. This inspection did not invoke private vtables.
Installed `dde.dll` SHA-256:
`6f0cd69b9601a3f7c0d637e3174dffff6442a402533b05b7d5233080474535e4`.

Exporting the original ServoTaskSlow to a new empty directory inside the
disposable workspace returned 0, left modified=false, and preserved all project
sources, translations and inventories. Output was a native POU exchange package:
binary `pou.tre`, a POU directory with `src.st1`, native field data, metadata and
translations. This is not PLCopen XML or an editable graphical text format.
Do not rewrite these native binaries to manufacture graphical edits.

A populated LD copy, CodexGraphExchange, then completed an export/delete/import
round-trip. Both DDE calls returned 0; import marked the project modified and
native Save cleared it. Saved graph bytes, all eleven declarations, translations,
tasks/globals and original sources matched the pre-export copy exactly. Temporary
native task assignment allowed a fresh Build and verified five compiler networks;
unassignment/deletion and cleanup Build/Make restored the complete original
seven-POU baseline. Evidence lives in the disposable verification directory:
`native-export-pou-probe.json`, `native-export-pou-preservation.json`,
`native-exchange-copied.json` and `native-exchange-roundtrip.json`.

`test/native_pou_exchange_live.mjs` is an opt-in reproduction on a disposable
smoke fixture. It permits only its newly exported, hash-checked package and absent
test POU identity; it never imports an arbitrary package or overwrites a POU.
Set `MOTIONWORKS_MCP_WORKSPACE` to that fixture and
`MOTIONWORKS_NATIVE_PROBE_PYTHON` to an existing Python with pywin32. The probe
checks the COM runtime before any mutation; the bundled file-reader Python does
not contain COM bindings. This dependency belongs to the opt-in investigation,
not to the installed plugin's native bridge.
The initial probe established these native bindings; the guarded public route is documented below.
Arbitrary external-package import still needs collision, package/provenance, dependency, native flag,
source-preservation and partial-action guards. The observed argument buffers are
bounded; the probe keeps each path below 128 characters. Graphical placement and
wiring remain separate, unverified operations.

The practical routes that DO work, and what the plugin uses instead:

- **Reading a POU** — `mw_code_read_st` returns the body and declarations straight from
  the POU's own `src.st1` streams. No export needed.
- **Reading globals** — `mw_code_globals` reads `Global_Variables.VB` (161+ declarations
  with type, group, IEC address and description).
- **Writing ST code** — `mw_ide_code_change` uses native DDE ChangeCodeWS with
  exact expected-body preconditions and full read-back; finish fresh Build/Make.
- **Other POU edits** — prefer `mw_ide_pou_change` and `mw_ide_variable_change` for
  their supported native lifecycle/declaration operations. Offline POU,
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

The historical provider probes ran under the 32-bit PowerShell host used by the
plugin bridge. The follow-up DDE exchange probe also succeeded through an
existing 64-bit Python/pywin32 out-of-process COM client.

```powershell
& "$env:SystemRoot\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File <probe>.ps1
```

## Guarded public native packages (0.5.5)

`mw_ide_pou_package` exposes the proven ExportPou/ImportPou route through the
plugin bridge. Export takes `project`, `operation:"export"`, `pou` and
`baseline_saved:true`; it returns a private package directory and a session-bound
`package_token`. Import takes the same project, `operation:"import"`, that token,
`baseline_saved:true` and `dependencies_reviewed:true`. The original POU name
must be absent. Receipts expire when the plugin process reloads; an import token
is consumed before native mutation so a partial action cannot be retried blindly.

Only its own unchanged native export can be imported, into the original staged
project. It verifies complete package hashes, library bindings, external global
names/types, full native declaration flags/groups, saved code/graph/translation
sources and unrelated POU/task/global inventories. The COM API omits external
worksheet descriptions; those comments are verified through saved declarations
and translation files rather than inferred from global descriptions. Failure
retains the completed phases and stops without automatic retry or rollback.
Finish intended imports with fresh Build/Make. Arbitrary package paths,
cross-project import, overwrites and graphical block placement/wiring are outside
this route's verified scope. The opt-in `test/public_pou_package_live.mjs` exercises
the guarded route on the disposable staged smoke fixture.
