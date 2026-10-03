$ErrorActionPreference='Stop'
# Read-only exact native instance resolution. No OpenDocument or editor input.
$workspace=$env:MOTIONWORKS_MCP_WORKSPACE
if($workspace -notmatch 'motionworks-ide-smoke-[a-f0-9-]+$'){throw 'Disposable fixture required'}
if(-not (Get-Process Mwt -ErrorAction SilentlyContinue)){throw 'IDE must already be running'}
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../bridge/mw_bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WorksheetInstanceView'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$app=New-Object -ComObject Ade.Application.550
$expected=[IO.Path]::GetFullPath((Join-Path $workspace '.motionworks/stage/TopCutterS5.mwt'))
if([IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine $expected -or $app.ActiveProject.IsModified){throw 'Wrong or modified project'}
$resource=$app.ActiveProject.GetObjectByLogicalName('Hardware/Configuration/Resource',10)
$proofs=@()
for($t=1;$t -le $resource.Tasks.Count;$t++){
    $task=$resource.Tasks.Item($t)
    for($n=1;$n -le $task.ProgramInstances.Count;$n++){
        $instance=$task.ProgramInstances.Item($n)
        if($instance.Type -ceq 'TopCutterCamSetup'){
            $proof=Get-WorksheetInstanceView $app ([string]$instance.LogicalName) ([string]$instance.Type) 'TopCutterCamSetupV'
            if(-not $proof){throw 'Live native instance resolution failed'}
            $proofs+=,$proof
        }
    }
}
if($proofs.Count -ne 1){throw 'Expected one independently observed native instance'}
$evidence=[ordered]@{project=$expected;proofs=$proofs;is_modified=[bool]$app.ActiveProject.IsModified;
    action_performed=$false;note='Native identity resolution only; does not prove active task-instance editor readiness'}
$path=Join-Path $workspace '.motionworks/verification/navigation-instance-native-proof.json'
$evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding UTF8
$evidence | ConvertTo-Json -Depth 10 -Compress
