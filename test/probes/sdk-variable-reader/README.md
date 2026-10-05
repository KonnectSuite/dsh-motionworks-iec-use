# Read-only SDK declaration reader benchmark

This is an experimental reader, not enabled in the plugin. It compares every
field returned by the production Get-VariableRows function against a C# reader
compiled with interop generated from the installed Ade.tlb. Both readers retain
native count-drift refusal, usage validation, all six flags, group, type, address,
initializer and description. No create/save/compile/navigation/input is invoked.

Run only on the exact saved disposable fixture. The scripts refuse another
native project, multiple/disabled IDE frames, trial prompts, SDK/assembly hash
mismatch and output paths outside the authorized workspace. Use 32-bit Windows
PowerShell with process-only ExecutionPolicy Bypass, as for the production bridge.

1. Run prepare.ps1 with OutputDirectory set to a fresh `sdk-interop-<UUID>` folder
   directly in the fixture's parent Codex Workspace directory. It creates an
   interop assembly and SDK/assembly hash manifest. It refuses existing output.
2. Run benchmark.ps1 with ExpectedProject set to the fixture's staged
   TopCutterS5.mwt, InteropDirectory set to that prepared folder and Evidence set
   to a new JSON file directly inside the fixture's .motionworks/verification.
3. Repeat with Reverse to run the generated reader first. Compare per-sheet
   timings, full-row equality, native state and a separate full fixture audit.

TypeLibConverter is the documented [.NET type-library conversion API](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.typelibconverter.converttypelibtoassembly?view=netframework-4.8.1).
Generated binaries are local test artifacts and are not committed or packaged.
If .NET refuses a location as a network load, retain the failure; do not enable
loadFromRemoteSources or change loader/security policy. The fixture's hidden
verification folder produced that refusal; the separate workspace cache loaded
normally. The failed receipt is retained alongside successful benchmarks.

Before production integration, verify SDK identity/version compatibility and
failure handling, complete native package snapshots, and live declaration flag
mutations with source preservation. Do not reduce verification coverage or
silently retry a partial read to obtain a speed improvement.
