/**
 * DOES A FAILING BUILD DAMAGE THE PROJECT?
 *
 * Observed twice: after a build returned is_compiled=false, the `Start` task and its
 * TopCutterInitialize assignment had disappeared from PROJECT.TRE, while the same
 * check immediately before the build showed them present. If that reproduces under
 * control it is an IDE behaviour the plugin must defend against, not something the
 * code writer caused.
 *
 * Controlled sequence on a PRISTINE project:
 *   1. stage, open, build        -> expect SUCCESS, tasks intact
 *   2. assign a POU with a deliberate compile error is not needed: instead force a
 *      failure by assigning a POU whose body references an undeclared variable
 *   3. build                     -> expect FAILURE; check the tasks again
 *
 * Run:  MW_PLUGIN=<installed> node test/prove_build_damage.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'â”€'.repeat(74)}\n  ${s}\n${'â”€'.repeat(74)}`);

const SOURCES = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean);
const SOURCE = SOURCES.find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

function tasks() {
  const script = `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.tree import load_tree, task_assignments
from pathlib import Path
print(json.dumps(task_assignments(load_tree(Path(r"${DIR}"))[0]), sort_keys=True))
`;
  return JSON.parse(execFileSync(PY, ['-c', script], { encoding: 'utf8' }).trim());
}

const show = (label, t) => {
  console.log(`  ${label}: ${Object.keys(t).length} tasks â€” ${Object.entries(t).map(([k, v]) => `${k}(${v.length})`).join(' ')}`);
};

line('1. pristine stage');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\BadPou`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
const t0 = tasks();
show('pristine', t0);

line('2. CONTROL â€” build a healthy project');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b1 = await run('mw_ide_build');
console.log(`  build: is_compiled=${b1.is_compiled} (${b1.elapsed_s}s)`);
const t1 = tasks();
show('after successful build', t1);

line('3. introduce a GUARANTEED compile error and assign it');
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'BadPou', template: 'TopCutterInitialize', dry_run: false });
await run('mw_code_write_st', {
  pou: 'BadPou',
  body: 'UndefinedThingXYZ := UndefinedThingXYZ + 1;\r\n',
  dry_run: false,
  run_lint: false,          // force it past the linter; the compiler is the judge
});
await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'BadPou', dry_run: false });
const t2 = tasks();
show('after create+assign (before build)', t2);

line('4. build â€” expect FAILURE');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const t2b = tasks();
show('after OPEN, before build', t2b);
const b2 = await run('mw_ide_build');
console.log(`  build: is_compiled=${b2.is_compiled} (${b2.elapsed_s}s)`);
const t3 = tasks();
show('after failing build', t3);

line('VERDICT');
const lost = Object.keys(t2).filter((k) => !(k in t3));
const lostProgs = Object.entries(t2).flatMap(([k, ps]) => ps.map((p) => `${k}:${p}`))
  .filter((pair) => { const [k, p] = pair.split(':'); return !(t3[k] ?? []).includes(p); });
console.log(`  control build succeeded: ${b1.is_compiled === true}`);
console.log(`  second build failed    : ${b2.is_compiled === false}`);
console.log(`  tasks lost to the failure : ${lost.length ? lost.join(', ') : '(none)'}`);
console.log(`  assignments lost          : ${lostProgs.length ? lostProgs.join(', ') : '(none)'}`);
if (b1.is_compiled === true && b2.is_compiled === false && lost.length === 0) {
  console.log('\n  A FAILING BUILD IS HARMLESS â€” the earlier loss had another cause.');
} else if (lost.length > 0) {
  console.log('\n  A FAILING BUILD DAMAGES THE TASK TREE. The plugin must snapshot and');
  console.log('  verify the tree around a build, or refuse to build without a backup.');
}
