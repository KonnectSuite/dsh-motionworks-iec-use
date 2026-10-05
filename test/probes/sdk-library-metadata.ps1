param([Parameter(Mandatory=$true)][string]$InteropDirectory)
$ErrorActionPreference='Stop'
$InteropDirectory=[IO.Path]::GetFullPath($InteropDirectory)
$parent='C:\Users\Admin\Desktop\Codex Workspace'
if((Split-Path $InteropDirectory) -ine $parent -or (Split-Path $InteropDirectory -Leaf) -notmatch '^sdk-interop-[a-f0-9-]+$'){throw 'Verified local SDK directory required'}
$manifest=Get-Content -Raw -LiteralPath (Join-Path $InteropDirectory 'sdk-manifest.json') | ConvertFrom-Json
$supported='7ccec37b8fcff5d1a55198f51a7f97ded0429b2eb0ab740b5cede8cfd9950c6e'
if($manifest.sdk_sha256 -ine $supported -or (Get-FileHash -LiteralPath $manifest.sdk_file -Algorithm SHA256).Hash -ine $supported){throw 'Unverified SDK'}
$file=Join-Path $InteropDirectory 'ADELib.dll'
if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $manifest.assembly_sha256){throw 'Changed generated interop'}
$assembly=[Reflection.Assembly]::LoadFrom($file)
foreach($type in $assembly.GetTypes() | Where-Object Name -Match '^_(Application|Project|Library|Libraries|Pou|Pous|Variable|Document|Documents|FbInstance|ImportExports|ImportExport|WorkspaceManager|Workspace|ExternalImportExportProvider|ExternalImportExportProviders)$'){
 Write-Output ($type.FullName+' GUID='+$type.GUID)
 foreach($property in $type.GetProperties()){Write-Output ('  '+$property.ToString())}
 foreach($method in $type.GetMethods() | Where-Object { -not $_.IsSpecialName -and $_.Name -match 'Get|Find|Item|Read|Reference|Object|Project|Document' }){Write-Output ('  '+$method.ToString())}
 if($type.Name -eq '_Project'){
  foreach($parameter in $type.GetMethod('GetObjectByLogicalName').GetParameters()){Write-Output ('    parameter='+$parameter.Name+' in='+$parameter.IsIn+' out='+$parameter.IsOut+' attributes='+$parameter.Attributes)}
 }
}
