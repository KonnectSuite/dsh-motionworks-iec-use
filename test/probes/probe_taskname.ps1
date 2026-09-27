# Find the task's logical name, now that the FORMAT is known.
#
# ActiveProject.Pous gave real examples:
#
#     LogicalName = '/Pous/TopCutterFFCamSetup'
#     LogicalName = '/Pous/TopCutterCamSetup'
#
# so a logical name is a slash-separated path rooted at '/', and the Project Tree's "Logical POUs"
# has a logical name of 'Pous'. The Project Tree shows the rest of the shape:
#
#     Physical Hardware
#       Configuration : eCLR
#         Resource : MP2600iec
#           Tasks
#             BG : DEFAULT
#               TopCutterCamSetup
#
# so the task is somewhere under a Configuration / Resource / Tasks path. The labels in the tree
# are display names, not necessarily logical segments, so several spellings are tried against the
# two type values that matter: adeOtTask (11) and adeOtProgramInstance (12).
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"

$segments = @(
    '/Configuration/Resource/Tasks/BG',
    '/Configurations/Configuration/Resources/Resource/Tasks/BG',
    '/Physical Hardware/Configuration/Resource/Tasks/BG',
    '/PhysicalHardware/Configuration/Resource/Tasks/BG',
    '/Configuration/eCLR/Resource/MP2600iec/Tasks/BG',
    '/Resources/MP2600iec/Tasks/BG',
    '/Resource/MP2600iec/Tasks/BG',
    '/Tasks/BG',
    '/Resource/Tasks/BG',
    '/MP2600iec/Tasks/BG',
    '/Configuration/eCLR/Resource/MP2600iec/Tasks/BG/ProgramInstances',
    '/Configuration/Resource/Tasks/BG/ProgramInstances',
    '/Pous/BG'
)

foreach ($type in @(11, 12, 10, 9, 8)) {
    $found = 0
    foreach ($name in $segments) {
        try {
            $o = $proj.GetObjectByLogicalName($name, $type)
            if ($null -ne $o) {
                Write-Host "  type is $type : '$name' -> $($o.GetType().Name)"
                $found++
                $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                    Select-Object -First 16 |
                    ForEach-Object { Write-Host "        $($_.MemberType)  $($_.Name)" }
            }
        } catch {
            $m = $_.Exception.Message
            if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
            if ($m -notmatch '^Cannot find') { Write-Host "  type is $type : '$name' -> $m" }
        }
    }
    Write-Host "  type is $type -> $found hit(s)"
}

Write-Host ""
Write-Host "  === read a POU's full property set - Path and GroupPath may show the segments ==="
$p = $proj.Pous.Item(2)
foreach ($prop in @('Name', 'LogicalName', 'Path', 'GroupPath', 'PouType', 'PlcType')) {
    try { Write-Host "    $prop = '$($p.$prop)'" } catch { Write-Host "    $prop -> $($_.Exception.Message)" }
}
Write-Host "    --- its variables collection ---"
try {
    $v = $p.Variables
    Write-Host "      count: $($v.Count)"
    $v | Get-Member -MemberType Method, Property -EA SilentlyContinue |
        Select-Object -First 12 | ForEach-Object { Write-Host "        $($_.MemberType)  $($_.Name)" }
} catch { Write-Host "      Variables -> $($_.Exception.Message)" }
