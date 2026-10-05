$ErrorActionPreference='Stop'
# Exercise the real fallback body with synthetic native methods; no UI input.
Add-Type @'
using System; using System.Collections.Generic;
public class MWW {
 public static uint ButtonThread=2,DialogThread=3,FailAttach=0,FailDetach=0;
 public static bool FailFocus=false;
 public static bool Enabled=true,Gone=true,PostAccepted=true;
 public static int Posts=0;
 public static List<string> Calls=new List<string>();
 public static uint GetCurrentThreadId(){return 1;}
 public static uint GetWindowThreadProcessId(IntPtr h,out uint p){p=50;return h.ToInt32()==20?ButtonThread:DialogThread;}
 public static bool AttachThreadInput(uint a,uint b,bool attach){Calls.Add(b+":"+attach);if(!attach&&b==FailDetach)throw new Exception("synthetic detach failure");return b!=FailAttach;}
 public static bool ShowWindow(IntPtr h,int n){return true;}
 public static bool BringWindowToTop(IntPtr h){return true;}
 public static bool SetForegroundWindow(IntPtr h){return true;}
 public static IntPtr SetActiveWindow(IntPtr h){return h;}
 public static IntPtr SetFocus(IntPtr h){if(FailFocus)throw new Exception("synthetic focus failure");return h;}
 public static bool IsWindowEnabled(IntPtr h){return Enabled;}
 public static bool IsWindow(IntPtr h){return !Gone;}
 public static bool IsWindowVisible(IntPtr h){return !Gone;}
 public static bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l){if(h.ToInt32()!=20||msg!=0x00F5)throw new Exception("wrong button action");Posts++;return PostAccepted;}
}
'@
function Start-Sleep {param($Milliseconds) if($Milliseconds -ne 700){throw 'Unexpected delay'}}
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$fn=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-TrialClick'},$true)
if(-not $fn){throw 'Production trial fallback absent'}
. ([scriptblock]::Create($fn.Extent.Text))
function Reset-Case {
 [MWW]::Calls.Clear();[MWW]::ButtonThread=2;[MWW]::DialogThread=3
 [MWW]::FailAttach=0;[MWW]::FailDetach=0;[MWW]::FailFocus=$false;$script:actions=0
}
function Assert-Calls($expected){if(([MWW]::Calls -join ',') -cne $expected){throw "Unexpected attachment lifecycle: $([MWW]::Calls -join ',')"}}
Reset-Case
Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++}
Assert-Calls '2:True,3:True,3:False,2:False'
if($script:actions -ne 1){throw 'Action not submitted exactly once'}
Reset-Case;[MWW]::DialogThread=2
Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++}
Assert-Calls '2:True,2:False'
Reset-Case;[MWW]::ButtonThread=1;[MWW]::FailAttach=3
Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++}
Assert-Calls '3:True'
Reset-Case;[MWW]::FailFocus=$true
$failed=$false
try{Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++}}catch{$failed=$true}
if(-not $failed -or $script:actions){throw 'Activation failure submitted input or was hidden'}
Assert-Calls '2:True,3:True,3:False,2:False'
Reset-Case;$failed=$false
try{Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++;throw 'synthetic post failure'}}catch{$failed=$true}
if(-not $failed -or $script:actions -ne 1){throw 'Failed action retried or hidden'}
Assert-Calls '2:True,3:True,3:False,2:False'
Reset-Case;[MWW]::FailDetach=3;$failed=$false
try{Invoke-TrialClick ([IntPtr]20) ([IntPtr]30) {$script:actions++}}catch{if($_.Exception.Message -notmatch 'may already have been submitted'){throw};$failed=$true}
if(-not $failed -or $script:actions -ne 1){throw 'Detach failure hidden or action retried'}
Assert-Calls '2:True,3:True,3:False,2:False'
Write-Output 'Production trial fallback: scoped unique attachments, failed attachment, activation/action failure cleanup and exactly-once action passed; no UI input'

# Force unavailable semantic Invoke before any real UIAutomation API is reached.
function Add-Type {param($AssemblyName) throw 'Synthetic Invoke unavailable'}
function Get-TrialDialog {return @([IntPtr]30,[IntPtr]20)}
function Test-TrialGone {param($dialog,$seconds) return 2}
$answer=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Answer-TrialDialog'},$true)
. ([scriptblock]::Create($answer.Extent.Text))
foreach($case in @('gone','unverified','post_failed','disabled')){
 Reset-Case;[MWW]::Posts=0;[MWW]::Enabled=$case -ne 'disabled'
 [MWW]::Gone=$case -eq 'gone';[MWW]::PostAccepted=$case -ne 'post_failed'
 $failed=$false;$result=$null
 try{$result=Answer-TrialDialog}catch{$failed=$true}
 if($case -eq 'disabled'){
  if(-not $failed -or [MWW]::Posts -ne 0){throw 'Disabled trial action accepted'}
  Assert-Calls ''
 }else{
  if([MWW]::Posts -ne 1){throw 'Trial button post duplicated or missing'}
  Assert-Calls '2:True,3:True,3:False,2:False'
  if($case -eq 'post_failed'){if(-not $failed){throw 'Failed post accepted'}}
  elseif($failed -or $result.dismissed -ne ($case -eq 'gone') -or $result.method -ne 'posted_bm_click'){throw 'Trial closure verdict incorrect'}
 }
}
Write-Output 'Production Answer-TrialDialog: exactly one fallback post, verified/unverified closure, disabled control and failed-post cleanup passed; no UI input'
