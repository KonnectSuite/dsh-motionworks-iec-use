# What does mw_code_pou_create actually produce, against what a real POU has?
#
# A real POU owns FOUR streams in its own container:
#
#   POE\TopCutterCamSetup\src.st1
#       TopCutterCamSetup.STB     3760 bytes    <- never examined by this plugin
#       TopCutterCamSetupV.VB     1112 bytes    <- declarations, the writer's target
#       TopCutterCamSetupT.TXT       0 bytes    <- never examined
#       TopCutterCamSetupV.VGR    1565 bytes    <- the grid, the writer's other target
#
# The author-a-program run added two declarations to a freshly created POU, wrote a body using
# them, assigned it so it would really be compiled, and the build stalled with the POU showing 0
# variables. Declarations on an EXISTING POU work, so the difference is the POU.
#
# So: create one, and lay its streams beside an existing POU's. If the created POU is missing .STB
# or .TXT, or has a .VB/.VGR of a shape the append logic does not expect, that is the answer - and
# it is also the answer to whether create-then-declare is usable at all.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$node = "C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe"
$py = "$env:LOCALAPPDATA\Programs\AryaAI\resources\runtime\primary-runtime\dependencies\python\python.exe"
$ENV:PYTHONIOENCODING = 'utf-8'

# Re-stage so the deleted POU and any pollution are gone.
$prep = Join-Path $env:TEMP 'newpou_prep.mjs'
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
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
const made = await run("mw_code_pou_create", { name: "ZzInspect", template: "TopCutterCamSetup", dry_run: false });
console.log("  created:", JSON.stringify(made).slice(0, 220));
'@
$prepBody | Out-File -FilePath $prep -Encoding utf8
Get-Process Mwt,powershell -EA SilentlyContinue | Where-Object { $_.Id -ne $PID } | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Seconds 4
$env:MW_PLUGIN = $INST
$env:MW_SRC_PATH = 'C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt'
& $node $prep 2>&1 | Select-Object -First 4

Write-Host ""
Write-Host "  === created POU vs a real one ==="
$script = Join-Path $env:TEMP 'cmp_streams.py'
$body = @'
import sys
sys.path.insert(0, r"INSTDIR\code\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
root = Path(r"INSTDIR\stage\TopCutter")

def describe(label, d):
    src = root / d / "src.st1"
    if not src.is_file():
        print(f"    {label}: NO src.st1 at {d}")
        return
    cf = CompoundFile(src)
    print(f"    {label}: {d}")
    for n in sorted(cf.stream_names()):
        raw = cf.read_stream(n)
        print(f"        {n:<28} {len(raw):>7}B")

describe("created  (ZzInspect)", Path("POE") / "ZzInspect")
describe("existing (TopCutterCamSetup)", Path("POE") / "TopCutterCamSetup")
'@
$body = $body.Replace('INSTDIR', $INST)
$body | Out-File -FilePath $script -Encoding utf8
& $py $script 2>&1 | Select-Object -First 22
Remove-Item Env:PYTHONIOENCODING,Env:MW_PLUGIN,Env:MW_SRC_PATH -ErrorAction SilentlyContinue
