param([Parameter(Mandatory=$true)][string]$ExpectedWorkspace)
$ErrorActionPreference='Stop'
$taskExpected='C:\Users\Admin\Desktop\Codex Workspace\motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266'
if([IO.Path]::GetFullPath($ExpectedWorkspace) -cne $taskExpected){throw 'Exact disposable fixture required'}
if(@(Get-Process -Name Mwt -ErrorAction SilentlyContinue).Count -ne 1){throw 'Sole existing IDE required'}
$taskProject=Join-Path $taskExpected '.motionworks\stage\TopCutterS5'
$taskPath=Join-Path $taskExpected '.motionworks\verification\toolbox-graph-65297b7e-2833-42ad-8cca-bb70b4fd9f79.json'
$taskRecord=Get-Content -Raw -LiteralPath $taskPath | ConvertFrom-Json
if($taskRecord.phase -cne 'probe_removed_collateral_unresolved' -or $taskRecord.probe_removed -ne $true){throw 'Wrong retained phase; no retry'}
$taskReceipt=Get-Content -Raw -LiteralPath (Join-Path $taskExpected '.motionworks\verification\pou-conversion-2cabe2f0-ecbe-4e47-afc7-4022c5283f7a.json') | ConvertFrom-Json
$taskNative=($taskReceipt.events | Where-Object name -ceq 'native').value.declarations.globals
foreach($taskHash in $taskRecord.after.file_hashes.PSObject.Properties){
 $taskFile=[IO.Path]::GetFullPath((Join-Path $taskProject $taskHash.Name))
 if(-not $taskFile.StartsWith($taskProject+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Source outside fixture'}
 if((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash -ine $taskHash.Value){throw ('Saved source changed: '+$taskHash.Name)}
}
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Bridge parse errors'}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-VariableRows'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -cne ($taskProject+'.mwt') -or $app.ActiveProject.IsModified){throw 'Wrong project or unsaved state'}
$vars=$app.ActiveProject.GetObjectByLogicalName('Hardware/Configuration/Resource',10).Variables
$before=Get-VariableRows $vars
if(($before | ConvertTo-Json -Depth 10 -Compress) -cne ($taskNative.variables | ConvertTo-Json -Depth 10 -Compress)){throw 'Native rows/flags changed since retained observation'}
$groups=@();$target=$null
for($i=1;$i -le $vars.Groups.Count;$i++){
 $g=$vars.Groups.Item($i);$groups+=,[ordered]@{name=[string]$g.Name;read_only=[bool]$g.ReadOnly}
 if([string]$g.Name -ceq ' n'){$target=$g}
 if([string]$g.Name -ceq 'System Variables'){throw 'Destination already exists; inspect state'}
}
if(($groups | ConvertTo-Json -Depth 10 -Compress) -cne ($taskNative.groups | ConvertTo-Json -Depth 10 -Compress) -or -not $target -or $target.ReadOnly){throw 'Groups changed or exact writable group absent'}
$members=@($before | Where-Object group -ceq ' n')
if($members.Count -ne 36){throw 'Wrong group member inventory'}
foreach($row in $members){
 $original=@($taskRecord.baseline.globals | Where-Object name -ceq $row.name)
 if($original.Count -ne 1 -or $original[0].group -cne 'System Variables'){throw 'Original group mapping unproven'}
}
$repairPath=Join-Path $taskExpected '.motionworks\verification\fixture-group-restore.json'
if(Test-Path -LiteralPath $repairPath){throw 'Retained restoration exists; inspect instead of retry'}
$repair=[ordered]@{phase='requested';accepted=$false;before=$before;groups=$groups;project=$taskProject;method='native_VariableGroup_Name';controller_downloaded=$false}
function Retain-Repair {$repair | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $repairPath -Encoding UTF8}
Retain-Repair
$target.Name='System Variables'
$app.ActiveProject.Save()
$after=Get-VariableRows $vars
// Keep the raw before rows intact in the retained receipt.
$expected=$before | ConvertTo-Json -Depth 10 | ConvertFrom-Json
foreach($row in $expected){if($row.group -ceq ' n'){$row.group='System Variables'}}
$repair.after=$after;$repair.phase='saved_native_observed';Retain-Repair
if($target.Name -cne 'System Variables' -or $app.ActiveProject.IsModified -or ($expected | ConvertTo-Json -Depth 10 -Compress) -cne ($after | ConvertTo-Json -Depth 10 -Compress)){throw 'Exact native restoration/save unverified'}
$repair.phase='native_verified';Retain-Repair
[ordered]@{phase=$repair.phase;group=[string]$target.Name;members=$members.Count;evidence_path=$repairPath} | ConvertTo-Json -Compress
