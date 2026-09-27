# Find the create method on the ProgramInstances collection, and use it.
#
# The type library documents the interface:
#
#     [read-only] the ProgramInstance object
#     deletes the current ProgramInstance object
#     get a ProgramInstance object from the collection
#     [read-only] the number of program instances
#     [read-only] the Task object
#     creates a new ProgramInstance object        <-- this one
#
# but Get-Member on the collection listed only Delete, Application, FbInstances, LogicalName,
# Name, Parent, Type and Variables - which are the members of a single ProgramInstance, not of a
# collection. A COM collection that forwards to its default item hides the rest, so the create is
# found by naming it rather than by listing.
#
# THIS WRITES. It runs against the staged copy, never the user's project, and reports the task's
# instance count before and after so a no-op cannot look like success. The tree is read afterwards
# to see whether the IDE wrote the assignment itself - which, if it does, is the whole problem
# solved by a supported path instead of a hand-built binary edit.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$task = $proj.GetObjectByLogicalName('Hardware/Configuration/Resource/Tasks/SlowTsk', 11)

Write-Host "  task: '$($task.LogicalName)'  ProgramInstances before: $($task.ProgramInstances.Count)"
$before = $task.ProgramInstances.Count

$candidates = @(
    'Add', 'Create', 'New', 'AddProgramInstance', 'CreateProgramInstance',
    'Insert', 'AddInstance', 'NewProgramInstance', 'CreateProgram', 'AddPou'
)

foreach ($m in $candidates) {
    $args = @('TopCutterCamSetup')
    try {
        $r = $task.ProgramInstances.GetType().InvokeMember(
            $m, 'InvokeMethod', $null, $task.ProgramInstances, $args)
        $after = $task.ProgramInstances.Count
        Write-Host "    $m('TopCutterCamSetup') -> OK  count $before -> $after"
        if ($after -gt $before) {
            Write-Host "      *** CREATED ***"
            for ($i = 1; $i -le $after; $i++) {
                Write-Host "        [$i] $($task.ProgramInstances.Item($i).LogicalName)"
            }
            break
        }
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        if ($msg -notmatch 'Unknown name|not found|0x80020006') {
            Write-Host "    $m -> $msg"
        }
    }
}

Write-Host ""
Write-Host "  final count: $($task.ProgramInstances.Count)"
for ($i = 1; $i -le $task.ProgramInstances.Count; $i++) {
    Write-Host "    [$i] $($task.ProgramInstances.Item($i).LogicalName)"
}

Write-Host ""
Write-Host "  === did the IDE write the tree itself? ==="
$py = "$env:LOCALAPPDATA\Programs\AryaAI\resources\runtime\primary-runtime\dependencies\python\python.exe"
$inst = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$code = @"
import sys
sys.path.insert(0, r'$inst\code\engine')
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
p = Path(r'$inst\stage\TopCutter\src.st1')
lines = CompoundFile(p).read_stream('PROJECT.TRE').decode('latin1').splitlines()
bad = 0
for i, l in enumerate(lines):
    f = l.split('\t')[0].split()
    if len(f) == 4 and f[0].isdigit() and f[1].isdigit():
        nm = lines[i+1].split('\t')[0] if i + 1 < len(lines) else ''
        if '\\\\' in nm: bad += 1
print(f'    tree lines: {len(lines)}   malformed: {bad}')
"@
$code | Out-File -FilePath "$env:TEMP\treecheck.py" -Encoding utf8
& $py "$env:TEMP\treecheck.py" 2>&1 | Select-Object -First 3
