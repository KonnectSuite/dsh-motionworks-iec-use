$ErrorActionPreference = 'Stop'
# Execute the real discovery function against synthetic native windows. No UI input.
Add-Type @'
using System; using System.Text;
public class MWW {
 public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
 public static int Mode=0;
 public static bool EnumWindows(EnumWindowsProc cb,IntPtr l) {
  cb((IntPtr)10,l); cb((IntPtr)20,l); cb((IntPtr)30,l);
  if(Mode==2) cb((IntPtr)40,l); return true;
 }
 public static bool EnumChildWindows(IntPtr h,EnumWindowsProc cb,IntPtr l) { cb((IntPtr)(h.ToInt32()+1),l); return true; }
 public static bool IsWindowVisible(IntPtr h) {return Mode!=3 || h.ToInt32()!=21;}
 public static bool IsWindowEnabled(IntPtr h) {return true;}
 public static uint GetWindowThreadProcessId(IntPtr h,out uint p) {p=(uint)h.ToInt32();return 1;}
 public static int GetClassNameW(IntPtr h,StringBuilder s,int n) {s.Append("WindowsForms10.Window.test");return 26;}
 public static string ReadText(IntPtr h) {
  return h.ToInt32()==11 || (Mode!=1 && h.ToInt32()==21) || h.ToInt32()==41 ? "&Use Trial" : "Other button";
 }
}
'@
function Get-Process { param($Id,$Name,$ErrorAction) if($Name) { if($script:verifier) { [pscustomobject]@{ProcessName='mwctVerify'} }; return }; [pscustomobject]@{ProcessName=$(if($Id -eq 10){'UnrelatedApp'}else{'mwctVerify'})} }
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-TrialDialog'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$pair=Get-TrialDialog
if($pair[0] -ne 20 -or $pair[1] -ne 21){throw 'Dialog/button pair was replaced by an unrelated or buttonless window'}
[MWW]::Mode=1
$pair=Get-TrialDialog
if($pair[0] -or $pair[1]){throw 'Unrelated Use Trial control accepted'}
[MWW]::Mode=2
$refused=$false
try {Get-TrialDialog | Out-Null} catch {if($_.Exception.Message -match 'Multiple MotionWorks'){ $refused=$true }else{throw}}
if(-not $refused){throw 'Ambiguous MotionWorks dialogs accepted'}
[MWW]::Mode=3
$pair=Get-TrialDialog
if($pair[0] -or $pair[1]){throw 'Hidden trial button accepted'}
Write-Output 'Trial discovery: owner isolation, exact pairing, missing/hidden control and ambiguous-dialog checks passed; no UI input'

# Exercise the real state function: the verifier can precede the IDE frame.
function Get-IdeWindow { return $script:ideWindow }
function Get-IdeDialogs { return @() }
$stateFn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-IdeState'},$true)
. ([scriptblock]::Create($stateFn.Extent.Text))
$script:verifier=$true; $script:ideWindow=$null; [MWW]::Mode=0
$state=Get-IdeState
if($state.ide_running -or -not $state.blocked -or -not $state.trial_dialog -or $state.trial_dialog_hwnd -ne '0x14' -or $state.hint -notmatch 'mw_ide_trial\(attempt:true\)'){throw 'Pre-frame trial startup not distinguished'}
$script:ideWindow=[IntPtr]50
$state=Get-IdeState
if(-not $state.ide_running -or -not $state.blocked -or -not $state.ide_enabled){throw 'Trial lost when enabled IDE frame exists'}
[MWW]::Mode=1; $script:ideWindow=$null
$state=Get-IdeState
if($state.trial_dialog -or $state.blocked -or -not $state.verifier_running){throw 'Verifier without exact trial control misclassified'}
$script:verifier=$false; $script:ideWindow=[IntPtr]50
$state=Get-IdeState
if($state.trial_dialog -or $state.verifier_running -or $state.blocked -or -not $state.ide_running){throw 'Ready IDE misclassified'}
$script:ideWindow=$null
$state=Get-IdeState
if($state.ide_running -or $state.blocked -or $state.verifier_running){throw 'Closed IDE misclassified'}
[MWW]::Mode=2
$refused=$false
try {Get-IdeState | Out-Null} catch {if($_.Exception.Message -match 'Multiple MotionWorks'){ $refused=$true }else{throw}}
if(-not $refused){throw 'State accepted ambiguous trial controls'}
Write-Output 'IDE state: pre-frame trial, trial with frame, loading verifier, ready/closed IDE and ambiguity checks passed'
