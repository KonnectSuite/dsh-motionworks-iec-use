param([Parameter(Mandatory=$true)][string]$InteropDirectory)
$ErrorActionPreference='Stop'
$fixture='C:\Users\Admin\Desktop\Codex Workspace\motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266'
$expected=Join-Path $fixture '.motionworks\stage\TopCutterS5.mwt'
$evidence=Join-Path $fixture ('.motionworks\verification\sdk-library-resolution-'+[guid]::NewGuid()+'.json')
$record=[ordered]@{accepted=$false;existing_visible_instance_required=$true;project=$expected;queries=@();controller_downloaded=$false}
function Retain {$record | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $evidence -Encoding UTF8}
try {
 if([IntPtr]::Size -ne 4){throw '32-bit fixture bridge environment required'}
 $processes=@(Get-Process Mwt -ErrorAction SilentlyContinue)
 if($processes.Count -ne 1 -or -not $processes[0].MainWindowHandle -or $processes[0].MainWindowTitle -cne 'MotionWorks IEC 3 Pro - TopCutterS5'){throw 'Sole visible fixture IDE required'}
 . (Join-Path $PSScriptRoot 'sdk-library-metadata.ps1') -InteropDirectory $InteropDirectory | Out-Null
 Add-Type -Path (Join-Path $PSScriptRoot '../../bridge/sdk-variable-reader.cs') -ReferencedAssemblies $file
 Add-Type -ReferencedAssemblies $file -TypeDefinition @'
using System;
using System.Collections.Generic;
using MwAdeGenerated;
public class MwLibraryResolutionProbe {
 public static Dictionary<string,object> Read(object source,string path) {
  var project=(_Project)source; var type=(AdeObjectType)0;
  var value=project.GetObjectByLogicalName(path,ref type);
  var result=new Dictionary<string,object>{{"path",path},{"object_type",type.ToString()},{"object_type_id",(int)type},{"resolved",value!=null}};
  var pou=value as _Pou;
  if(pou!=null){result.Add("pou_name",pou.Name);result.Add("logical_name",pou.LogicalName);result.Add("read_only",pou.ReadOnly);result.Add("variables",pou.Variables);}
  var library=value as _Library;
  if(library!=null){result.Add("library_name",library.Name);result.Add("logical_name",library.LogicalName);result.Add("full_name",library.FullName);}
  return result;
 }
}
'@
 $app=New-Object -ComObject Ade.Application.550
 if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine $expected -or $app.ActiveProject.IsModified){throw 'Exact saved fixture project required'}
 $project=$app.ActiveProject
 $record.before=@{pous=[int]$project.Pous.Count;compiled=[bool]$project.IsCompiled;modified=[bool]$project.IsModified}
 $library=$project.Libraries.Item('Cam_Toolbox_v375')
 $record.library=@{name=[string]$library.Name;logical_name=[string]$library.LogicalName;full_name=[string]$library.FullName}
 if($record.library.logical_name -cne '/Libraries/Cam_Toolbox_v375' -or $record.library.full_name -ine 'C:\Users\Public\Documents\MotionWorks IEC 3 Pro\Libraries\Cam_Toolbox_v375.mwt'){throw 'Native library identity changed'}
 foreach($path in @('Pous/TopCutterCamSetup','/Pous/TopCutterCamSetup','Libraries/Cam_Toolbox_v375','/Libraries/Cam_Toolbox_v375','Libraries/Cam_Toolbox_v375/Pous/CamGenerator','Libraries/Cam_Toolbox_v375/CamGenerator')){
  try {
   $row=[MwLibraryResolutionProbe]::Read($project,$path)
   if($row.ContainsKey('variables')){
    $row.variables=[MwSdkVariableReader]::Read($row.variables)
   }
   $record.queries+=,$row
  }catch{$record.queries+=,@{path=$path;resolved=$false;error=$_.Exception.Message}}
  Retain
 }
 $record.after=@{pous=[int]$project.Pous.Count;compiled=[bool]$project.IsCompiled;modified=[bool]$project.IsModified}
 if(($record.before | ConvertTo-Json -Compress) -cne ($record.after | ConvertTo-Json -Compress)){throw 'Native state changed during read-only query'}
 $record.accepted=$true;Retain
}catch{$record.error=$_.Exception.Message;Retain;throw}
[pscustomobject]@{accepted=$record.accepted;evidence_path=$evidence;queries=$record.queries | ForEach-Object { [pscustomobject]@{path=$_.path;resolved=$_.resolved;object_type=$_.object_type;pou_name=$_.pou_name;variable_count=$_.variables.Count;error=$_.error} }} | ConvertTo-Json -Depth 6
