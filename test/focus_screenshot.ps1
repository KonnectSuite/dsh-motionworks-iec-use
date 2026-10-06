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
 public static bool CursorVisible=true,CursorOwned=true,CursorDrift=false,BlankCursor=false;
 public static int CursorCalls=0,Draws=0;
 public static int DriftField=-1;
 public static IntPtr SetThreadDpiAwarenessContext(IntPtr context){return new IntPtr(-2);}
 public static long[] CaptureCursor(){CursorCalls++;var result=new long[]{CursorVisible?1:0,77,30+(CursorDrift&&CursorCalls>1?1:0),30,CursorOwned?123:999};if(CursorCalls>1&&DriftField>=0)result[DriftField]++;return result;}
 public static int[] DrawCapturedCursor(IntPtr dc,long[] cursor,int left,int top){Draws++;if(!BlankCursor)using(var g=Graphics.FromHdc(dc)){g.FillRectangle(Brushes.Red,(int)cursor[2]-left-2,(int)cursor[3]-top-3,4,4);}return new int[]{2,3,32,32};}
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
 [MWW]::Minimized=$false;[MWW]::Render=$true;[MWW]::ChangeFocus=$false;[MWW]::Focus=[IntPtr]20
 foreach($mode in @('owned','outside','hidden','drift','blank')){
  [MWW]::CursorCalls=0;[MWW]::Draws=0;[MWW]::CursorOwned=$mode -ne 'outside';[MWW]::CursorVisible=$mode -ne 'hidden';[MWW]::CursorDrift=$mode -eq 'drift'
  [MWW]::BlankCursor=$mode -eq 'blank'
  $req=@{path=(Join-Path $root ($mode+'.png'));capture_cursor=$true};$caught=$false
  try{. $capture}catch{if($_.Exception.Message -notmatch 'Cursor position, shape'){throw};$caught=$true}
  if($mode -eq 'drift'){
   if(-not $caught -or (Test-Path -LiteralPath $req.path)){throw 'Cursor drift accepted'}
  }else{
   if($caught -or -not (Test-Path -LiteralPath $req.path)){throw "Cursor $mode capture missing"}
   $expected=$mode -in @('owned','blank')
   if($data.cursor.rendered -ne $expected -or [MWW]::Draws -ne (3*[int]$expected)){throw "Cursor $mode incorrectly rendered"}
   if($data.cursor.screen_x -ne 30 -or $data.cursor.window_y -ne 30){throw 'Cursor coordinates lost'}
   if($expected){
    if($data.cursor.glyph_visible -ne ($mode -ne 'blank') -or -not (Test-Path -LiteralPath $data.cursor.path)){throw 'Blank cursor pixel detection incorrect'}
    if($data.cursor.hotspot_x -ne 2 -or $data.cursor.hotspot_y -ne 3){throw 'Cursor hotspot lost'}
    $image=[System.Drawing.Bitmap]::FromFile($req.path)
    try{if($mode -ne 'blank' -and $image.GetPixel(28,27).ToArgb() -ne [System.Drawing.Color]::Red.ToArgb()){throw 'Cursor glyph absent from PNG'}}finally{$image.Dispose()}
   }
  }
 }
 foreach($field in @(0,1,4)){
  [MWW]::CursorCalls=0;[MWW]::CursorDrift=$false;[MWW]::BlankCursor=$false;[MWW]::CursorVisible=$true;[MWW]::CursorOwned=$true;[MWW]::DriftField=$field
  $req=@{path=(Join-Path $root ('field-'+$field+'.png'));capture_cursor=$true};$caught=$false
  try{. $capture}catch{if($_.Exception.Message -notmatch 'Cursor position, shape'){throw};$caught=$true}
  if(-not $caught -or (Test-Path -LiteralPath $req.path) -or (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($req.path,'cursor.png')))){throw "Cursor field $field drift accepted"}
 }
 Write-Output 'Production screenshot preserves foreground/focus; minimized, occluded fallback and focus drift refuse without activation'
 Write-Output 'Owned visible cursor rendered at hotspot; hidden/outside cursors omitted; cursor drift refused'
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
