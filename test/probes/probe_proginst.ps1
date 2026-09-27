# ProgramInstances - the collection that IS the assignment.
#
# The task is reachable:
#
#     ActiveProject.GetObjectByLogicalName('Hardware/Configuration/Resource/Tasks/BG', 11)
#
# and it exposes ProgramInstances. Round 5 concluded that COM cannot assign a POU to a task; the
# interfaces it looked for were missing from the places it looked, but the path is real.
#
# Everything now depends on that collection's API: whether it can be enumerated (to read the
# assignment the plugin currently reads from the tree), and whether it has an Add or New (to make
# one). This reads it first, so the read path can be validated against mw_code_tasks before
# anything writes.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject

$task = $proj.GetObjectByLogicalName('Hardware/Configuration/Resource/Tasks/BG', 11)
Write-Host "  task: LogicalName='$($task.LogicalName)'  Name='$($task.Name)'  Type='$($task.Type)'"

Write-Host ""
Write-Host "  === every member of the task ==="
$task | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "    $($_.MemberType)  $($_.Name)" }

Write-Host ""
Write-Host "  === ProgramInstances ==="
$pi = $task.ProgramInstances
Write-Host "    type: $($pi.GetType().Name)   count: $($pi.Count)"
$pi | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "    $($_.MemberType)  $($_.Name)" }

Write-Host ""
Write-Host "  === contents, and what each instance looks like ==="
for ($i = 1; $i -le $pi.Count; $i++) {
    $inst = $pi.Item($i)
    $ln = ''; $nm = ''
    try { $ln = $inst.LogicalName } catch { }
    try { $nm = $inst.Name } catch { }
    Write-Host "    [$i] Name='$nm'  LogicalName='$ln'"
    if ($i -eq 1) {
        Write-Host "        members:"
        $inst | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "          $($_.MemberType)  $($_.Name)" }
    }
}

Write-Host ""
Write-Host "  === the same task for the other tasks, to confirm the path generalises ==="
foreach ($t in @('SlowTsk', 'FastTsk', 'MedTsk', 'Start')) {
    foreach ($type in @(11, 12)) {
        try {
            $o = $proj.GetObjectByLogicalName("Hardware/Configuration/Resource/Tasks/$t", $type)
            if ($null -ne $o) {
                $n = $o.Name
                $c = ''
                try { $c = $o.ProgramInstances.Count } catch { $c = '?' }
                Write-Host "    $t type=$type -> Name='$n'  ProgramInstances=$c"
                break
            }
        } catch { }
    }
}
