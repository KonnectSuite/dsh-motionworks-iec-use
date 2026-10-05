$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($name in @('Get-VariableRows','Get-GroupMemberRows','Get-VariableGroupSnapshot')){
 $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 . ([scriptblock]::Create($fn.Extent.Text))
}
function New-Collection($rows){
 $c=[pscustomobject]@{Rows=@($rows);Reads=0;ItemsRead=0;Drift=$false}
 $c | Add-Member ScriptProperty Count {$this.Reads++;return $this.Rows.Length+[int]($this.Drift -and $this.ItemsRead -gt 0)}
 $c | Add-Member ScriptMethod Item {param($i) $this.ItemsRead++;return $this.Rows[$i-1]}
 return $c
}
function New-Sheet($name,$section,$groupName){
 $g=[pscustomobject]@{Name=$groupName;ReadOnly=$false}
 $v=[pscustomobject]@{Name=$name;DataType='INT';BlockType=$section;Group=$g;IecAddress='';InitialValue='3';Comment='';Retain=$true;PDD=$false;OPC=$true;Disabled=$false;NotOnPlc=$false;Redundant=$false}
 $vars=New-Collection @($v);$g | Add-Member NoteProperty Variables $vars
 $vars | Add-Member NoteProperty Groups (New-Collection @($g));return $vars
}
$script:local=New-Sheet 'LocalValue' 1 'Default';$script:globalVars=New-Sheet 'GlobalValue' 6 'User Variables'
$pous=New-Collection @([pscustomobject]@{Name='Main';Variables=$local})
$libs=New-Collection @([pscustomobject]@{Name='IEC';FullName='IEC.fwl';LogicalName='IEC'})
$app=[pscustomobject]@{ActiveProject=[pscustomobject]@{Pous=$pous;Libraries=$libs}}
function Get-VariableSheet($app,$pou){if($pou){return $script:local};return $script:globalVars}
$script:structureReads=0;$script:structureDrift=$false
function Get-NativeStructure($app){
 $script:structureReads++
 $name=if($script:structureDrift -and $script:structureReads -gt 1){'Changed'}else{'Main'}
 return [ordered]@{pous=@([ordered]@{name=$name;read_only=$false;language=2;type='PROGRAM'});tasks=@()}
}
$result=Get-VariableGroupSnapshot $app 'Main'
if($result.variables[0].retain -ne $true -or $result.variables[0].opc -ne $true -or $result.groups[0].name -cne 'Default'){throw 'Target flags/groups missing'}
if($result.group_membership.globals[0].members[0] -cne 'GlobalValue' -or $result.group_membership['pou:Main'][0].members[0] -cne 'LocalValue'){throw 'Complete project group membership missing'}
if($local.Reads -ne 4 -or $local.ItemsRead -ne 2 -or $local.Groups.Reads -ne 2 -or $libs.Reads -ne 2 -or $structureReads -ne 2){throw 'Snapshot lookups not bounded'}
function Assert-Refused($action,$pattern){try{& $action | Out-Null}catch{if($_.Exception.Message -match $pattern){return};throw};throw "Expected refusal: $pattern"}
$local.ItemsRead=0;$local.Drift=$true
Assert-Refused {Get-GroupMemberRows $local} 'group members changed'
$local.Drift=$false;$local.Groups.ItemsRead=0;$local.Groups.Drift=$true
Assert-Refused {Get-GroupMemberRows $local} 'group count changed'
$local.Groups.Drift=$false;$structureReads=0;$structureDrift=$true
Assert-Refused {Get-VariableGroupSnapshot $app 'Main'} 'structure changed'
Write-Output 'Native group reader complete project membership, target flags, bounded reads and member/group/structure drift refusals passed; no IDE invoked'
