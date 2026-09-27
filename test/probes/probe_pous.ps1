# Read a real LogicalName from the objects the project does expose.
#
# ActiveProject has no Configurations property - only Pous, Name, FullName and the three methods -
# so the tree has to be reached through GetObjectByLogicalName, whose name format is the unknown.
# But every POU in Pous is an object from the same model, and the type library says every such
# object carries a LogicalName. If a POU's logical name can be read, the format is known, and the
# task and program-instance names can be constructed from it.
#
# The type library also showed a ProgramType property on Task, and an adeErrProgramInstanceAlready
# Exists error, which together say program instances are first-class objects here.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"

Write-Host ""
Write-Host "  === ActiveProject.Pous ==="
$pous = $proj.Pous
Write-Host "    type: $($pous.GetType().Name)   count: $($pous.Count)"
$pous | Get-Member -MemberType Method, Property -EA SilentlyContinue |
    Select-Object -First 14 | ForEach-Object { Write-Host "      $($_.MemberType)  $($_.Name)" }

for ($i = 1; $i -le $pous.Count; $i++) {
    $p = $pous.Item($i)
    $ln = ''
    try { $ln = $p.LogicalName } catch { $ln = "<no LogicalName: $($_.Exception.Message)>" }
    $nm = ''
    try { $nm = $p.Name } catch { }
    $full = ''
    try { $full = $p.FullName } catch { }
    Write-Host "    [$i] Name='$nm'  LogicalName='$ln'  FullName='$full'"
    if ($i -eq 1) {
        Write-Host "        members:"
        $p | Get-Member -MemberType Method, Property -EA SilentlyContinue |
            Select-Object -First 20 | ForEach-Object { Write-Host "          $($_.MemberType)  $($_.Name)" }
    }
}

Write-Host ""
Write-Host "  === with a POU's real logical name, can GetObjectByLogicalName find it? ==="
for ($i = 1; $i -le [Math]::Min(3, $pous.Count); $i++) {
    $p = $pous.Item($i)
    $ln = ''
    try { $ln = [string]$p.LogicalName } catch { continue }
    if (-not $ln) { continue }
    foreach ($type in 5, 6, 7) {          # function, function block, program
        try {
            $o = $proj.GetObjectByLogicalName($ln, $type)
            if ($null -ne $o) {
                Write-Host "    '$ln' type=$type -> $($o.GetType().Name)"
                $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                    Select-Object -First 10 | ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
            }
        } catch {
            $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
            Write-Host "    '$ln' type=$type -> $m"
        }
    }
}
