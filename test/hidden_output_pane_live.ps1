# Opt-in read-only diagnostics plus reversible visibility setup, sole fixture.
$ErrorActionPreference='Stop'
$workspace=$env:MOTIONWORKS_MCP_WORKSPACE
if($workspace -notmatch 'motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$'){throw 'Exact disposable fixture required'}
$project=Join-Path $workspace '.motionworks\stage\TopCutterS5.mwt'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$add=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type' -and $n.Extent.Text -match 'public class MWW'},$true)|Select-Object -First 1
Invoke-Expression $add.Extent.Text
foreach($name in 'Get-IdeWindow','Get-IdePid'){
 $fn=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)|Select-Object -First 1
 Invoke-Expression $fn.Extent.Text
}
$app=New-Object -ComObject Ade.Application.550
function Connect-App {return $app}
$script:recoveries=@()
function Log {param($message);$script:recoveries+=$message}
function Assert-StagedOpen {param($app,$verb)
 if(-not $app.IsProjectOpen -or [IO.Path]::GetFullPath([string]$app.ActiveProject.FullName) -ne [IO.Path]::GetFullPath($project)){throw 'Fixture identity mismatch'}
}
Assert-StagedOpen $app 'test'
$read=$null
foreach($switch in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'read_output'){$body=$clause.Item2.Extent.Text;$read=[scriptblock]::Create($body.Substring(1,$body.Length-2))}}
}
if(-not $read){throw 'Production reader missing'}
$record=[ordered]@{accepted=$false;controller_downloaded=$false;panes=@();layout_preserved=$false}
$file=Join-Path $workspace ('.motionworks\verification\hidden-output-'+[guid]::NewGuid().ToString()+'.json')
$root=[IntPtr]::Zero;$visible=$false
try{
 $req=@{pane='Errors';limit=5000};. $read
 $root=[IntPtr]$script:msgWin
 if($root -eq [IntPtr]::Zero){throw 'Exact Message Window missing'}
 $visible=[MWW]::IsWindowVisible($root)
 if(-not $visible){throw 'Visible baseline required for reversible test'}
 $frame=Get-IdeWindow
 $executable=(Get-Process -Id (Get-IdePid) -ErrorAction Stop).Path
 if(-not [MWW]::HasMessageWindowCommand($executable)){throw 'Installed Message Window command not proven'}
 foreach($pane in 'Errors','Warnings','Build','Infos'){
  $req=@{pane=$pane;limit=5000};. $read;$before=$data
  if(-not [MWW]::PostMessage([IntPtr]$frame,0x0111,[IntPtr]36554,[IntPtr]::Zero)){throw 'Hide setup request refused'}
  Start-Sleep -Milliseconds 700
  if([MWW]::IsWindowVisible($root)){throw 'Hidden setup not observed'}
  . $read;$hidden=$data
  if($script:recoveries.Count -ne $record.panes.Count+1){throw 'Exact native recovery command path was not observed once per hidden setup'}
  if(-not [MWW]::IsWindowVisible($root)){throw 'Native recovery did not expose parent'}
  if(($before.lines|ConvertTo-Json -Compress) -cne ($hidden.lines|ConvertTo-Json -Compress)){throw "Hidden $pane diagnostics differ"}
  . $read;$restored=$data
  if(($before.lines|ConvertTo-Json -Compress) -cne ($restored.lines|ConvertTo-Json -Compress)){throw "Restored $pane diagnostics differ"}
  $record.panes+=@{pane=$pane;count=$hidden.count;lines=$hidden.lines;unchanged=$true}
 }
 if(-not ($record.panes | Where-Object {$_.count -gt 0})){throw 'Nonempty diagnostic evidence required'}
 $record.accepted=$true
 $record.native_recovery_messages=$script:recoveries
}catch{$record.error=$_.Exception.Message;throw}
finally{
 if($root -ne [IntPtr]::Zero -and $visible){
  if(-not [MWW]::IsWindowVisible($root) -and $frame -and [MWW]::HasMessageWindowCommand($executable)){
   Assert-StagedOpen $app 'restore'
   [void][MWW]::PostMessage([IntPtr]$frame,0x0111,[IntPtr]36554,[IntPtr]::Zero)
   Start-Sleep -Milliseconds 700
  }
  $record.layout_preserved=[MWW]::IsWindowVisible($root)
 }
 $record|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $file -Encoding UTF8
 Write-Output $file
}
Write-Output 'Hidden diagnostic panes recovered via verified native command; contents preserved'
