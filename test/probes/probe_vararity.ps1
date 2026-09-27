# Find the arity of Variables.Create, then use it.
#
# "creates a new variable based on the specified parameters" - and a Variable object carries Name,
# DataType, InitialValue, IecAddress, BlockType, Group, Retain, Comment. So the call is some
# ordered subset of those, and the count is unknown. Zero, one and two arguments all report
# "Number of parameters specified does not match the expected number", so it is three or more.
#
# This tries shapes from three arguments upward, on the STAGED project, and reports the count
# before and after so a no-op cannot look like success. A validated variable API would replace the
# hand-built CFB writer - the one that once turned a 1132-byte .VB into zero and a 1565-byte grid
# into 79 MB by writing a grid record out of ROW order - and it would VALIDATE, which the file
# writes never did.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
$pou = $null
foreach ($i in 1..$proj.Pous.Count) {
    if ($proj.Pous.Item($i).Name -eq 'TopCutterCamSetup') { $pou = $proj.Pous.Item($i); break }
}
$vars = $pou.Variables
$before = $vars.Count
Write-Host "  TopCutterCamSetup: $before variables"

$NAME = 'ZzVarShape'

# What BlockType values exist? Try to learn from an existing variable first.
Write-Host ""
Write-Host "  === an existing variable, for reference values ==="
$sample = $vars.Item(1)
foreach ($prop in @('Name', 'DataType', 'InitialValue', 'IecAddress', 'BlockType', 'Group', 'Comment', 'Id')) {
    try { Write-Host "    $prop = '$($sample.$prop)'" } catch { Write-Host "    $prop -> (no)" }
}

$shapes = @(
    @($NAME, 'BOOL', 'FALSE'),
    @($NAME, 'BOOL', 'FALSE', ''),
    @($NAME, 'BOOL', 'FALSE', '', 'VAR'),
    @($NAME, 'BOOL', 'FALSE', '', 0),
    @($NAME, 'BOOL', 'VAR'),
    @($NAME, 'BOOL', 'VAR', 'FALSE'),
    @($NAME, 'BOOL', 'FALSE', 'VAR'),
    @($NAME, 'BOOL', 'FALSE', 'VAR', ''),
    @($NAME, 'BOOL', 'VAR', 'FALSE', ''),
    @($NAME, 'BOOL', 'VAR', '', 'FALSE', ''),
    @($NAME, 'BOOL', 'FALSE', 'VAR', '', ''),
    @($NAME, 'BOOL', 1, 0, 0, 0)
)

foreach ($shape in $shapes) {
    $desc = ($shape | ForEach-Object { "'$_'" }) -join ', '
    try {
        $r = $vars.GetType().InvokeMember('Create', 'InvokeMethod', $null, $vars, $shape)
        $after = $vars.Count
        Write-Host "    Create($desc) -> OK   $before -> $after"
        if ($after -gt $before) {
            Write-Host "      *** CREATED ***"
            $new = $null
            foreach ($i in 1..$after) {
                if ($vars.Item($i).Name -eq $NAME) { $new = $vars.Item($i); break }
            }
            if ($new) {
                foreach ($prop in @('Name', 'DataType', 'InitialValue', 'IecAddress', 'BlockType', 'Group', 'Id')) {
                    try { Write-Host "        $prop = '$($new.$prop)'" } catch { }
                }
            }
            break
        }
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        if ($msg -match 'Number of parameters') { Write-Host "    Create($desc) -> arity" }
        else { Write-Host "    Create($desc) -> $msg" }
    }
}

Write-Host ""
Write-Host "  final count: $($vars.Count)  (was $before)"
$names = @()
foreach ($i in 1..$vars.Count) { $names += $vars.Item($i).Name }
Write-Host "  variables: $($names -join ', ')"
