param([string]$ExpectedProject,[string]$Evidence,[string]$InteropDirectory,[switch]$Reverse)
$ErrorActionPreference='Stop'
if($ExpectedProject -notmatch 'motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266[\\/]\.motionworks[\\/]stage[\\/]TopCutterS5\.mwt$'){throw 'Exact disposable fixture required'}
$FixtureRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266'))
$VerificationRoot=Join-Path $FixtureRoot '.motionworks/verification'
$InteropRoot=Split-Path $FixtureRoot
if([IO.Path]::GetFullPath($ExpectedProject) -ine (Join-Path $FixtureRoot '.motionworks/stage/TopCutterS5.mwt')){throw 'Fixture identity outside authorized workspace'}
$InteropDirectory=[IO.Path]::GetFullPath($InteropDirectory)
if($InteropDirectory -notmatch '[\\/]sdk-interop-[a-f0-9-]+$'){throw 'Exact fixture SDK evidence directory required'}
if((Split-Path $InteropDirectory) -ine $InteropRoot -or (Split-Path ([IO.Path]::GetFullPath($Evidence))) -ine $VerificationRoot){throw 'Evidence outside exact fixture verification root'}
$Manifest=Get-Content -LiteralPath (Join-Path $InteropDirectory 'sdk-manifest.json') -Raw | ConvertFrom-Json
$AssemblyFile=Join-Path $InteropDirectory 'ADELib.dll'
if($Manifest.sdk_file -cne 'C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Ade.tlb' -or $Manifest.sdk_sha256 -ne (Get-FileHash -LiteralPath $Manifest.sdk_file -Algorithm SHA256).Hash -or $Manifest.assembly_sha256 -ne (Get-FileHash -LiteralPath $AssemblyFile -Algorithm SHA256).Hash){throw 'SDK/assembly provenance mismatch'}
$record=[ordered]@{accepted=$false;scope='read-only generated SDK interop benchmark';sdk_provenance=$Manifest;typed_first=[bool]$Reverse;sheets=@()}
try{
 [void][Reflection.Assembly]::LoadFrom($AssemblyFile)
 Add-Type -Path (Join-Path $PSScriptRoot 'reader.cs') -ReferencedAssemblies $AssemblyFile
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../../../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'Production parser errors'}
 $class=$ast.Find({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type' -and $n.Extent.Text.Contains('public class MWW')},$true)
 . ([scriptblock]::Create($class.Extent.Text))
 foreach($name in @('Get-IdeWindow','Get-TrialDialog','Connect-App','Get-VariableRows')){
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($fn.Extent.Text))
 }
 function Log($message){}
 $ide=Get-IdeWindow
 if(@(Get-Process -Name Mwt -ErrorAction SilentlyContinue).Count -ne 1 -or -not $ide -or -not [MWW]::IsWindowEnabled($ide)){throw 'Exactly one enabled visible IDE required'}
 if((Get-TrialDialog)[0]){throw 'Trial unresolved'}
 $app=Connect-App;$project=$app.ActiveProject
 if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($project.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong native fixture'}
 $record.before=@{modified=[bool]$project.IsModified;compiled=[bool]$project.IsCompiled;pous=[int]$project.Pous.Count}
 if($record.before.modified){throw 'Fixture not saved'}
 $resource=$project.GetObjectByLogicalName('Hardware/Configuration/Resource',10)
 $sheets=@(@{name='globals';variables=$resource.Variables})
 for($n=1;$n -le $project.Pous.Count;$n++){$p=$project.Pous.Item($n);$sheets+=@{name=[string]$p.Name;variables=$p.Variables}}
 foreach($sheet in $sheets){
  $sw=[Diagnostics.Stopwatch]::new()
  if($Reverse){
   $sw.Start();$new=[MwGeneratedVariableReader]::Read($sheet.variables);$sw.Stop();$newMs=$sw.ElapsedMilliseconds
   $sw.Restart();$old=Get-VariableRows $sheet.variables;$sw.Stop();$oldMs=$sw.ElapsedMilliseconds
  }else{
   $sw.Start();$old=Get-VariableRows $sheet.variables;$sw.Stop();$oldMs=$sw.ElapsedMilliseconds
   $sw.Restart();$new=[MwGeneratedVariableReader]::Read($sheet.variables);$sw.Stop();$newMs=$sw.ElapsedMilliseconds
  }
  # Canonicalize keys so dictionary enumeration order is irrelevant.
  $oldJson=ConvertTo-Json -InputObject @($old|ForEach-Object{$ordered=[ordered]@{};foreach($key in @($_.Keys|Sort-Object)){$ordered[$key]=$_.Item($key)};$ordered}) -Depth 6 -Compress
  $newJson=ConvertTo-Json -InputObject @($new|ForEach-Object{$ordered=[ordered]@{};foreach($key in @($_.Keys|Sort-Object)){$ordered[$key]=$_.Item($key)};$ordered}) -Depth 6 -Compress
  $row=@{name=$sheet.name;count=@($old).Count;old_ms=$oldMs;new_ms=$newMs;equal=($oldJson -ceq $newJson)}
  $record.sheets+=,$row
  if(-not $row.equal){throw 'Typed rows differ from original complete reader'}
 }
 $record.after=@{modified=[bool]$project.IsModified;compiled=[bool]$project.IsCompiled;pous=[int]$project.Pous.Count}
 if(($record.before|ConvertTo-Json -Compress) -cne ($record.after|ConvertTo-Json -Compress)){throw 'Native state drift'}
 $record.accepted=$true
}catch{$record.error=$_.Exception.Message}
finally{$record|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $Evidence -Encoding UTF8}
$record|ConvertTo-Json -Depth 8
if(-not $record.accepted){exit 1}
