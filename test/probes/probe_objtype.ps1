# With a project actually open: find the AdeObjectType values, and try an export.
#
# The earlier runs reported "There is no project open" because each New-Object -ComObject either
# reached a bare IDE or launched one. With the plugin's own start+open sequence having run first,
# the project is loaded and these calls mean something.
#
# GetObjectByLogicalName(string, AdeObjectType) needs an enum whose values are unknown, and a COM
# enum is just an integer on the wire, so the values are found by trying. The names tried are the
# ones the project structure suggests, and the OBJECT is wanted for ExportEvcObject, which takes
# an AdeEvcObject and would produce the task's PLCopen XML - the format that carries pouInstance.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject

Write-Host "  === is the project visible from here? ==="
try { Write-Host "    ActiveProject.Name = '$($proj.Name)'" } catch { Write-Host "    Name -> $($_.Exception.Message)" }
try { Write-Host "    GetLogicalNameOfActiveView = '$($proj.GetLogicalNameOfActiveView())'" }
catch { Write-Host "    GetLogicalNameOfActiveView -> $($_.Exception.Message)" }

Write-Host ""
Write-Host "  === GetObjectByLogicalName across object types ==="
$names = @('BG', 'Start', 'SlowTsk', 'TopCutterCamSetup', 'Resource', 'MP2600iec')
foreach ($name in $names) {
    $found = $false
    foreach ($type in 0..24) {
        try {
            $o = $proj.GetObjectByLogicalName($name, $type)
            if ($null -ne $o) {
                Write-Host "    '$name' type=$type -> $($o.GetType().Name)"
                $found = $true
                break
            }
        } catch {
            $m = $_.Exception.Message
            if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
            if ($m -notmatch 'no project open|Cannot find an overload') {
                if ($type -eq 0) { Write-Host "    '$name' -> $m" }
            }
        }
    }
    if (-not $found) { Write-Host "    '$name' -> no type value 0..24 returned an object" }
}

Write-Host ""
Write-Host "  === the project's own object-ish methods ==="
$proj | Get-Member -MemberType Method -EA SilentlyContinue |
    Where-Object { $_.Name -match '(?i)object|evc|instance|task|pou|resource|config' } |
    ForEach-Object { Write-Host "    $($_.Name) : $($_.Definition)" }
