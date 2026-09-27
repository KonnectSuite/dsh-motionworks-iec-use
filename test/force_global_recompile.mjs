/**
 * Force Global_Variables to be recompiled after an assign - does that fix the build?
 *
 * Established, step by step:
 *   3. after ASSIGN      resource NODES.LST = 802B, VAR_GLOBALS present, all tasks intact
 *   5. after open        = 802B, still intact - the IDE loaded a consistent project
 *   6. after BUILD       = 499B, everything after SlowTsk gone   (compiled=false)
 *
 * The Build pane shows why it fails: the baseline lists Global_Variables among the units
 * being compiled, and the failing build lists the NEW POU instead. So the globals unit is
 * never recompiled, the IEC code generator has no global table, every POU's VAR_EXTERNAL
 * fails with "No matching global variable found", and the failed build then writes back
 * a truncated model - losing VAR_GLOBALS, the Start task and TopCutterInitialize.
 *
 * If clearing the compiler's change-tracking (CHGUNITS.LST) and the Global_Variables
 * artifacts makes the build recompile that unit, the project compiles and the plugin has
 * both a fix and a repair path.
 *
 * Run:  MW_PLUGIN=<installed> node test/force_global_recompile.mjs
 */
import { existsSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const RES_NODES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const nodesSize = () => { try { return statSync(RES_NODES).size; } catch { return -1; } };
const nodesOk = () => { try { return readFileSync(RES_NODES, 'latin1').includes('VAR_GLOBALS'); } catch { return false; } };
const refs = (lines) => (lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;

line('1. fresh stage, create + assign (the failing sequence)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\ForceProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'ForceProbe', template: 'TopCutterInitialize', dry_run: false });
await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'ForceProbe', dry_run: false });
console.log(`  after assign: NODES.LST ${nodesSize()}B, VAR_GLOBALS present=${nodesOk()}`);

line('2. clear the compiler change-tracking and artifacts, then build');
const removed = [];
const walk = (d) => {
  let entries = [];
  try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(CIC|DIT)$/i.test(e.name) || /^(CHGUNITS\.LST|__Resource\.ERR|cocrc\.lst)$/i.test(e.name)) {
      try { rmSync(p, { force: true }); removed.push(e.name); } catch { /* locked */ }
    }
  }
};
walk(DIR);
console.log(`  removed ${removed.length} artifact(s) including CHGUNITS.LST: ${removed.includes('CHGUNITS.LST')}`);

await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const build = await run('mw_ide_errors', { pane: 'Build', limit: 60 });
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
console.log(`  Errors: ${e.count} lines, ${refs(e.lines)} reference problems`);
console.log(`  NODES.LST now: ${nodesSize()}B, VAR_GLOBALS present=${nodesOk()}`);
console.log('  units compiled:');
for (const l of (build.lines ?? [])) console.log(`      ${l}`);

line('VERDICT');
if (b.is_compiled === true && nodesOk()) {
  console.log('  *** FIXED ***');
  console.log('  Clearing the change-tracking makes the build recompile Global_Variables, the');
  console.log('  project compiles, and NODES.LST is left intact.');
} else if (b.is_compiled === true) {
  console.log('  compiled, but NODES.LST still lost VAR_GLOBALS - repair still needed.');
} else {
  console.log('  still failing - the globals unit is not the whole story.');
}
