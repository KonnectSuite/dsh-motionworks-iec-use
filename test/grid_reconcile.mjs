/**
 * Does an IDE SAVE regenerate a POU's .VGR grid from the .VB text?
 *
 * The single remaining error after the tree problem was solved:
 *
 *     Variable 'TopCutterCamSetup:AgentEditTag' not found!
 *
 * The variable is in the .VB text - mw_code_read_st returns it - but a POU ALSO has a
 * binary .VGR grid, and that grid still declares 12 records while the text declares 13.
 * The compiler resolves variables from the grid, so the new one is invisible.
 *
 * This is the same two-store shape as globals, and it explains why earlier POU variable
 * adds appeared to work: those builds were INCREMENTAL and never recompiled the variable
 * unit, so the stale grid was never consulted. Change the POU's body and the unit is
 * rebuilt, and the missing variable surfaces.
 *
 * If the IDE rebuilds the grid when it saves, then the workflow is: write, open, save,
 * build - and nothing needs to write the grid by hand.
 *
 * Run:  MW_PLUGIN=<installed> node test/grid_reconcile.mjs
 */
import { existsSync, rmSync } from 'node:fs';
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

const TARGET = 'TopCutterCamSetup';

/** text declarations vs the POU's own grid record count */
function pouCounts() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json, struct
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.project import Project
from pathlib import Path
root = Path(r"${DIR}")
pou = Project(root=root).pou("${TARGET}")
cf = CompoundFile(pou.source_path)
names = cf.stream_names()
vb = next((n for n in names if n.upper().endswith("V.VB")), None)
vg = next((n for n in names if n.upper().endswith("V.VGR")), None)
text = cf.read_stream(vb).decode("latin1") if vb else ""
grid_count = struct.unpack_from("<I", cf.read_stream(vg), 8)[0] if vg else -1
print(json.dumps({"text_has": "AgentEditTag" in text, "grid": grid_count}))
`], { encoding: 'utf8' }).trim());
}

const show = (label) => {
  const c = pouCounts();
  console.log(`  ${label.padEnd(30)} newVarInText=${c.text_has ? 'Y' : 'N'}  gridRecords=${c.grid}`);
  return c;
};

line('1. fresh stage, edit the POU, and add a variable');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_close');
show('pristine');
const before = await run('mw_code_read_st', { pou: TARGET });
const v = await run('mw_code_var_add', { pou: TARGET, name: 'AgentEditTag', type: 'BOOL', section: 'VAR', dry_run: false });
console.log(`  declared: applied=${v.result?.applied}`);
const afterAdd = show('after the .VB-only add');

line('2. also change the body so the variable unit MUST be rebuilt');
const edited = before.body.replace(/\s+$/, '')
  + '\r\n\r\n(* appended *) AgentEditTag := NOT AgentEditTag;\r\n';
const w = await run('mw_code_write_st', { pou: TARGET, body: edited, dry_run: false });
console.log(`  body written: applied=${w.result?.applied}`);

line('3. open, SAVE, then build');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
show('after open');
try { await verb('save', {}, 180000); console.log('  saved'); } catch (e) { console.log(`  save failed: ${e.message.split('\n')[0]}`); }
await new Promise((r) => setTimeout(r, 2500));
const afterSave = show('after IDE SAVE');

const b = await run('mw_ide_build');
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
console.log(`  Errors (${e.count}):`);
for (const l of (e.lines ?? []).slice(0, 6)) console.log(`      ${l}`);
const afterBuild = show('after build');

line('VERDICT');
console.log(`  grid records: pristine=${afterAdd.grid}  afterSave=${afterSave.grid}  afterBuild=${afterBuild.grid}`);
if (b.is_compiled === true) {
  console.log('\n  *** THE SAVE RECONCILES THE GRID AND THE BUILD SUCCEEDS. ***');
} else if (afterSave.grid === afterAdd.grid) {
  console.log('\n  the IDE did NOT rebuild the grid, so the POU variable write path has to');
  console.log('  update the .VGR grid itself - that is the remaining work.');
} else {
  console.log('\n  grid changed but the build still failed - see the errors above.');
}
