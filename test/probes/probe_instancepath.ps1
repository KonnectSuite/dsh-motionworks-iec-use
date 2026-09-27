# Two arguments, and a method that may name an assignment.
#
# GetObjectByLogicalName takes (string, AdeObjectType), so the first attempt failed on arity, not
# on the name. The enum's values are not known, so they are tried by number - a COM enum is just
# an integer on the wire.
#
# GetInstancePathForPou takes one string and returns one, and its name says it produces the
# INSTANCE PATH for a POU - which is exactly the thing a task assignment is about. If it returns
# something like "BG" for an assigned POU, it names the assignment without reading the tree at
# all.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject

Write-Host "  === GetInstancePathForPou : the assignment question, asked directly ==="
foreach ($pou in @('TopCutterCamSetup', 'TopCutterFFCamSetup', 'ServoTaskSlow',
                   'TopCutterCutControl', 'EIP_ToCLX', 'ServoHoming', 'TopCutterInitialize')) {
    try {
        $p = $proj.GetInstancePathForPou($pou)
        $shown = if ($null -eq $p) { '<null>' } elseif ("$p" -eq '') { '<empty>' } else { $p }
        Write-Host "    $pou -> $shown"
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    $pou -> $m"
    }
}

Write-Host ""
Write-Host "  === GetLogicalNameOfActiveView ==="
try { Write-Host "    -> $($proj.GetLogicalNameOfActiveView())" }
catch { Write-Host "    -> $($_.Exception.Message)" }

Write-Host ""
Write-Host "  === GetObjectByLogicalName(name, AdeObjectType) - trying enum values 0..20 ==="
foreach ($type in 0..20) {
    try {
        $o = $proj.GetObjectByLogicalName('TopCutterCamSetup', $type)
        if ($null -ne $o) {
            Write-Host "    type=$type -> $($o.GetType().Name)"
            $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                Select-Object -First 8 |
                ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
            break
        }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        if ($m -notmatch 'Cannot find an overload') {
            Write-Host "    type=$type -> $m"
        }
    }
}

Write-Host ""
Write-Host "  === the task name, at each type value ==="
foreach ($type in 0..20) {
    try {
        $o = $proj.GetObjectByLogicalName('BG', $type)
        if ($null -ne $o) {
            Write-Host "    BG type=$type -> $($o.GetType().Name)"
            $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                Select-Object -First 10 |
                ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
            break
        }
    } catch { }
}
