# Verify what Create actually produced, by reopening the project from the files.
#
# Create(name, type) returned OK and the collection count went 1 -> 2, and the tree was left at
# 572 lines with no malformed node - which on its own would mean the IDE integrated the new
# instance. But item [2] reported LogicalName '/Hardware/Configuration/Resource/Tasks/SlowTsk'
# and Type 'C\Configuration\R\Resource\SlowTsk', which is the TASK's path, not a POU's. So either
# the enumeration is off by one, or something malformed was created.
#
# The decisive test is to CLOSE and REOPEN: if the assignment is real it survives, and
# mw_code_tasks - which reads the tree - will show it. A count that only ever existed in memory
# does not survive that, and this project has already learned once what it costs to trust an
# in-memory success.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$node = "C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe"

Write-Host "  === state as the IDE sees it now ==="
$app = New-Object -ComObject Ade.Application.550
$proj = $app.ActiveProject
foreach ($t in @('BG', 'SlowTsk', 'FastTsk', 'MedTsk', 'Start')) {
    try {
        $task = $proj.GetObjectByLogicalName("Hardware/Configuration/Resource/Tasks/$t", 11)
        $pi = $task.ProgramInstances
        $names = @()
        for ($i = 1; $i -le $pi.Count; $i++) {
            $x = $pi.Item($i)
            $n = ''
            try { $n = $x.Name } catch { $n = '?' }
            $names += $n
        }
        Write-Host "    $t : $($pi.Count) -> $($names -join ', ')"
    } catch {
        Write-Host "    $t -> $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "  === what the TREE says (mw_code_tasks, through the plugin) ==="
$js = Join-Path $env:TEMP 'tasks_after_create.mjs'
$body = @'
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const r = await tools.get("mw_code_tasks").execute({}, {});
for (const [k, v] of Object.entries(r.tasks ?? {})) {
  console.log(`    ${k}: ${JSON.stringify(v)}`);
}
'@
$body | Out-File -FilePath $js -Encoding utf8
$env:MW_PLUGIN = $INST
& $node $js 2>&1 | Select-Object -First 10
Remove-Item Env:MW_PLUGIN -ErrorAction SilentlyContinue
