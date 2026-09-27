# Map the six parameters of Variables.Create.
#
# Measured: Create('ZzVarShape', 'BOOL', 1, 0, 0, 0) returns OK and produces a real variable with
# Id 1059, BlockType '1', InitialValue '0'. Passing strings where the numbers go gives
# "Type mismatch", so arguments 3..6 are numeric.
#
# One at a time, on the staged project, each created variable renamed so the results cannot be
# confused. The existing local TopCutterCamTableID reports BlockType '5', which is the anchor:
# if 5 means VAR then 3, 4 and 6 mean the other sections, and a variable created with 5 and read
# back through mw_code_read_st should appear as a plain VAR.
#
# A validated, IDE-written variable API is worth a great deal here. The hand-built CFB writer
# constructs .VGR records byte by byte and once turned a 1132-byte .VB into zero and a 1565-byte
# grid into 79 megabytes by writing a record out of ROW order.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$pou = $null
foreach ($i in 1..$proj.Pous.Count) {
    if ($proj.Pous.Item($i).Name -eq 'TopCutterCamSetup') { $pou = $proj.Pous.Item($i); break }
}
$vars = $pou.Variables
Write-Host "  start: $($vars.Count) variables"

function Show-Var($v) {
    $out = @()
    foreach ($prop in @('Name', 'DataType', 'InitialValue', 'IecAddress', 'BlockType', 'Id')) {
        try { $out += "$prop='$($v.$prop)'" } catch { }
    }
    return ($out -join '  ')
}

# 1. vary the third argument - the block/section
Write-Host ""
Write-Host "  === argument 3 (block/section), 0..8 ==="
foreach ($b in 0..8) {
    $nm = "ZzBlk$b"
    try {
        $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars,
            @($nm, 'BOOL', $b, 0, 0, 0)) | Out-Null
        $got = $null
        foreach ($i in 1..$vars.Count) { if ($vars.Item($i).Name -eq $nm) { $got = $vars.Item($i) } }
        if ($got) { Write-Host "    block=$b -> created : $(Show-Var $got)" }
    } catch {
        $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    block=$b -> $m"
    }
}

# 2. vary the fourth argument - what does it set?
Write-Host ""
Write-Host "  === argument 4, 0..3 (holding the rest at block=1) ==="
foreach ($c in 0..3) {
    $nm = "ZzArg4_$c"
    try {
        $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars,
            @($nm, 'BOOL', 1, $c, 0, 0)) | Out-Null
        $got = $null
        foreach ($i in 1..$vars.Count) { if ($vars.Item($i).Name -eq $nm) { $got = $vars.Item($i) } }
        if ($got) { Write-Host "    arg4=$c -> $(Show-Var $got)" }
    } catch {
        $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    arg4=$c -> $m"
    }
}

# 3. and the last two
Write-Host ""
Write-Host "  === arguments 5 and 6 ==="
foreach ($pair in @(@(0, 0), @(1, 1), @(2, 3), @(7, 7))) {
    $nm = "ZzArg56_$($pair[0])_$($pair[1])"
    try {
        $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars,
            @($nm, 'BOOL', 1, 0, $pair[0], $pair[1])) | Out-Null
        $got = $null
        foreach ($i in 1..$vars.Count) { if ($vars.Item($i).Name -eq $nm) { $got = $vars.Item($i) } }
        if ($got) { Write-Host "    arg5=$($pair[0]) arg6=$($pair[1]) -> $(Show-Var $got)" }
    } catch {
        $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    arg5=$($pair[0]) arg6=$($pair[1]) -> $m"
    }
}

Write-Host ""
Write-Host "  === and a non-BOOL type, to see how the type is taken ==="
foreach ($t in @('INT', 'REAL', 'STRING')) {
    $nm = "ZzType$t"
    try {
        $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars,
            @($nm, $t, 1, 0, 0, 0)) | Out-Null
        $got = $null
        foreach ($i in 1..$vars.Count) { if ($vars.Item($i).Name -eq $nm) { $got = $vars.Item($i) } }
        if ($got) { Write-Host "    '$t' -> $(Show-Var $got)" }
    } catch {
        $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        Write-Host "    '$t' -> $m"
    }
}

Write-Host ""
Write-Host "  final: $($vars.Count) variables"
