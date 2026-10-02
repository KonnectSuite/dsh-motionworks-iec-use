param([Parameter(Mandatory=$true)][string]$ExpectedWorkspace)
$ErrorActionPreference='Stop'
if($ExpectedWorkspace -notmatch 'motionworks-ide-smoke-[a-f0-9-]+$'){throw 'Disposable fixture required'}
$taskWorkspace=[IO.Path]::GetFullPath($ExpectedWorkspace)
$taskProject=Join-Path $taskWorkspace '.motionworks\stage\TopCutterS5.mwt'
$taskRecord=Get-Content -Raw -LiteralPath (Join-Path $taskWorkspace '.motionworks\verification\native-variable-group-live.json') | ConvertFrom-Json
if($taskRecord.phase -cne 'variables_prepared'){throw 'Wrong retained phase; do not repeat'}
if(@(Get-Process -Name Mwt -ErrorAction SilentlyContinue).Count -ne 1){throw 'Requires sole IDE'}
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($taskProject) -or $app.ActiveProject.IsModified){throw 'Wrong project or unsaved changes'}
if($app.ActiveProject.Pous.Count -ne 8){throw 'Wrong POU inventory'}
$pou=$app.ActiveProject.Pous.Item('CodexGroupProbe')
$vars=$pou.Variables
if($vars.Count -ne 2 -or $vars.Groups.Count -ne 1){throw 'Wrong scratch declaration/group inventory'}
if($vars.Item('Mover').Group.Name -cne 'Default' -or $vars.Item('Anchor').Group.Name -cne 'Default'){throw 'Wrong initial groups'}
$vars.Groups.Create('Destination') | Out-Null
$app.ActiveProject.Save()
if($vars.Groups.Count -ne 2 -or $app.ActiveProject.IsModified){throw 'Group creation/save unverified'}
[ordered]@{method='native_Groups_Create';pou=$pou.Name;groups=$vars.Groups.Count;is_modified=[bool]$app.ActiveProject.IsModified} | ConvertTo-Json -Compress
