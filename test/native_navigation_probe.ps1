param([Parameter(Mandatory=$true)][string]$ExpectedProject)
$ErrorActionPreference='Stop'
if($ExpectedProject -notmatch 'motionworks-ide-smoke-[a-f0-9-]+[\\/]\.motionworks[\\/]stage[\\/]TopCutterS5\.mwt$'){throw 'Disposable fixture required'}
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong open project'}
if($app.ActiveProject.IsModified){throw 'Unsaved project; navigation probe refused'}
$pou=$app.ActiveProject.Pous.Item('TopCutterCutControl')
$document='@POUS.'+$pou.Name+'.'+$pou.Name+'V'
$data=[object[]]@()
try {
 $app.OpenDocument($document,$true,[ref]$data)
 [ordered]@{document=$document;view=$app.ActiveProject.GetLogicalNameOfActiveView();modified=$app.ActiveProject.IsModified} | ConvertTo-Json -Compress
} catch { [ordered]@{document=$document;error=$_.Exception.Message;modified=$app.ActiveProject.IsModified} | ConvertTo-Json -Compress; exit 1 }
