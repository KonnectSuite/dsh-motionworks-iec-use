# Can a TASK be created through COM? The TLB says yes.
#
# The type library, read in round 36, lists under _Tasks:
#
#     [read-only] the Tasks object
#     deletes the current Task object
#     copies the task settings
#     [read-only] the logical name of the task
#     get a Task object from the collection
#     [read-only] number of tasks of a resource
#     [read-only] the Resource object
#     creates a new Task object          <-- this
#     [read-only] Tasks collection
#
# and ProgramInstances.Create on the SAME kind of collection is proved to work: it assigns a POU to
# a task and Save() writes PROJECT.TRE itself. Task creation is the same shape, so it is worth
# asking whether it works too - "add a task" is a real thing a user asks for and the plugin has no
# way to do it today.
#
# The plugin can already READ tasks two ways (the tree and COM) and has never been able to make
# one. The path to the collection is the one proved in round 36:
#
#     GetObjectByLogicalName('Hardware/Configuration/Resource', 10)   -> the resource
#     resource.Tasks                                                  -> the collection
#
# Everything here runs against the STAGED project, and reports the task count before and after so
# a no-op cannot be mistaken for success.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"

$resource = $proj.GetObjectByLogicalName('Hardware/Configuration/Resource', 10)
if ($resource -eq $null) { Write-Host "  no resource"; exit 1 }
Write-Host "  resource: LogicalName='$($resource.LogicalName)'"

$tasks = $resource.Tasks
Write-Host "  Tasks collection: $($tasks.Count) task(s)"
Write-Host "  members:"
$tasks | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "    $($_.MemberType)  $($_.Name)" }

Write-Host ""
Write-Host "  === existing tasks, for reference ==="
for ($i = 1; $i -le $tasks.Count; $i++) {
    $t = $tasks.Item($i)
    $kind = ''
    try { $kind = $t.Type } catch { }
    Write-Host "    [$i] Name='$($t.Name)'  Type='$kind'"
}

Write-Host ""
Write-Host "  === Create, trying argument shapes ==="
$before = $tasks.Count
$shapes = @(
    @('ZzTask1'),
    @('ZzTask2', 'CYCLIC'),
    @('ZzTask3', 'DEFAULT'),
    @('ZzTask4', 'CYCLIC', 20),
    @('ZzTask5', 1),
    @()
)
foreach ($shape in $shapes) {
    $desc = ($shape | ForEach-Object { "'$_'" }) -join ', '
    try {
        $r = $tasks.GetType().InvokeMember('Create', 'InvokeMethod', $null, $tasks, $shape)
        $after = $tasks.Count
        Write-Host "    Create($desc) -> OK   $before -> $after"
        if ($after -gt $before) {
            $made = $null
            for ($i = 1; $i -le $after; $i++) {
                if ($tasks.Item($i).Name -eq $shape[0]) { $made = $tasks.Item($i) }
            }
            if ($made) {
                Write-Host "      created: Name='$($made.Name)' Type='$($made.Type)' LogicalName='$($made.LogicalName)'"
            }
            break
        }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    Create($desc) -> $m"
    }
}

Write-Host ""
Write-Host "  === final state ==="
Write-Host "  tasks now: $($tasks.Count) (was $before)"
for ($i = 1; $i -le $tasks.Count; $i++) {
    $t = $tasks.Item($i)
    $kind = ''
    try { $kind = $t.Type } catch { }
    Write-Host "    [$i] $($t.Name)  [$kind]"
}
