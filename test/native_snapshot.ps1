$ErrorActionPreference = 'Stop'
# Run actual reader functions with instrumented collections; no IDE/UI input.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($name in @('Get-VariableRows','Get-PouPackageState')) {
    $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    . ([scriptblock]::Create($fn.Extent.Text))
}
function New-Collection($rows) {
    $c=[pscustomobject]@{Rows=@($rows);Reads=0;ItemsRead=0;Drift=$false}
    $c | Add-Member ScriptProperty Count {$this.Reads++;return $this.Rows.Length+[int]($this.Drift -and $this.ItemsRead -gt 0)}
    $c | Add-Member ScriptMethod Item {param($i) $this.ItemsRead++;return $this.Rows[$i-1]}
    return $c
}
function Log($m) {$script:messages+=,$m}
function Get-NativeStructure($app) {return [ordered]@{pous=@([ordered]@{name='Main'});tasks=@()}}
function Get-VariableSheet {throw 'Repeated POU lookup must not occur'}
$script:messages=@()
$group=[pscustomobject]@{Name='Default';ReadOnly=$false}
$v=[pscustomobject]@{Name='Input';DataType='BOOL';BlockType=1;Group=$group;IecAddress='';InitialValue='FALSE';Comment='';Retain=$true;PDD=$false;OPC=$true;Disabled=$false;NotOnPlc=$false;Redundant=$false}
$vars=New-Collection @($v)
$groups=New-Collection @($group)
$vars | Add-Member NoteProperty Groups $groups
$globals=New-Collection @()
$globals | Add-Member NoteProperty Groups (New-Collection @())
$pous=New-Collection @([pscustomobject]@{Name='Main';Variables=$vars})
$libs=New-Collection @([pscustomobject]@{Name='IEC';FullName='IEC.fwl';LogicalName='IEC'})
$project=[pscustomobject]@{Pous=$pous;Libraries=$libs;Resource=[pscustomobject]@{Variables=$globals}}
$project | Add-Member ScriptMethod GetObjectByLogicalName {param($name,$kind) return $this.Resource}
$app=[pscustomobject]@{ActiveProject=$project}
$result=Get-PouPackageState $app
$row=$result.declarations['pou:Main'].variables[0]
if($row.name -cne 'Input' -or $row.section -cne 'VAR' -or $row.address -ne $null -or $row.description -ne $null -or $row.initial_value -cne 'FALSE' -or $row.retain -ne $true -or $row.opc -ne $true){throw 'Declaration data changed'}
if($vars.Reads -ne 2 -or $groups.Reads -ne 2 -or $pous.ItemsRead -ne 1 -or $libs.Reads -ne 2){throw 'Collection lookups were not bounded'}
if($result.declarations.globals.variables.Count -ne 0 -or $result.libraries.Count -ne 1 -or $messages[-1] -notmatch 'package snapshot complete elapsed_ms='){throw 'Snapshot structure or timing missing'}
function Assert-Refused($action,$pattern) {
    try {& $action | Out-Null} catch {if($_.Exception.Message -match $pattern){return};throw}
    throw "Expected refusal: $pattern"
}
$vars.ItemsRead=0;$vars.Drift=$true
Assert-Refused {Get-VariableRows $vars} 'declaration count changed'
$vars.Drift=$false;$groups.ItemsRead=0;$groups.Drift=$true
Assert-Refused {Get-PouPackageState $app} 'groups changed'
$groups.Drift=$false;$pous.Rows[0].Name='Other'
Assert-Refused {Get-PouPackageState $app} 'POU identity changed'
$pous.Rows[0].Name='Main';$pous.Rows=@()
Assert-Refused {Get-PouPackageState $app} 'POU count changed'
Write-Output 'Native snapshot bounded lookups, exact values/flags, timing and inventory-drift checks passed; no IDE invoked'
