$ErrorActionPreference='Stop'
# Execute the production capture body with an in-memory renderer. No UI input.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$body=$null
foreach($switch in $ast.FindAll({param($n)$n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'screenshot'){$body=$clause.Item2.Extent.Text}}
}
if(-not $body){throw 'Missing production screenshot body'}
$capture=[scriptblock]::Create($body.Substring(1,$body.Length-2))
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public class MWW {
 public struct RECT { public int Left,Top,Right,Bottom; }
 public static bool Minimized=false,Render=true,ChangeFocus=false;
 public static IntPtr Focus=new IntPtr(20);
 public static bool IsIconic(IntPtr h){return Minimized;}
 public static IntPtr[] CaptureFocus(){return new IntPtr[]{new IntPtr(999),new IntPtr(999),Focus};}
 public static IntPtr GetAncestor(IntPtr h,uint flags){return h;}
 public static bool GetWindowRect(IntPtr h,out RECT r){r=new RECT{Left=0,Top=0,Right=60,Bottom=60};return true;}
 public static bool PrintWindow(IntPtr h,IntPtr dc,uint flags){
  if(!Render)return false;
  using(var g=Graphics.FromHdc(dc)){g.Clear(Color.White);g.FillRectangle(Brushes.Black,0,0,1,1);}
  if(ChangeFocus)Focus=new IntPtr(21);
  return true;
 }
 public static bool ShowWindow(IntPtr h,int flags){throw new Exception("Unexpected activation");}
 public static bool BringWindowToTop(IntPtr h){throw new Exception("Unexpected activation");}
 public static bool SetForegroundWindow(IntPtr h){throw new Exception("Unexpected activation");}
}
'@
function Get-IdeWindow {return [IntPtr]123}
$script:logs=@()
function Log($message){$script:logs+=$message}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mw-focus-capture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try{
 $req=@{path=(Join-Path $root 'stable.png')}; . $capture
 if(-not (Test-Path -LiteralPath $req.path)){throw 'Stable capture missing'}
 if(-not ($script:logs -match 'focus preserved')){throw 'No preserved-focus evidence'}
 foreach($failure in @('minimized','occluded-fallback','focus-change')){
  [MWW]::Minimized=$failure -eq 'minimized';[MWW]::Render=$failure -ne 'occluded-fallback';[MWW]::ChangeFocus=$failure -eq 'focus-change';[MWW]::Focus=[IntPtr]20
  $req=@{path=(Join-Path $root ($failure+'.png'))};$caught=$false
  try{. $capture}catch{if($_.Exception.Message -notmatch 'minimized|screen-region capture refused|changed during capture'){throw};$caught=$true}
  if(-not $caught -or (Test-Path -LiteralPath $req.path)){throw "Unverified $failure was accepted"}
 }
 Write-Output 'Production screenshot preserves foreground/focus; minimized, occluded fallback and focus drift refuse without activation'
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
