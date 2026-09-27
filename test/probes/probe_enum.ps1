# GetObjectByLogicalName with the CORRECT enum values.
#
# The type library gave the enumeration, in declaration order:
#
#   adeOtApplication  adeOtProject   adeOtLibraries  adeOtLibrary   adeOtPous
#   adeOtFunction     adeOtFunctionBlock  adeOtProgram  adeOtHardware
#   adeOtConfiguration  adeOtResource  adeOtTask  adeOtProgramInstance
#   adeOtFbInstance   adeOtVariable  adeOtVariables  adeOtDataTypes
#
# so adeOtTask is 11 and adeOtProgramInstance is 12 - which is the object this plugin has never
# been able to create, since a program instance IS the assignment of a POU to a task. Earlier
# probes tried every type 0..24 but with the wrong NAMES, and every one answered "Cannot find X in
# Project", which is a search that ran and failed rather than a call that would not work.
#
# Now both halves are known, so this tries the type values that matter against the name shapes the
# project structure suggests - the bare name, and paths through the resource.
#
# The IDE must already have the project open: a standalone New-Object -ComObject launches a bare
# IDE when none is running, and every call then reports "There is no project open".
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject

Write-Host "  project: '$($proj.Name)'"

$TASK = 11
$PROGINST = 12

$names = @(
    'BG', 'Start', 'SlowTsk',
    'TopCutterCamSetup', 'TopCutterFFCamSetup', 'ServoTaskSlow',
    'MP2600iec', 'Resource', 'Configuration', 'Tasks',
    'MP2600iec.BG', 'Resource.BG', 'Resource.MP2600iec.BG',
    'TopCutter.MP2600iec.BG', 'TopCutter.Resource.MP2600iec.BG',
    'BG.TopCutterCamSetup', 'BG:TopCutterCamSetup',
    'MP2600iec.BG.TopCutterCamSetup'
)

foreach ($type in @($TASK, $PROGINST)) {
    $label = if ($type -eq $TASK) { 'adeOtTask' } else { 'adeOtProgramInstance' }
    Write-Host ""
    Write-Host "  === type $type ($label) ==="
    foreach ($name in $names) {
        try {
            $o = $proj.GetObjectByLogicalName($name, $type)
            if ($null -ne $o) {
                Write-Host "    '$name' -> $($o.GetType().Name)"
                $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                    Select-Object -First 14 |
                    ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
            } else {
                Write-Host "    '$name' -> null"
            }
        } catch {
            $m = $_.Exception.Message
            if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
            if ($m -notmatch '^Cannot find') { Write-Host "    '$name' -> $m" }
        }
    }
}

Write-Host ""
Write-Host "  === and the two other types worth trying with the right name ==="
foreach ($type in @(9, 10)) {
    foreach ($name in @('MP2600iec', 'Resource')) {
        try {
            $o = $proj.GetObjectByLogicalName($name, $type)
            if ($null -ne $o) { Write-Host "    type=$type '$name' -> $($o.GetType().Name)" }
        } catch { }
    }
}
