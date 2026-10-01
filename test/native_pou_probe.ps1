param([Parameter(Mandatory=$true)][string]$ExpectedProject)
$ErrorActionPreference='Stop'
if($ExpectedProject -notmatch 'motionworks-ide-smoke-[a-f0-9-]+[\\/]\.motionworks[\\/]stage[\\/]TopCutterS5\.mwt$'){throw 'Disposable fixture required'}
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong open project'}
if($app.ActiveProject.IsModified){throw 'Unsaved project'}
$pous=$app.ActiveProject.Pous
$names=@('CodexNativePou','CodexNativeRenamed','CodexNativeCopy')
for($i=1;$i -le $pous.Count;$i++){if([string]$pous.Item($i).Name -in $names){throw 'Probe name exists; no retry'}}
$before=$pous.Count
# Exact installed type library: Name, object Type, Language, ReturnType, PlcType, ProcessorType.
[void]$pous.Create($names[0],7,2,'','','')
$app.ActiveProject.Save()
$made=$pous.Item($names[0])
if($pous.Count -ne $before+1 -or $made.PouType -ne 7 -or $made.PouLanguage -ne 2){throw 'Create not proven'}
@{operation='create';count=$pous.Count;name=$made.Name;path=$made.Path} | ConvertTo-Json -Compress
$made.Name=$names[1]
$app.ActiveProject.Save()
@{operation='rename';count=$pous.Count;name=$pous.Item($names[1]).Name} | ConvertTo-Json -Compress
[void]$pous.Item($names[1]).Copy($names[2])
$app.ActiveProject.Save()
Start-Sleep -Milliseconds 500
$pous=$app.ActiveProject.Pous
@{operation='copy';count=$pous.Count;name=$pous.Item($names[2]).Name} | ConvertTo-Json -Compress
# Only the two unassigned, unused test POUs created above are deleted.
$pous.Item($names[2]).Delete()
$pous.Item($names[1]).Delete()
$app.ActiveProject.Save()
Start-Sleep -Milliseconds 500
$pous=$app.ActiveProject.Pous
if($pous.Count -ne $before){throw 'Cleanup not proven'}
@{operation='delete';count=$pous.Count;modified=$app.ActiveProject.IsModified} | ConvertTo-Json -Compress
