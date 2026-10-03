$ErrorActionPreference='Stop'
# Run the actual read_output switch body against the observed native layout.
# Inactive panes can retain WS_VISIBLE and nonzero row counts at zero area.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$body=$null
foreach($switch in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'read_output'){$body=$clause.Item2.Extent.Text}}
}
if(-not $body){throw 'No production read_output body'}
$read=[scriptblock]::Create($body.Substring(1,$body.Length-2))
Add-Type -TypeDefinition @'
using System;
using System.Text;
public class MWW {
 public delegate bool EnumWindowsProc(IntPtr h,IntPtr l);
 public struct RECT { public int Left,Top,Right,Bottom; }
 public static object Accessible;
 public static bool Ambiguous=false;
 public static int ActiveRows=2;
 public static bool EnumChildWindows(IntPtr root,EnumWindowsProc cb,IntPtr l) {
  if(root.ToInt32()==1)cb(new IntPtr(2),l);
  else {cb(new IntPtr(3),l);cb(new IntPtr(4),l);cb(new IntPtr(5),l);}
  return true;
 }
 public static string ReadText(IntPtr h){return h.ToInt32()==2?"Message Window":"";}
 public static int GetClassNameW(IntPtr h,StringBuilder b,int n){b.Append("SysListView32");return 13;}
 public static bool IsWindowVisible(IntPtr h){return true;}
 public static bool GetWindowRect(IntPtr h,out RECT r){r=new RECT();if(h.ToInt32()==3||Ambiguous){r.Right=600;r.Bottom=200;}return true;}
 public static object GetAccessible(IntPtr h){return Accessible;}
 public static int ListRowCount(IntPtr h){return h.ToInt32()==3?ActiveRows:100;}
}
'@
function Get-IdeWindow {return [IntPtr]1}
function Get-IdePid {return 99}
function Assert-StagedOpen {param($app,$verb)}
function Start-Sleep {param($Milliseconds)}
$script:activateFails=$false;$script:activationCount=0
$pane=[pscustomobject]@{Name='Errors'}
$pane|Add-Member ScriptMethod Activate {if($script:activateFails){throw 'Activation failed'};$script:activationCount++}
$ow=[pscustomobject]@{Count=1;Pane=$pane}
$ow|Add-Member ScriptMethod Item {param($n);return $this.Pane}
$app=[pscustomobject]@{OutputWindows=$ow}
function Connect-App {return $app}
$acc=[pscustomobject]@{Rows=@('First error','Last error')}
$acc|Add-Member ScriptMethod accName {param($n);if($n -lt 1){return 'SELF'};return $this.Rows[$n-1]}
[MWW]::Accessible=$acc
$req=@{pane='Errors';limit=200}
. $read
if($data.count -ne 2 -or $data.lines[0] -ne 'First error' -or $data.lines[1] -ne 'Last error'){throw 'First/last row lost or inactive pane selected'}
function Expect-Refusal([scriptblock]$action){$refused=$false;try{& $action}catch{$refused=$true};if(-not $refused){throw 'Expected diagnostic refusal'}}
[MWW]::ActiveRows=0;. $read
if($data.count -ne 0 -or $data.note -match 'clean result'){throw 'Empty active pane lost to inactive nonempty panes or claimed success'}
[MWW]::ActiveRows=2
$req.limit=0;Expect-Refusal {. $read};$req.limit=-1;Expect-Refusal {. $read}
$req.limit=1;. $read
if($data.count -ne 1 -or $data.lines[0] -ne 'First error'){throw 'Limit shifted row indexing'}
$script:activateFails=$true;Expect-Refusal {. $read};$script:activateFails=$false
$req.pane='Missing';Expect-Refusal {. $read};$req.pane='Errors'
[MWW]::Ambiguous=$true;Expect-Refusal {. $read};[MWW]::Ambiguous=$false
[MWW]::Accessible=$null;Expect-Refusal {. $read}
$acc.Rows=@('First error','');[MWW]::Accessible=$acc;$req.limit=200;Expect-Refusal {. $read}
Write-Output 'Output pane activation, zero-area sibling exclusion, ambiguity/read refusal and first/last row checks passed; no IDE input'
