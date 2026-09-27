# Explore the COM ImportExports collection.
#
# Round 5 recorded import/export as a dead end because the providers' Execute took no
# parameters. But the app object also exposes an ImportExports PROPERTY, and the PLCopen help
# says Task is among the things it exports - with pouInstance inside task in the schema being
# exactly the program assignment this plugin cannot write. So it is worth looking again, at the
# collection rather than at a provider.
$ErrorActionPreference = 'Continue'

function Show($label, $value) {
    "  $label : $($value)"
}

$app = New-Object -ComObject Ade.Application.550
"  === ImportExports ==="
try {
    $ie = $app.ImportExports
    Show 'type' $ie.GetType().Name
    "  members:"
    $ie | Get-Member -EA SilentlyContinue | ForEach-Object { "    $($_.MemberType)  $($_.Name)" }
    try { Show 'count' $ie.Count } catch { Show 'count' "n/a - $($_.Exception.Message)" }
    try {
        "  --- items ---"
        for ($i = 0; $i -lt [Math]::Min(10, $ie.Count); $i++) {
            $item = $ie.Item($i)
            "    [$i] $($item.GetType().Name)"
            $item | Get-Member -MemberType Method, Property -EA SilentlyContinue |
                ForEach-Object { "         $($_.MemberType)  $($_.Name)" }
        }
    } catch { "    enumerate failed: $($_.Exception.Message)" }
} catch {
    "  ImportExports failed: $($_.Exception.Message)"
}

"  === ExternalImportExportProviders ==="
try {
    $ep = $app.ExternalImportExportProviders
    Show 'type' $ep.GetType().Name
    try { Show 'count' $ep.Count } catch {}
    $ep | Get-Member -EA SilentlyContinue | ForEach-Object { "    $($_.MemberType)  $($_.Name)" }
} catch { "  failed: $($_.Exception.Message)" }

"  === ExportEvcObject / ImportEvcObject signatures ==="
foreach ($name in @('ExportEvcObject', 'ImportEvcObject')) {
    $m = $app | Get-Member -Name $name -EA SilentlyContinue
    if ($m) { "    $name -> $($m.Definition)" } else { "    $name not found" }
}
