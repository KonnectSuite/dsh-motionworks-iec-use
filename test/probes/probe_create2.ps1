# Create a ProgramInstance - the assignment, through a supported path.
#
# Create exists on the ProgramInstances collection; one argument gave "Number of parameters
# specified does not match the expected number", so the arity is different. The PLCopen schema
# describes the very same object as
#
#     <pouInstance name="..." type="..."/>
#
# - a NAME and a TYPE - so two arguments is the obvious next shape, with the second being the POU
# being instantiated.
#
# This is the write this plugin has refused for sixteen rounds, because doing it by editing
# PROJECT.TRE damaged the project in both directions. If the IDE creates the instance itself, the
# tree is the IDE's problem and the refusal can go.
#
# It still runs against the STAGED copy, and reports the count before and after so a no-op cannot
# be mistaken for success.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$task = $proj.GetObjectByLogicalName('Hardware/Configuration/Resource/Tasks/SlowTsk', 11)
$pi = $task.ProgramInstances

Write-Host "  task '$($task.Name)'  before: $($pi.Count)"
for ($i = 1; $i -le $pi.Count; $i++) { Write-Host "    [$i] $($pi.Item($i).LogicalName)" }

$shapes = @(
    @('ServoTaskSlow'),                                  # name only, tried again for contrast
    @('ServoTaskSlow', 'ServoTaskSlow'),                 # name, type
    @('ServoTaskSlow', 'POU'),                           # name, kind
    @('ServoTaskSlow', 7),                               # name, adeOtProgram
    @('ServoTaskSlow', 'ServoTaskSlow', 7),
    @('ZzProbe', 'ServoTaskSlow'),
    @(),                                                 # no arguments
    @('ServoTaskSlow', 'ServoTaskSlow', 'ServoTaskSlow')
)

$created = $false
foreach ($shape in $shapes) {
    $desc = ($shape | ForEach-Object { "'$_'" }) -join ', '
    try {
        $r = $pi.GetType().InvokeMember('Create', 'InvokeMethod', $null, $pi, $shape)
        $after = $pi.Count
        Write-Host "    Create($desc) -> OK   count $($pi.Count)"
        if ($after -gt 1) {
            Write-Host "      *** CREATED: count 1 -> $after ***"
            $created = $true
            break
        }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        if ($m -notmatch 'Number of parameters') {
            Write-Host "    Create($desc) -> $m"
        } else {
            Write-Host "    Create($desc) -> wrong arity"
        }
    }
}

Write-Host ""
Write-Host "  final: $($pi.Count) instance(s)"
for ($i = 1; $i -le $pi.Count; $i++) {
    $x = $pi.Item($i)
    Write-Host "    [$i] LogicalName='$($x.LogicalName)' Name='$($x.Name)' Type='$($x.Type)'"
}

Write-Host ""
Write-Host "  === tree state after the attempt ==="
$py = "$env:LOCALAPPDATA\Programs\AryaAI\resources\runtime\primary-runtime\dependencies\python\python.exe"
$script = Join-Path $env:TEMP 'treecheck2.py'
$body = "import sys`nsys.path.insert(0, r'$INST\code\engine')`n" +
        "from motionworks_iec_mcp.cfb import CompoundFile`n" +
        "from pathlib import Path`n" +
        "p = Path(r'$INST\stage\TopCutter\src.st1')`n" +
        "lines = CompoundFile(p).read_stream('PROJECT.TRE').decode('latin1').splitlines()`n" +
        "bad = 0`n" +
        "for i, l in enumerate(lines):`n" +
        "    f = l.split(chr(9))[0].split()`n" +
        "    if len(f) == 4 and f[0].isdigit() and f[1].isdigit():`n" +
        "        nm = lines[i+1].split(chr(9))[0] if i + 1 < len(lines) else ''`n" +
        "        if chr(92) in nm: bad += 1`n" +
        "print(f'    tree lines: {len(lines)}   malformed: {bad}')`n"
$body | Out-File -FilePath $script -Encoding utf8
& $py $script 2>&1 | Select-Object -First 3
