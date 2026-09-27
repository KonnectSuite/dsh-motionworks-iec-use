# Find what plc_open_xml_export / plc_open_xml_import want.
#
# Execute() reports "One or more arguments are invalid" where the two stubbed entries report
# "Not implemented" - so these two are implemented and need parameters. The type library shows
# void Execute() with no parameters, so the real signature is behind IDispatch late binding and
# has to be found by trying. InvokeMember passes an ARRAY as the argument list, which is the only
# way to vary arity from PowerShell.
$ErrorActionPreference = 'Continue'

$out = 'C:\Users\KNPhu\OneDrive\Desktop\dsh-MotionWorksIEC-use\xmlprobe.xml'
$app = New-Object -ComObject Ade.Application.550
$ie = $app.ImportExports

function Show-Try($item, $label, $argumentList) {
    try {
        $r = $item.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $item, $argumentList)
        $desc = if ($null -eq $r) { '<no return>' } else { "$r" }
        Write-Host "      $label -> OK  $desc"
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "      $label -> $m"
    }
}

Write-Host "  === item 5: plc_open_xml_export (Direction=1) ==="
$item5 = $ie.Item(5)
Show-Try $item5 'Execute()' @()
Show-Try $item5 'Execute(path)' @($out)
Show-Try $item5 'Execute(path, true)' @($out, $true)
Show-Try $item5 'Execute(true)' @($true)
Show-Try $item5 'Execute(1)' @(1)
Show-Try $item5 'Execute(path, path)' @($out, $out)

Write-Host ""
Write-Host "  === item 6: plc_open_xml_import (Direction=2) ==="
$item6 = $ie.Item(6)
Show-Try $item6 'Execute()' @()
Show-Try $item6 'Execute(path)' @($out)
Show-Try $item6 'Execute(path, true)' @($out, $true)
Show-Try $item6 'Execute(1)' @(1)

Write-Host ""
Write-Host "  === the app's own export/import, which take an AdeEvcObject ==="
try {
    $proj = $app.ActiveProject
    Write-Host "    ActiveProject type: $($proj.GetType().Name)"
    $names = $proj | Get-Member -MemberType Method -EA SilentlyContinue |
        Where-Object { $_.Name -match '(?i)evc|export|import|object' } |
        Select-Object -ExpandProperty Name
    if ($names) { $names | ForEach-Object { Write-Host "      $_" } } else { Write-Host "      (none)" }
} catch {
    Write-Host "    ActiveProject failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "  === did anything get written? ==="
if (Test-Path $out) {
    Write-Host "    YES: $((Get-Item $out).Length) bytes"
} else {
    Write-Host "    no file written"
}
