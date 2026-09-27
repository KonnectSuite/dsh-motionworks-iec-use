# Save, and see whether the IDE writes the new assignment into the tree itself.
#
# Create(name, type) produced a ProgramInstance the IDE reports:
#
#     SlowTsk : 2 -> ServoTaskSlow, ZzProbe
#
# while mw_code_tasks - which reads PROJECT.TRE - still shows only ServoTaskSlow. That is the
# expected split: the object model is live, and the tree is written when the project is saved. If
# a save puts the instance into the tree, then the assignment problem is solved through a
# supported API, and the sixteen rounds spent refusing to hand-edit the tree are vindicated rather
# than wasted - the refusal was right, and the API was simply not yet found.
#
# The check afterwards is a BUILD, because an assignment the compiler cannot use is worth nothing.
$ErrorActionPreference = 'Continue'

$INST = "$env:USERPROFILE\profiles\desktop\node_modules\dsh-motionworks-iec-use"
$node = "C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe"

$js = Join-Path $env:TEMP 'save_verify.mjs'
$body = @'
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});

console.log("  --- before save ---");
let t = await run("mw_code_tasks");
console.log("    SlowTsk:", JSON.stringify(t.tasks?.SlowTsk));

console.log("  --- save ---");
try {
  const s = await run("mw_ide_save");
  console.log("    save:", JSON.stringify(s).slice(0, 160));
} catch (e) { console.log("    save failed:", String(e.message).split("\n")[0].slice(0, 120)); }

console.log("  --- after save ---");
t = await run("mw_code_tasks");
console.log("    SlowTsk:", JSON.stringify(t.tasks?.SlowTsk));

console.log("  --- build ---");
try {
  const b = await run("mw_ide_build");
  console.log("    is_compiled:", b.is_compiled, " stalled:", b.stalled, " errors:", b.error_count ?? "?");
} catch (e) { console.log("    build failed:", String(e.message).split("\n")[0].slice(0, 120)); }
'@
$body | Out-File -FilePath $js -Encoding utf8
$env:MW_PLUGIN = $INST
& $node $js 2>&1 | Select-Object -First 16
Remove-Item Env:MW_PLUGIN -ErrorAction SilentlyContinue
