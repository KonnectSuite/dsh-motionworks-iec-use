param([string]$OutputPath)
$ErrorActionPreference='Stop'
# Read the production Win32 renderer; exercise an in-memory native cursor only.
# No SetCursor, mouse input, IDE calls, foreground changes or system settings.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$source=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public class MWW'},$true) | Select-Object -First 1
if(-not $source){throw 'Production MWW source missing'}
Add-Type -TypeDefinition $source.Value
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class CursorResource {
 [StructLayout(LayoutKind.Sequential)] public struct INFO {
  [MarshalAs(UnmanagedType.Bool)] public bool icon;
  public uint x,y; public IntPtr mask,color;
 }
 [DllImport("user32.dll")] public static extern IntPtr CreateIconIndirect(ref INFO info);
}
'@
# Construct an immutable known cursor: shared system cursors can be replaced
# externally, including with transparent images. Never set this as the OS cursor.
$color=New-Object Drawing.Bitmap 32,32,([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mask=New-Object Drawing.Bitmap 32,32,([Drawing.Imaging.PixelFormat]::Format1bppIndexed)
$cg=[Drawing.Graphics]::FromImage($color)
$colorHandle=[IntPtr]::Zero;$maskHandle=[IntPtr]::Zero;$arrow=[IntPtr]::Zero
try{
 $cg.Clear([Drawing.Color]::Red);$cg.FillRectangle([Drawing.Brushes]::Blue,8,8,8,8)
 $colorHandle=$color.GetHbitmap();$maskHandle=$mask.GetHbitmap()
 $info=New-Object CursorResource+INFO;$info.icon=$false;$info.x=3;$info.y=5;$info.color=$colorHandle;$info.mask=$maskHandle
 $arrow=[CursorResource]::CreateIconIndirect([ref]$info)
 if($arrow -eq [IntPtr]::Zero){throw 'Known in-memory native cursor creation failed'}
}finally{
 $cg.Dispose();$color.Dispose();$mask.Dispose()
 if($colorHandle -ne [IntPtr]::Zero){[MWW]::DeleteObject($colorHandle)|Out-Null}
 if($maskHandle -ne [IntPtr]::Zero){[MWW]::DeleteObject($maskHandle)|Out-Null}
}
$bitmap=New-Object Drawing.Bitmap 96,48,([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try{
 $graphics.Clear([Drawing.Color]::White)
 $graphics.FillRectangle([Drawing.Brushes]::Black,48,0,48,48)
 $dc=$graphics.GetHdc()
 try{
  $hotspot=[MWW]::DrawCapturedCursor($dc,([long[]]@(1,$arrow.ToInt64(),8,8,0)),0,0)
  [MWW]::DrawCapturedCursor($dc,([long[]]@(1,$arrow.ToInt64(),56,8,0)),0,0) | Out-Null
 }finally{$graphics.ReleaseHdc($dc)}
 $changed=0
 for($y=0;$y -lt 48;$y++){for($x=0;$x -lt 96;$x++){
  $background=if($x -lt 48){[Drawing.Color]::White.ToArgb()}else{[Drawing.Color]::Black.ToArgb()}
  if($bitmap.GetPixel($x,$y).ToArgb() -ne $background){$changed++}
 }}
 if($changed -ne 2048){throw "Production native renderer expected 2048 known cursor pixels, got $changed"}
 if($hotspot[0] -ne 3 -or $hotspot[1] -ne 5){throw 'Native cursor hotspot lost'}
 if($bitmap.GetPixel(5,3).ToArgb() -ne [Drawing.Color]::Red.ToArgb() -or $bitmap.GetPixel(13,11).ToArgb() -ne [Drawing.Color]::Blue.ToArgb()){throw 'Native cursor pixel placement incorrect'}
 if($OutputPath){$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}
 Write-Output "Production native cursor renderer: $changed immutable cursor pixels and exact hotspot/placement verified, dimensions $($hotspot[2])x$($hotspot[3]); no UI input"
}finally{$graphics.Dispose();$bitmap.Dispose();[MWW]::DestroyIcon($arrow)|Out-Null}
