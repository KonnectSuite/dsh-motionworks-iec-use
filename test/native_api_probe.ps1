param([Parameter(Mandatory=$true)][string]$ExpectedProject)
$ErrorActionPreference='Stop'
# Deliberate capability probe against the existing disposable stage only.
if($ExpectedProject -notmatch 'motionworks-ide-smoke-[a-f0-9-]+[\\/]\.motionworks[\\/]stage[\\/]TopCutterS5\.mwt$'){throw 'Disposable fixture required'}
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong open project'}
$pou=$null
for($i=1;$i -le $app.ActiveProject.Pous.Count;$i++){
 $p=$app.ActiveProject.Pous.Item($i)
 if($p.Name -eq 'TopCutterCutControl'){$pou=$p}
}
if(-not $pou){throw 'Expected consumer missing'}
$vars=$pou.Variables
$before=$vars.Count
for($i=1;$i -le $before;$i++){if($vars.Item($i).Name -ieq 'CodexApiLocal'){throw 'Probe variable already exists; no retry'}}
# Installed Ade.tlb: Name,Type,BlockType,Description,InitialValue,IecAddress,Retain.
$vars.Create('CodexApiLocal','INT',1,'Native API probe','7','',$false) | Out-Null
$app.ActiveProject.Save()
$new=$null
for($i=1;$i -le $vars.Count;$i++){if($vars.Item($i).Name -eq 'CodexApiLocal'){$new=$vars.Item($i)}}
if(-not $new -or $vars.Count -ne ($before+1)){throw 'Create call did not prove exactly one addition'}
[ordered]@{operation='variable_create';before=$before;after=$vars.Count;name=$new.Name;type=$new.DataType;usage=$new.BlockType;initializer=$new.InitialValue;address=$new.IecAddress;description=$new.Comment} | ConvertTo-Json -Compress
# OpenDocument's third parameter is SAFEARRAY(VARIANT)*, not an integer.
$data=[object[]]@()
try {
 $app.OpenDocument('/Pous/TopCutterCutControl/TopCutterCutControlV',$true,[ref]$data)
 [ordered]@{operation='open_document';view=$app.ActiveProject.GetLogicalNameOfActiveView()} | ConvertTo-Json -Compress
} catch { [ordered]@{operation='open_document';error=$_.Exception.Message} | ConvertTo-Json -Compress }
