$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('Initialize-SdkVariableReader','Get-VariableRows')){
 $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 . ([scriptblock]::Create($fn.Extent.Text))
}
function Log($message){$script:messages+=,$message}
function Test-Path {param($LiteralPath) return $true}
function New-Item {param($ItemType,$Path,$ErrorAction) $script:creates++}
function Add-Type {param($Path,$ErrorAction) $script:loads++;throw 'synthetic loader failure'}
function Get-MwSha256($path){return $script:hash}
function Join-Path {param($Path,$ChildPath) return ('C:\synthetic\'+$ChildPath)}
function Reset-Case {
 $script:SdkReaderAttempted=$false;$script:SdkReaderEnabled=$false
 $script:hash='unknown';$script:messages=@();$script:creates=0;$script:loads=0
 $script:BridgeDir='C:\synthetic';$env:MW_DISABLE_SDK_READER='0'
}
$prior=$env:MW_DISABLE_SDK_READER
try{
 Reset-Case;Initialize-SdkVariableReader
 if($script:SdkReaderEnabled -or $script:loads -or $script:creates){throw 'Unknown SDK reached generation'}
 Reset-Case;$env:MW_DISABLE_SDK_READER='1';Initialize-SdkVariableReader
 if($script:SdkReaderEnabled -or $script:loads -or $script:creates){throw 'Diagnostic override ignored'}
 Reset-Case;$script:hash='7ccec37b8fcff5d1a55198f51a7f97ded0429b2eb0ab740b5cede8cfd9950c6e'
 Initialize-SdkVariableReader;Initialize-SdkVariableReader
 if($script:SdkReaderEnabled -or $script:loads -ne 1 -or $script:creates -ne 1){throw ('Initialization failure retried or enabled reader: loads='+$script:loads+' creates='+$script:creates+' messages='+($script:messages -join ' | '))}
 if(($script:messages -join ' ') -notmatch 'complete legacy reader'){throw 'Fallback lost complete-reader instruction'}
 # A native read failure must propagate once, never enter the legacy collection.
 Microsoft.PowerShell.Utility\Add-Type @'
using System;
public class MwSdkVariableReader {
 public static int Calls=0;
 public static object Read(object source){Calls++;throw new InvalidOperationException("synthetic native read failure");}
}
'@
 $script:SdkReaderEnabled=$true;$script:SdkReaderFile='synthetic';$script:SdkReaderHash='known';$script:hash='changed'
 $failed=$false;try{Get-VariableRows $null|Out-Null}catch{if($_.Exception.Message -notmatch 'SDK changed'){throw};$failed=$true}
 if(-not $failed -or [MwSdkVariableReader]::Calls){throw 'Changed SDK reached native reader'}
 $script:hash='known';$failed=$false
 try{Get-VariableRows $null|Out-Null}catch{if($_.Exception.Message -notmatch 'synthetic native read failure'){throw};$failed=$true}
 if(-not $failed -or [MwSdkVariableReader]::Calls -ne 1){throw 'Partial native read failure hidden or retried'}
 Write-Output 'Production SDK reader guards: unknown SDK, opt-out, load failure/once-only fallback, changed SDK and native failure propagation passed; no IDE input'
}finally{$env:MW_DISABLE_SDK_READER=$prior}
