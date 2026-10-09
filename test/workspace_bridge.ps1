$ErrorActionPreference = 'Stop'
# Load only pure guard functions from the AST, never the bridge loop or COM setup.
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$names = @('Normalize-MwPath', 'Set-RequestScope', 'Assert-NoLinkedPath',
    'Test-InsideWorkspace', 'Test-InsideStage', 'Test-SameProject', 'Get-MwSha256',
    'Get-DirectIdentity', 'Assert-ProvenCopy',
    'Get-OpenProjectPath', 'Assert-StagedOpen', 'Assert-CloseConsent', 'Get-WorksheetEditorState', 'Get-WorksheetInstanceView')
foreach ($fn in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true)) {
    if ($names -contains $fn.Name) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
function Refuses([scriptblock]$action) {
    $refused = $false
    try { & $action | Out-Null } catch { if ($_.Exception.Message -like '*REFUSED*') { $refused = $true } else { throw } }
    if (-not $refused) { throw 'Expected a workspace refusal' }
}
$readyUi=@{responding=$true;caption='MotionWorks IEC 3 Pro - Machine - [Main:Main]'}
$ready=Get-WorksheetEditorState '/Pous/Main' '/Pous/Main' $false $false $readyUi 'Main:Main'
if(-not $ready.editor_window_ready -or $ready.keyboard_focus_verified){throw 'Native navigation was mistaken for keyboard focus'}
foreach($ui in @(@{responding=$false;caption=$readyUi.caption},@{responding=$null;caption=$readyUi.caption},@{responding=$true;caption='MotionWorks IEC 3 Pro - Machine - [Old:Old]'},@{responding=$true;caption=$null})){
    $state=Get-WorksheetEditorState '/Pous/Main' '/Pous/Main' $false $false $ui 'Main:Main'
    if(-not $state.native_navigation_verified -or $state.editor_window_ready){throw 'Unresponsive, unknown or stale editor passed readiness'}
}
foreach($case in @(@{view='/Pous/Other';before=$false;after=$false},@{view='/Pous/Main';before=$false;after=$true},@{view='/Pous/Main';before=$null;after=$false})){
    $state=Get-WorksheetEditorState '/Pous/Main' $case.view $case.before $case.after $readyUi 'Main:Main'
    if($state.native_navigation_verified -or $state.editor_window_ready){throw 'Wrong view, modification drift or unknown baseline passed readiness'}
}
Write-Output '8 injected editor readiness checks passed; no UI input'
$instancePath='/Hardware/Configuration/Resource/Tasks/FastTsk/MainInstance'
$instance=[pscustomobject]@{Name='MainInstance';Type='Main';LogicalName=$instancePath}
$native=[pscustomobject]@{Instance=$instance}
$native | Add-Member ScriptMethod GetObjectByLogicalName {
    param($path,$kind)
    if($path -cne 'Hardware/Configuration/Resource/Tasks/FastTsk/MainInstance' -or $kind -ne 19){throw 'Wrong native instance query'}
    return $this.Instance
}
$app=[pscustomobject]@{ActiveProject=$native}
$proof=Get-WorksheetInstanceView $app $instancePath 'Main' 'MainV'
if(-not $proof -or $proof.expected_caption -cne 'MainV:Main - Configuration.Resource.FastTsk.MainInstance.MainV'){throw 'Exact native task instance not resolved'}
$ui=@{responding=$true;caption=('MotionWorks IEC 3 Pro - Machine - ['+$proof.expected_caption+']')}
$ready=Get-WorksheetEditorState $proof.logical_name $instancePath $false $false $ui $proof.expected_caption
if(-not $ready.editor_window_ready -or $ready.keyboard_focus_verified){throw 'Exact task instance did not pass readiness or implied focus'}
foreach($caption in @('Main:Main - Configuration.Resource.FastTsk.MainInstance.Main','MainV:Other - Configuration.Resource.FastTsk.MainInstance.MainV','MainV:Main - Configuration.Resource.OtherTask.MainInstance.MainV')){
    $ui.caption='MotionWorks IEC 3 Pro - Machine - ['+$caption+']'
    if((Get-WorksheetEditorState $proof.logical_name $instancePath $false $false $ui $proof.expected_caption).editor_window_ready){throw 'Wrong worksheet, POU or task caption passed'}
}
foreach($change in @(@{field='Type';value='Other'},@{field='Name';value='Wrong'},@{field='LogicalName';value='/Pous/Main'})){
    $old=$instance.($change.field);$instance.($change.field)=$change.value
    if(Get-WorksheetInstanceView $app $instancePath 'Main' 'MainV'){throw 'Mismatched native instance identity passed'}
    $instance.($change.field)=$old
}
if(Get-WorksheetInstanceView $app '/Hardware/Configuration/Resource/Tasks/FastTsk/OtherInstance' 'Main' 'MainV'){throw 'Unknown instance passed'}
if(Get-WorksheetInstanceView $app '/Pous/Main/MainV' 'Main' 'MainV'){throw 'POU path accepted as task instance'}
Write-Output 'Native task-instance worksheet identity, exact caption and wrong POU/task/sheet refusal checks passed; no UI input'
$tempBase = [IO.Path]::GetTempPath()
$testRoot = Join-Path $tempBase ('mw-bridge-' + [guid]::NewGuid())
$ws = Join-Path $testRoot 'a'
$other = Join-Path $testRoot 'b'
$stage = Join-Path $ws '.motionworks/stage'
$project = Join-Path $stage 'Machine.mwt'
try {
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    [IO.File]::WriteAllText($project, 'synthetic')
    $identity = @{
        workspace = $ws; source = (Join-Path $ws 'Machine.mwt'); source_directory = (Join-Path $ws 'Machine')
        staged_mwt = $project; staged_directory = $project.Substring(0, $project.Length - 4)
        bound_to = $project.Substring(0, $project.Length - 4)
    }
    $identityFile = Join-Path $stage 'Machine.identity.json'
    [IO.File]::WriteAllText($identityFile, ($identity | ConvertTo-Json))
    Set-RequestScope @{ verb = 'open'; workspace = $ws; stage_root = $stage }
    Assert-ProvenCopy $project
    Refuses { Set-RequestScope @{ verb = 'open' } }
    Set-RequestScope @{ verb = 'save'; workspace = $other; stage_root = (Join-Path $other '.motionworks/stage') }
    Refuses { Assert-ProvenCopy $project }
    Set-RequestScope @{ verb = 'open'; workspace = $ws; stage_root = $stage }
    if (Test-InsideStage ($stage + '-outside/Machine.mwt')) { throw 'Prefix sibling accepted' }
    $identity.source = Join-Path $other 'Machine.mwt'
    [IO.File]::WriteAllText($identityFile, ($identity | ConvertTo-Json))
    Refuses { Assert-ProvenCopy $project }
    $fakeApp = [pscustomobject]@{ ActiveProject = [pscustomobject]@{ FullName = $project } }
    $fakeApp | Add-Member ScriptMethod IsProjectOpen { return $true }
    Refuses { Assert-StagedOpen $fakeApp 'save' }
    Refuses { Assert-CloseConsent @{ user_approved = $false; expected_project = $project } $project 'closing the IDE' }
    Refuses { Assert-CloseConsent @{ user_approved = $true; expected_project = (Join-Path $other 'Other.mwt') } $project 'closing the IDE' }
    Refuses { Assert-CloseConsent @{ user_approved = $true; expected_project = $project } $null 'closing the IDE' }
    Assert-CloseConsent @{ user_approved = $true; expected_project = $project } $project 'closing the IDE'
    Assert-CloseConsent @{ user_approved = $true } $null 'closing the IDE'
    $direct = Join-Path $ws 'Direct.mwt'
    $directDir = Join-Path $ws 'Direct'
    $recordDir = Join-Path $ws '.motionworks/attached/records'
    $manifestDir = Join-Path $ws '.motionworks/attached/backups/fixture'
    [IO.Directory]::CreateDirectory($directDir) | Out-Null
    [IO.Directory]::CreateDirectory($recordDir) | Out-Null
    [IO.Directory]::CreateDirectory($manifestDir) | Out-Null
    [IO.File]::WriteAllText($direct, 'wrapper')
    $manifest = Join-Path $manifestDir 'backup-manifest.json'
    [IO.File]::WriteAllText($manifest, '{"files":[]}')
    $recordPath = Join-Path $recordDir 'fixture.json'
    $directId = @{mode='direct';workspace=$ws;mwt=$direct;directory=$directDir;backup=$manifestDir;backup_manifest=$manifest;backup_manifest_sha256=(Get-MwSha256 $manifest)}
    [IO.File]::WriteAllText($recordPath, ($directId | ConvertTo-Json))
    if (-not (Test-InsideStage $direct)) { throw 'Verified direct workspace project was refused' }
    Assert-ProvenCopy $direct
    [IO.File]::WriteAllText($manifest, 'tampered')
    if (Test-InsideStage $direct) { throw 'Tampered direct backup passed' }
    Refuses { Assert-ProvenCopy $direct }
    Write-Output '14 bridge workspace and consent checks passed; no IDE started'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($tempBase), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid cleanup target' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
