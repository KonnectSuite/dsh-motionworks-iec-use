# GetObjectByLogicalName - the way to reach ExportEvcObject / ImportEvcObject.
#
# Those two methods take an AdeEvcObject, and this is the only method on the project that looks
# like it produces one. If a Task can be named here, then:
#
#     task = GetObjectByLogicalName(<name of the task>)
#     app.ExportEvcObject(task)        -> the task's PLCopen XML
#     app.ImportEvcObject(task)        -> read a modified one back
#
# and an import is exactly what would let a task's pouInstance list be rewritten from outside the
# IDE, which is the one write this plugin has never been able to make.
#
# The logical name format is unknown, so this tries the shapes the project structure suggests:
# the bare name, and paths through Configuration / Resource / Tasks.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject

$candidates = @(
    'BG',
    'Tasks\BG',
    'Resource\Tasks\BG',
    'Configuration\Resource\Tasks\BG',
    'MP2600iec\Tasks\BG',
    'TopCutterCamSetup',
    'Logical POUs\TopCutterCamSetup',
    'POU\TopCutterCamSetup'
)

Write-Host "  === GetObjectByLogicalName ==="
foreach ($name in $candidates) {
    try {
        $o = $proj.GetObjectByLogicalName($name)
        if ($null -eq $o) {
            Write-Host "    '$name' -> null"
        } else {
            Write-Host "    '$name' -> $($o.GetType().Name)"
            $o | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                Select-Object -First 12 |
                ForEach-Object { Write-Host "         $($_.MemberType)  $($_.Name)" }
        }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    '$name' -> $m"
    }
}

Write-Host ""
Write-Host "  === what else is on the project that could enumerate objects? ==="
$proj | Get-Member -MemberType Method -EA SilentlyContinue |
    Where-Object { $_.Name -match '(?i)object|evc|name|find|get' } |
    ForEach-Object { Write-Host "    $($_.Name) : $($_.Definition)" }

Write-Host ""
Write-Host "  === and on the application ==="
$app | Get-Member -MemberType Method -EA SilentlyContinue |
    Where-Object { $_.Name -match '(?i)object|evc|export|import|active' } |
    ForEach-Object { Write-Host "    $($_.Name) : $($_.Definition)" }
