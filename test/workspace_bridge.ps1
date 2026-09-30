$ErrorActionPreference = 'Stop'
# Load only pure guard functions from the AST, never the bridge loop or COM setup.
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$names = @('Normalize-MwPath', 'Set-RequestScope', 'Assert-NoLinkedPath',
    'Test-InsideWorkspace', 'Test-InsideStage', 'Test-SameProject', 'Assert-ProvenCopy',
    'Get-OpenProjectPath', 'Assert-StagedOpen', 'Assert-CloseConsent')
foreach ($fn in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true)) {
    if ($names -contains $fn.Name) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
function Refuses([scriptblock]$action) {
    $refused = $false
    try { & $action | Out-Null } catch { if ($_.Exception.Message -like '*REFUSED*') { $refused = $true } else { throw } }
    if (-not $refused) { throw 'Expected a workspace refusal' }
}
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
    Write-Output '11 bridge workspace and consent checks passed; no IDE started'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($tempBase), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid cleanup target' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
