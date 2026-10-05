$ErrorActionPreference='Stop'
# Execute the production startup clause with synthetic processes/windows only.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$body=$null
foreach($switch in $ast.FindAll({param($n)$n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'start_ide'){$body=$clause.Item2.Extent.Text}}
}
if(-not $body){throw 'Production startup clause absent'}
$startup=[scriptblock]::Create($body.Substring(1,$body.Length-2))
Add-Type @'
using System;
public class MWW {
 public static bool Enabled=true;
 public static bool IsWindowEnabled(IntPtr h){return Enabled;}
}
'@
function Assert-ProvenCopy($path){if($path -ne 'C:\fixture\stage\Probe.mwt'){throw 'Wrong wrapper'}}
function Get-MwSha256($path){return 'verified-hash'}
function Test-Path($path){return $true}
function Get-Process {param($Name,$ErrorAction) if($script:already){return [pscustomobject]@{ProcessName='Mwt'}}}
function Start-Process {
 param($FilePath,$ArgumentList,$WindowStyle)
 $script:launches++
 if($WindowStyle -ne 'Normal'){throw 'Interactive IDE launched hidden'}
 if($ArgumentList -cne '"C:\fixture\stage\Probe.mwt"'){throw 'Verified wrapper not quoted exactly'}
 if($script:case -ne 'timeout'){$script:window=[IntPtr]123}
}
function Get-IdeWindow {return $script:window}
function Get-TrialDialog {if($script:trial){return @([IntPtr]200,[IntPtr]201)};return @($null,$null)}
function Answer-TrialDialog {
 $script:answers++
 if($script:case -eq 'trial_unverified'){return @{dismissed=$false}}
 $script:trial=$false;$script:window=[IntPtr]123;return @{dismissed=$true}
}
function Get-Date {
 $script:clockCalls++
 $seconds=0
 if($script:case -in @('disabled','timeout') -and $script:clockCalls -gt 1){$seconds=301}
 return ([datetime]'2026-10-05T00:00:00').AddSeconds($seconds)
}
function Start-Sleep {param($Milliseconds)throw 'Unexpected sleep in synthetic startup'}
function Connect-App {$script:connections++;return [pscustomobject]@{Version='fixture-version'}}
function Get-OpenProjectPath($app){return 'C:\fixture\stage\Probe.mwt'}
function Test-SameProject($a,$b){return $a -ceq $b}
function Log($message){}
function Reset-Case($name){
 $script:case=$name;$script:already=$false;$script:trial=$false;$script:window=$null
 $script:launches=0;$script:answers=0;$script:connections=0;$script:clockCalls=0
 [MWW]::Enabled=$true
 $script:req=@{path='C:\fixture\stage\Probe.mwt';wrapper_sha256='verified-hash';exe='C:\fixture\Mwt.exe'}
}
Reset-Case 'fresh';. $startup
if($script:launches -ne 1 -or $script:connections -ne 1 -or $data.already_running){throw 'Fresh visible launch not accepted'}
Reset-Case 'existing';$script:already=$true;$script:window=[IntPtr]123;. $startup
if($script:launches -ne 0 -or $script:connections -ne 1 -or -not $data.already_running){throw 'Existing IDE relaunched'}
Reset-Case 'trial';$script:already=$true;$script:trial=$true;. $startup
if($script:launches -ne 0 -or $script:answers -ne 1 -or -not $data.trial_answered){throw 'Existing pre-frame trial not answered exactly once'}
foreach($name in @('trial_unverified','disabled','timeout','bad_hash')){
 Reset-Case $name
 if($name -eq 'trial_unverified'){$script:already=$true;$script:trial=$true}
 if($name -eq 'disabled'){$script:already=$true;$script:window=[IntPtr]123;[MWW]::Enabled=$false}
 if($name -eq 'bad_hash'){$req.wrapper_sha256='wrong'}
 $failed=$false
 try{. $startup}catch{$failed=$true;$message=$_.Exception.Message}
 if(-not $failed -or $script:connections -ne 0){throw "Unsafe startup accepted or COM reached: $name"}
 if($name -eq 'trial_unverified' -and ($script:answers -ne 1 -or $script:launches -ne 0)){throw 'Trial refusal duplicated input/launch'}
 if($name -eq 'disabled' -and ($message -notmatch 'remains disabled' -or $script:launches -ne 0)){throw 'Disabled frame not diagnosed'}
 if($name -eq 'timeout' -and ($message -notmatch 'observation timeout does not prove process exit' -or $script:launches -ne 1)){throw 'Timeout lost existing-process recovery instruction'}
 if($name -eq 'bad_hash' -and $script:launches -ne 0){throw 'Invalid wrapper launched'}
}
Write-Output 'Production startup: visible interactive launch, existing-instance reuse, exact trial action and unverified/disabled/timeout/hash refusals passed; no IDE launched or UI input'
