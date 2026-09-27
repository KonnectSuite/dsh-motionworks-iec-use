# Does a CLEAN COM variable survive Save() and compile?
#
# The previous run created 32 variables across every block type 1..8 and the build stalled. That
# was almost certainly self-inflicted - blockType 6 looks like VAR_EXTERNAL, and a VAR_EXTERNAL
# with no matching global stalls the build with an empty Errors pane, which round 27 established.
# Creating every section at once is not a test of the API.
#
# So this does the minimum that answers the question. One variable, one section (5, the plain
# local VAR that existing variables report), then SAVE, then read the file back and BUILD.
#
# If it works, the plugin's hand-built CFB writer has a supported alternative for declarations -
# the writer that once turned a 1132-byte .VB into zero and a 1565-byte grid into 79 MB. If it
# does not, the writer stays and the reason is recorded.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$node = "C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe"
$SRC = 'C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt'

# A clean stage, through the plugin, so the IDE is in a known state.
$prep = Join-Path $env:TEMP 'clean_prep38.mjs'
$prepBody = @'
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\stage\\TopCutter`;
const fs = await import("node:fs");
try { await run("mw_ide_close"); } catch {}
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SOURCE_PATH });
await run("mw_ide_close");
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
const b = await run("mw_ide_build");
console.log("  baseline build: is_compiled=" + b.is_compiled);
'@
$prepBody | Out-File -FilePath $prep -Encoding utf8
$env:MW_PLUGIN = $INST
$env:MW_SOURCE_PATH = $SRC
& $node $prep 2>&1 | Select-Object -First 4

Write-Host ""
Write-Host "  === create ONE variable, blockType 5 ==="
$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$pou = $null
foreach ($i in 1..$proj.Pous.Count) {
    if ($proj.Pous.Item($i).Name -eq 'TopCutterCamSetup') { $pou = $proj.Pous.Item($i); break }
}
$vars = $pou.Variables
Write-Host "    before: $($vars.Count) variables"
$ok = $false
try {
    $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars,
        @('ZzOneVar', 'BOOL', 5, 0, 0, 0)) | Out-Null
    $ok = $true
} catch {
    $m2 = $_.Exception.Message; if ($_.Exception.InnerException) { $m2 = $_.Exception.InnerException.Message }
    Write-Host "    Create failed: $m2"
}
Write-Host "    after:  $($vars.Count) variables   created=$ok"
foreach ($i in 1..$vars.Count) {
    if ($vars.Item($i).Name -eq 'ZzOneVar') {
        $v = $vars.Item($i)
        Write-Host "    new var: Name='$($v.Name)' DataType='$($v.DataType)' BlockType='$($v.BlockType)' Id='$($v.Id)'"
    }
}

Write-Host ""
Write-Host "  === save, then read the FILE back and build ==="
$after = Join-Path $env:TEMP 'clean_after38.mjs'
$afterBody = @'
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
console.log("  --- save ---");
const s = await run("mw_ide_save");
console.log("    ", JSON.stringify(s).slice(0, 130));
console.log("  --- read the declaration back from the FILE ---");
const r = await run("mw_code_read_st", { pou: "TopCutterCamSetup" });
const decls = r.declarations ?? [];
console.log("    declarations:", decls.length);
console.log("    ZzOneVar present:", decls.some(d => d.name === "ZzOneVar"));
console.log("  --- build ---");
const b = await run("mw_ide_build");
console.log("    is_compiled:", b.is_compiled, " stalled:", b.stalled);
'@
$afterBody | Out-File -FilePath $after -Encoding utf8
& $node $after 2>&1 | Select-Object -First 14
Remove-Item Env:MW_PLUGIN -ErrorAction SilentlyContinue
Remove-Item Env:MW_SOURCE_PATH -ErrorAction SilentlyContinue
