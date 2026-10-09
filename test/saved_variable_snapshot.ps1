$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$null,[ref]$null)
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-VariableSnapshot'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$script:reads=0;$script:drift=$false
$app=[pscustomobject]@{ActiveProject=[pscustomobject]@{IsModified=$false}}
$group=[pscustomobject]@{Name='Default';ReadOnly=$false}
$groups=[pscustomobject]@{Count=1;Row=$group}
$groups | Add-Member ScriptMethod Item {param($i) if($i -ne 1){throw 'Wrong group index'};return $this.Row}
$vars=[pscustomobject]@{Groups=$groups}
function Get-VariableSheet($a,$pou){if($pou -cne 'Main'){throw 'Wrong POU'};return $vars}
function Get-VariableRows($v){
 $script:reads++
 if($script:drift){$app.ActiveProject.IsModified=$true}
 return ,@(@{name='Existing';retain=$true})
}
function Refuses([scriptblock]$action){
 try { & $action | Out-Null } catch {if($_.Exception.Message -like '*REFUSED*'){return};throw}
 throw 'Expected refusal'
}
$snapshot=Get-VariableSnapshot $app 'Main' $true
if($snapshot.is_modified -ne $false -or $snapshot.variables[0].retain -ne $true -or $script:reads -ne 1){throw 'Complete saved snapshot not returned in one read'}
foreach($value in @($true,$null)){
 $app.ActiveProject.IsModified=$value
 Refuses {Get-VariableSnapshot $app 'Main' $true}
}
if($script:reads -ne 1){throw 'Dirty/unknown state must refuse before enumeration'}
$app.ActiveProject.IsModified=$false;$script:drift=$true
Refuses {Get-VariableSnapshot $app 'Main' $true}
$script:drift=$false
Refuses {Get-VariableSnapshot $app 'Main' 'true'}
$snapshot=Get-VariableSnapshot $app 'Main'
if($snapshot.Contains('is_modified')){throw 'Ordinary snapshot claimed a saved baseline'}
Write-Output 'Combined saved/native snapshot: one read, exact flags, dirty/unknown/drifting state refusal and read-only compatibility passed; no IDE invoked'
