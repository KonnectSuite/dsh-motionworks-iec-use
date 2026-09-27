# Find how a variable is created over COM.
#
# A POU's Variables collection has 12 entries and its items carry Name, DataType, InitialValue,
# IecAddress, BlockType, Group, Comment, Retain and more - the whole model, with a Delete method.
# Get-Member lists the ITEM's members because a COM collection forwards to its default item, the
# same thing that hid Create on ProgramInstances until the type library's own documentation
# strings gave it away.
#
# So: read the type library around the variable vocabulary for the create's real name, then try it.
# A validated variable API would replace the hand-built CFB writer that constructs .VGR records
# byte by byte - the one that once turned a 1132-byte .VB into zero and a 1565-byte grid into 79
# megabytes by writing a record out of ROW order.
#
# THIS DOES NOT WRITE. It names the method and reports what the IDE says about the call shape.
$ErrorActionPreference = 'Continue'

$tlb = 'C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Ade.tlb'
$py = "$env:LOCALAPPDATA\Programs\AryaAI\resources\runtime\primary-runtime\dependencies\python\python.exe"
$script = Join-Path $env:TEMP 'tlb_vars.py'
$body = @'
import re
from pathlib import Path
raw = Path(r'C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Ade.tlb').read_bytes()
runs = [(m.start(), m.group(0).decode('ascii','replace')) for m in re.finditer(rb'[\x20-\x7e]{4,}', raw)]
def show(needle, before=6, after=18):
    idx = [i for i,(o,s) in enumerate(runs) if needle in s]
    print(f'  ===== {needle!r}: {len(idx)} =====')
    for i in idx[:1]:
        for off, s in runs[max(0,i-before):i+after]:
            mark = ' <<<' if needle in s else ''
            print(f'    @{off:>7}  {s[:86]!r}{mark}')
    print()
show('creates a new variable based on the specified parameters')
show('NewVariable')
'@
$body | Out-File -FilePath $script -Encoding utf8
& $py $script 2>&1 | Select-Object -First 34

Write-Host ""
Write-Host "  === what does the IDE accept as a create on Variables? ==="
$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$pou = $null
foreach ($i in 1..$proj.Pous.Count) {
    if ($proj.Pous.Item($i).Name -eq 'TopCutterCamSetup') { $pou = $proj.Pous.Item($i); break }
}
$vars = $pou.Variables
Write-Host "    Variables count: $($vars.Count)"
foreach ($m in @('Create', 'Add', 'New', 'NewVariable', 'Insert', 'AddVariable')) {
    foreach ($args in @(@(), @('ZzVarProbe'), @('ZzVarProbe', 'BOOL'))) {
        $desc = ($args | ForEach-Object { "'$_'" }) -join ', '
        try {
            $r = $vars.GetType().InvokeMember($m, 'InvokeMethod', $null, $vars, $args)
            Write-Host "      $m($desc) -> OK  (count now $($vars.Count))"
            break
        } catch {
            $msg = $_.Exception.Message
            if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
            if ($msg -match 'Number of parameters') { Write-Host "      $m($desc) -> wrong arity" }
            elseif ($msg -match 'Unknown name|0x80020006') { }
            else { Write-Host "      $m($desc) -> $msg" }
        }
    }
}
Write-Host "    final count (must still be 12 if nothing wrote): $($vars.Count)"
