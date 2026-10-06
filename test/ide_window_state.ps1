$ErrorActionPreference='Stop'
# Exercise the production switch; no IDE, input, or window-state mutation.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$body=$null
foreach($switch in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true)){
 foreach($clause in $switch.Clauses){if($clause.Item1.Value -eq 'ide_state'){$body=$clause.Item2.Extent.Text}}
}
if(-not $body){throw 'Production state switch missing'}
$read=[scriptblock]::Create($body.Substring(1,$body.Length-2))
Add-Type @'
using System;
public class MWW {
 public static bool Minimized=false,Visible=true;
 public static bool IsIconic(IntPtr h){return Minimized;}
 public static bool IsWindowVisible(IntPtr h){return Visible;}
}
'@
$script:frame=[IntPtr]42;$script:reported='0x2A'
function Get-IdeWindow {return $script:frame}
function Get-IdeState {return [ordered]@{ide_running=[bool]$script:frame;ide_window=$script:reported;blocked=$false;dialog_count=0;dialogs=@()}}
$req=@{};. $read
if($data.Contains('ide_minimized') -or $data.Contains('ide_visible')){throw 'Cached caller closed schema changed'}
$req=@{include_window_state=$true};. $read
if($data.ide_minimized -ne $false -or $data.ide_visible -ne $true){throw 'Visible state lost'}
[MWW]::Minimized=$true;. $read
if($data.ide_minimized -ne $true -or $data.blocked -ne $false){throw 'Minimized state conflated with blocked'}
[MWW]::Minimized=$false;[MWW]::Visible=$false;. $read
if($data.ide_visible -ne $false){throw 'Hidden frame reported visible'}
$script:frame=$null;$script:reported=$null;. $read
if($null -ne $data.ide_minimized -or $null -ne $data.ide_visible){throw 'Absent frame must have unknown state'}
$script:frame=[IntPtr]42;$script:reported='0x2B'
$refused=$false;try{. $read}catch{if($_.Exception.Message -match 'frame changed'){$refused=$true}else{throw}}
if(-not $refused){throw 'Frame identity drift accepted'}
Write-Output 'Production window state: cached compatibility, visible/minimized/hidden/absent state and identity drift guards passed; no IDE input'
