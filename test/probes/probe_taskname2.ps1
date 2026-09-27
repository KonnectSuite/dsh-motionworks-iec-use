# More logical-name shapes, now guided by two real facts.
#
# FACT 1 - the format. ActiveProject.Pous gives '/Pous/<name>', so a logical name is a
# slash-separated path rooted at '/', and "Logical POUs" is the segment 'Pous'.
#
# FACT 2 - the enum. A POU reports PouType = '7', and adeOtProgram is the 8th member of the
# declaration order read out of Ade.tlb, so the enum is 0-based in that order:
#
#     0 Application   1 Project     2 Libraries   3 Library    4 Pous
#     5 Function      6 FunctionBlock  7 Program  8 Hardware
#     9 Configuration 10 Resource   11 Task       12 ProgramInstance
#     13 FbInstance   14 Variable   15 Variables  16 DataTypes
#
# The Project Tree display names are 'Physical Hardware', 'Configuration : eCLR',
# 'Resource : MP2600iec', 'Tasks', 'BG : DEFAULT' - display labels, which for POUs were NOT the
# logical segment ('Logical POUs' -> 'Pous'). So the instance names eCLR and MP2600iec are tried
# as segments too, and so are the type-library's own collection names: _Configurations,
# _Resources, _Tasks, _ProgramInstances.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"

# A POU is reachable; use that as the control so a zero result means the SHAPE is wrong, not the
# call. Then vary only the tail that leads to a task.
Write-Host ""
Write-Host "  === control: the POU path that is known to work ==="
foreach ($type in @(0..16)) {
    try {
        $o = $proj.GetObjectByLogicalName('/Pous/TopCutterCamSetup', $type)
        if ($null -ne $o) {
            Write-Host "    '/Pous/TopCutterCamSetup' type=$type -> $($o.GetType().Name)  OK"
            break
        }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        if ($m -notmatch '^Cannot find') { Write-Host "    type=$type -> $m" }
    }
}

$tails = @(
    'Configuration/Resource/Tasks/BG',
    'Configuration/eCLR/Resource/MP2600iec/Tasks/BG',
    'Hardware/Configuration/Resource/Tasks/BG',
    'Hardware/eCLR/MP2600iec/Tasks/BG',
    'eCLR/MP2600iec/Tasks/BG',
    'eCLR/Resource/MP2600iec/Tasks/BG',
    'Configurations/Configuration/Resources/Resource/Tasks/BG',
    '_Configurations/Configuration/_Resources/Resource/_Tasks/BG',
    'Configurations/eCLR/Resources/MP2600iec/Tasks/BG',
    'Resource/MP2600iec/Tasks/BG',
    'Resources/MP2600iec/Tasks/BG',
    'MP2600iec/Tasks/BG',
    'Tasks/BG',
    'Task/BG',
    'BG'
)
$prefixes = @('', '/')

Write-Host ""
Write-Host "  === task shapes ==="
foreach ($prefix in $prefixes) {
    foreach ($tail in $tails) {
        $name = "$prefix$tail"
        foreach ($type in @(11, 12, 10, 9, 8, 4)) {
            try {
                $o = $proj.GetObjectByLogicalName($name, $type)
                if ($null -ne $o) {
                    Write-Host "    HIT '$name' type=$type -> $($o.GetType().Name)"
                    $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                        Select-Object -First 18 |
                        ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
                }
            } catch {
                $m = $_.Exception.Message
                if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
                if ($m -notmatch '^Cannot find') { Write-Host "    '$name' type=$type -> $m" }
            }
        }
    }
}

Write-Host ""
Write-Host "  === is BG perhaps a POU-like object with its own logical name? ==="
try {
    $o = $proj.GetObjectByLogicalName('/Pous/TopCutterCamSetup', 7)
    Write-Host "    a POU object's members again:"
    $o | Get-Member -MemberType Property -EA SilentlyContinue |
        Select-Object -First 20 | ForEach-Object { Write-Host "      $($_.Name)" }
} catch { Write-Host "    -> $($_.Exception.Message)" }
