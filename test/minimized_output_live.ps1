# Opt-in production minimized-state/diagnostic test; reversible exact fixture frame setup.
$ErrorActionPreference='Stop'
$workspace=$env:MOTIONWORKS_MCP_WORKSPACE
if($workspace -notmatch 'motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$'){throw 'Exact disposable fixture required'}
$project=Join-Path $workspace '.motionworks\stage\TopCutterS5.mwt'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$add=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type' -and $n.Extent.Text -match 'public class MWW'},$true)|Select-Object -First 1
Invoke-Expression $add.Extent.Text
foreach($name in 'Get-IdeWindow','Get-IdePid','Get-TrialDialog','Get-IdeDialogs','Get-IdeState'){
 $fn=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)|Select-Object -First 1
 Invoke-Expression $fn.Extent.Text
}
if ([IntPtr]::Size -ne 4) { throw '32-bit test client required' }
$running=@(Get-Process -Name Mwt -ErrorAction Stop)
if ($running.Count -ne 1 -or $running[0].MainWindowTitle -cne 'MotionWorks IEC 3 Pro - TopCutterS5') { throw 'Sole existing fixture IDE required; no launch allowed' }
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

$stateRead=$null
foreach($switch in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'ide_state'){$body=$clause.Item2.Extent.Text;$stateRead=[scriptblock]::Create($body.Substring(1,$body.Length-2))}}
}
if(-not $stateRead){throw 'Production state switch missing'}
$req=@{include_window_state=$true};. $stateRead
$before=$data
if($before.blocked -or $before.ide_minimized -ne $false -or $before.ide_visible -ne $true -or -not $app.ActiveProject.IsCompiled -or $app.ActiveProject.IsModified){throw 'Ready saved compiled visible fixture required'}
$frame=Get-IdeWindow
if(('0x{0:X}' -f ([int64]$frame)) -cne $before.ide_window){throw 'Fixture frame changed'}
$file=Join-Path $workspace ('.motionworks\verification\minimized-output-'+[guid]::NewGuid().ToString()+'.json')
$record=[ordered]@{accepted=$false;project=$project;controller_action=$false;before=$before;restore_requested=$false}
$minimizeRequested=$false
try{
 $req=@{pane='Errors';limit=5000};. $read;$baselineErrors=$data.lines
 $req=@{};. $stateRead
 if($data.Contains('ide_minimized') -or $data.Contains('ide_visible')){throw 'Cached caller output schema changed'}
 $minimizeRequested=$true
 [void][MWW]::ShowWindow([IntPtr]$frame,6)
 Start-Sleep -Milliseconds 400
 $req=@{include_window_state=$true};. $stateRead;$record.minimized=$data
 if($data.ide_minimized -ne $true -or $data.blocked -ne $false){throw 'Minimized fixture state not distinguished'}
 $req=@{pane='Errors';limit=5000}
 $refused=$false
 try{. $read}catch{$record.diagnostic_error=$_.Exception.Message;if($_.Exception.Message -match 'IDE is minimized.*no pane activation performed'){$refused=$true}else{throw}}
 if(-not $refused -or -not [MWW]::IsIconic([IntPtr]$frame) -or $app.ActiveProject.IsModified){throw 'Minimized refusal did not preserve frame/source state'}
 $record.restore_requested=$true
 [void][MWW]::ShowWindow([IntPtr]$frame,9)
 Start-Sleep -Milliseconds 400
 $req=@{include_window_state=$true};. $stateRead;$record.restored=$data
 if($data.ide_minimized -ne $false -or $data.ide_visible -ne $true -or $data.blocked){throw 'Restore not verified; do not repeat automatically'}
 $req=@{pane='Errors';limit=5000};. $read;$record.errors=$data
 if(($data.lines|ConvertTo-Json -Compress) -cne ($baselineErrors|ConvertTo-Json -Compress)){throw 'Diagnostic contents changed'}
 Assert-StagedOpen $app 'after'
 if(-not $app.ActiveProject.IsCompiled -or $app.ActiveProject.IsModified){throw 'Native compile/save state changed'}
 $record.accepted=$true
}catch{$record.error=$_.Exception.Message;throw}
finally{
 # Exact fixture-only cleanup if the accepted restore was never requested.
 if($minimizeRequested -and -not $record.restore_requested -and [MWW]::IsIconic([IntPtr]$frame)){
  Assert-StagedOpen $app 'restore'
  $record.restore_requested=$true
  [void][MWW]::ShowWindow([IntPtr]$frame,9)
  Start-Sleep -Milliseconds 400
 }
 $record.frame_restored= -not [MWW]::IsIconic([IntPtr]$frame)
 $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $file -Encoding UTF8
 Write-Output ($record|ConvertTo-Json -Depth 10 -Compress)
 Write-Output "evidence=$file"
}
