param([Parameter(Mandatory=$true)][string]$ExpectedProject)
$ErrorActionPreference='Stop'
if($ExpectedProject -notmatch 'motionworks-ide-smoke-[a-f0-9-]+[\\/]\.motionworks[\\/]stage[\\/]TopCutterS5\.mwt$'){throw 'Disposable fixture required'}
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong open project'}
if($app.ActiveProject.IsModified){throw 'Unsaved project'}
$resource=$app.ActiveProject.GetObjectByLogicalName('Hardware/Configuration/Resource',10)
$tasks=$resource.Tasks;$name='CxTst1';$before=$tasks.Count
for($i=1;$i -le $before;$i++){if([string]$tasks.Item($i).Name -ieq $name){throw 'Probe name exists; no retry'}}
[void]$tasks.Create($name,'CYCLIC')
$app.ActiveProject.Save()
Start-Sleep -Milliseconds 500
$task=$resource.Tasks.Item($name)
@{operation='create';name=$task.Name;kind=$task.Type;count=$resource.Tasks.Count} | ConvertTo-Json -Compress
$root=[IO.Path]::ChangeExtension($ExpectedProject,$null)
$file=Join-Path $root ('C\Configuration\R\Resource\'+$name+'.SET')
$text=[IO.File]::ReadAllText($file)
Write-Output $text
if($text -notmatch 'INTERVAL\s*:=\s*[^,;\r\n]+'){throw 'No cyclic interval'}
$updated=$text -replace '(INTERVAL\s*:=\s*)[^,;\r\n]+','${1}T#20ms'
$input=Join-Path (Split-Path (Split-Path (Split-Path $ExpectedProject))) ('native-task-input-'+[guid]::NewGuid().ToString('N')+'.SET')
[IO.File]::WriteAllText($input,$updated,[Text.Encoding]::ASCII)
$task.ImportSettingsFile($input)
$app.ActiveProject.Save()
$saved=[IO.File]::ReadAllText($file)
if($saved -notmatch 'INTERVAL\s*:=\s*T#20ms'){throw 'Import did not persist requested interval'}
@{operation='import_settings';kind=$task.Type;saved=$saved;input=$input} | ConvertTo-Json -Compress
if($task.ProgramInstances.Count -ne 0){throw 'Probe has programs; refuse delete'}
$task.Delete()
$app.ActiveProject.Save()
@{operation='delete';count=$resource.Tasks.Count;modified=$app.ActiveProject.IsModified} | ConvertTo-Json -Compress
