# Walk the live object model down to ProgramInstances.
#
# The type library lists a full hierarchy the plugin has never used:
#
#   Configurations -> Configuration -> Resources -> Resource -> Tasks -> Task
#                                                                       -> ProgramInstances
#                                                                       -> ProgramInstance
#
# and round 5's conclusion that COM cannot assign a POU to a task was drawn from interfaces it
# looked for and did not find. _Tasks, _Task, ProgramInstances and ProgramInstance are all present
# in Ade.tlb, which changes the question from "can this be done" to "what is the access path".
#
# Every object carries a LogicalName property, so this walks down from the project printing each
# name as it goes - which also answers the format question that defeated
# GetObjectByLogicalName(name, adeOtTask) with every name shape tried.
$ErrorActionPreference = 'Continue'

function Show-Members($obj, $label, $filter) {
    Write-Host "  --- members of $label ---"
    $m = $obj | Get-Member -MemberType Method, Property -EA SilentlyContinue
    if ($filter) { $m = $m | Where-Object { $_.Name -match $filter } }
    $m | Select-Object -First 26 | ForEach-Object { Write-Host "      $($_.MemberType)  $($_.Name)" }
}

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"
Show-Members $proj 'ActiveProject' '(?i)config|resource|task|instance|logical|name|pou'

Write-Host ""
Write-Host "  === Configurations ==="
try {
    $cfgs = $proj.Configurations
    Write-Host "    type: $($cfgs.GetType().Name)  count: $($cfgs.Count)"
    Show-Members $cfgs 'Configurations' $null
    for ($i = 1; $i -le $cfgs.Count; $i++) {
        $cfg = $cfgs.Item($i)
        Write-Host "    [$i] LogicalName='$($cfg.LogicalName)'  Name='$($cfg.Name)'"
        Write-Host "        === Resources ==="
        try {
            $res = $cfg.Resources
            Write-Host "          count: $($res.Count)"
            for ($j = 1; $j -le $res.Count; $j++) {
                $r = $res.Item($j)
                Write-Host "          [$j] LogicalName='$($r.LogicalName)'  Name='$($r.Name)'"
                Write-Host "              === Tasks ==="
                try {
                    $ts = $r.Tasks
                    Write-Host "                count: $($ts.Count)"
                    for ($k = 1; $k -le $ts.Count; $k++) {
                        $tk = $ts.Item($k)
                        Write-Host "                [$k] LogicalName='$($tk.LogicalName)'  Name='$($tk.Name)'"
                        try {
                            $pi = $tk.ProgramInstances
                            Write-Host "                    ProgramInstances: $($pi.Count)"
                            for ($m = 1; $m -le $pi.Count; $m++) {
                                $p = $pi.Item($m)
                                Write-Host "                      [$m] LogicalName='$($p.LogicalName)'  Name='$($p.Name)'"
                            }
                        } catch {
                            Write-Host "                    ProgramInstances -> $($_.Exception.Message)"
                        }
                    }
                } catch {
                    Write-Host "                Tasks -> $($_.Exception.Message)"
                }
            }
        } catch {
            Write-Host "          Resources -> $($_.Exception.Message)"
        }
    }
} catch {
    Write-Host "    Configurations -> $($_.Exception.Message)"
}
