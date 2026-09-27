/**
 * Does the IDE RECONCILE a .VB-only global add when it opens and saves?
 *
 * This is the gap between what I concluded and what Codex evidently got away with. My
 * global writes are refused because a global lives in TWO places:
 *
 *     Global_Variables.VB    the text declarations   <- writable
 *     Global_Variables.VGR   a binary grid: header count + one record per variable
 *
 * Measured headlessly: writing only the .VB leaves the grid header at 161 while the text
 * declares 162, and the compiler then rejects the whole global table - 125
 * "No matching global variable found" errors, every POU failing at once.
 *
 * BUT every one of those measurements drove the IDE through COM and built immediately.
 * The Codex workflow is different: edit the offline files, then have the HUMAN open the
 * project in MotionWorks. If the IDE rebuilds the grid from the text when it loads or
 * saves, then a .VB-only add is perfectly fine and refusing it is over-cautious.
 *
 * Test: write the .VB only, open, SAVE through the IDE, and see whether the grid count
 * catches up on its own.
 *
 * Run:  MW_PLUGIN=<installed> node test/global_reconcile.mjs
 */
import { existsSync, rmSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const { verb } = mod.__internals;
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

/** text declarations vs the grid's declared count */
function counts() {
  const out = execFileSync(PY, ['-c', `
import sys, struct, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.project import Project
from pathlib import Path
root = Path(r"${DIR}")
t = Project(root=root).global_variables()
cf = CompoundFile(root / "C" / "Configuration" / "R" / "Resource" / "src.st1")
g = next(n for n in cf.stream_names() if n.upper().endswith(".VGR"))
grid = struct.unpack_from("<I", cf.read_stream(g), 8)[0]
print(json.dumps({"text": len(t.variables), "grid": grid, "warnings": list(getattr(t,'warnings',[]) or [])}))
`], { encoding: 'utf8' }).trim();
  return JSON.parse(out);
}

const show = (label) => {
  const c = counts();
  const state = c.text === c.grid ? 'CONSISTENT' : `MISMATCH (+${c.text - c.grid})`;
  console.log(`  ${label.padEnd(34)} text=${String(c.text).padStart(3)}  grid=${String(c.grid).padStart(3)}  ${state}`
    + (c.warnings.length ? `\n      warning: ${c.warnings[0]}` : ''));
  return c;
};

line('1. fresh stage');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
show('pristine');

line('2. add a GLOBAL by writing the .VB only (bypassing the refusal)');
await run('mw_ide_close');
// Call the engine directly, since the plugin refuses this path by design.
const added = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp import writer as W
from pathlib import Path
from motionworks_iec_mcp.pou_writer import PouPlanError
root = Path(r"${DIR}")
# Bypass _refuse_global_write, since this test exists to see whether the IDE repairs it.
W._refuse_global_write = lambda pou_name, action: None
plan = W.plan_variable_add(root, None, "ReconcileTag", "BOOL", section="VAR_GLOBAL")
res = W.apply_declaration(plan, root, dry_run=False)
print(json.dumps({"applied": True, "target": str(plan.target), "stream": plan.stream}))
`], { encoding: 'utf8' });
console.log(`  ${added.trim()}`);
const afterWrite = show('after the .VB-only add');

line('3. OPEN the project in the IDE, then SAVE it');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
show('after the IDE opened it');

let saved = 'not attempted';
try { saved = JSON.stringify(await verb('save', {}, 180000)); } catch (e) { saved = `FAILED: ${e.message.split('\n')[0]}`; }
console.log(`  save -> ${saved}`);
await new Promise((r) => setTimeout(r, 2000));
const afterSave = show('after the IDE SAVED it');

line('4. build');
const b = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)  `
  + `Errors=${e.count} lines, ${refs} reference problems`);

line('VERDICT');
console.log(`  .VB-only add left:  text=${afterWrite.text} grid=${afterWrite.grid}`);
console.log(`  after IDE save:     text=${afterSave.text} grid=${afterSave.grid}`);
if (afterSave.grid === afterSave.text && b.is_compiled === true) {
  console.log('\n  *** THE IDE RECONCILES IT. ***');
  console.log('  A .VB-only global add is FINE in the workflow where the user opens the');
  console.log('  project in MotionWorks: the IDE rebuilds the grid from the text. My refusal');
  console.log('  was measured against a headless build and is too strict for this route.');
} else if (afterSave.grid === afterWrite.grid) {
  console.log('\n  the IDE did NOT fix the grid - the two stores stay out of step, so a');
  console.log('  .VB-only global add is genuinely unsafe. The refusal stands.');
} else {
  console.log('\n  partial reconciliation - build result is the decider above.');
}
