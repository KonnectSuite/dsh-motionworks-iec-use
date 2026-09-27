# The Variables collection over COM - the supported alternative to the binary grid writer.
#
# Everything this plugin does with declarations goes through a hand-built CFB writer that
# constructs .VGR grid records byte by byte. It works, and it destroyed a POU once getting there:
# a record written at the end instead of in ROW order turned a 1132-byte .VB into zero and a
# 1565-byte grid into 79 megabytes. Twelve integrity checks guard it now.
#
# The type library says a POU has a Variables collection, and the vocabulary includes
#
#     NewVariable                          "creates a new variable based on the specified parameters"
#     NewVariableGroup                     "creates a new VariableGroup based on the specified name"
#     AddEntry                             "adds a variable into the active tab"
#
# which is the same shape of discovery as the assignment: a supported API that validates, sitting
# behind an object model nobody had walked. This reads what the POU objects actually expose, and
# what a variable looks like once found - it does NOT write.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
Write-Host "  project: '$($proj.Name)'"

$pou = $null
foreach ($i in 1..$proj.Pous.Count) {
    $p = $proj.Pous.Item($i)
    if ($p.Name -eq 'TopCutterCamSetup') { $pou = $p; break }
}
if ($pou -eq $null) { Write-Host "  no TopCutterCamSetup"; exit 1 }
Write-Host "  POU: '$($pou.Name)'  LogicalName='$($pou.LogicalName)'  PouType='$($pou.PouType)'"

Write-Host ""
Write-Host "  === every member of the POU ==="
$pou | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "    $($_.MemberType)  $($_.Name)" }

Write-Host ""
Write-Host "  === its Variables collection ==="
$vars = $pou.Variables
Write-Host "    type: $($vars.GetType().Name)   count: $($vars.Count)"
Write-Host "    members:"
$vars | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "      $($_.MemberType)  $($_.Name)" }

Write-Host ""
Write-Host "  === the first few variables ==="
$n = [Math]::Min(5, $vars.Count)
for ($i = 1; $i -le $n; $i++) {
    $v = $vars.Item($i)
    $out = @()
    foreach ($prop in @('Name', 'DataType', 'InitialValue', 'Address', 'BlockType', 'Comment', 'Section')) {
        try {
            $val = $v.$prop
            if ($null -ne $val -and "$val" -ne '') { $out += "$prop='$val'" }
        } catch { }
    }
    Write-Host "    [$i] $($out -join '  ')"
    if ($i -eq 1) {
        Write-Host "        all members:"
        $v | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "          $($_.MemberType)  $($_.Name)" }
    }
}

Write-Host ""
Write-Host "  === is there a global-variables sheet, and how? ==="
foreach ($name in @('Global_Variables', 'GlobalVariables')) {
    foreach ($type in 0..16) {
        try {
            $o = $proj.GetObjectByLogicalName($name, $type)
            if ($null -ne $o) { Write-Host "    '$name' type=$type -> $($o.GetType().Name)" }
        } catch { }
    }
}
Write-Host "    --- the resource's own members again, looking for a variable sheet ---"
try {
    $res = $proj.GetObjectByLogicalName('Hardware/Configuration/Resource', 10)
    $res | Get-Member -EA SilentlyContinue | ForEach-Object { Write-Host "      $($_.MemberType)  $($_.Name)" }
} catch { Write-Host "      resource -> $($_.Exception.Message)" }
