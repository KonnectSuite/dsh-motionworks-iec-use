/**
 * ISOLATION: add ONE declaration and change nothing else at all.
 *
 * Why this test exists. Every earlier failing run bundled a declaration with a body edit,
 * so neither could be blamed. Splitting the other way:
 *
 *   test/body_only.mjs      baseline, an identical body rewrite, and a one-line comment
 *                           edit  ->  ALL is_compiled=true, all reached "Building
 *                           instance tree". The body path is clean.
 *   test/grid_append_build  a declaration AND a body edit  ->  is_compiled=false with an
 *                           empty Errors pane even after the .VGR record was made correct
 *
 * The plugin must not refuse a capability on inference - that mistake was already made
 * once, when global writes were refused because a global add and a task assignment failed
 * in the same run, and isolating it later showed globals were fine all along. So this
 * decides it: add one declaration, touch nothing else, build.
 *
 * Run:  MW_PLUGIN=<installed> node test/declaration_only.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const HELPER = `${PLUGIN}\\test\\declaration_helper.py`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZDeclOnly';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const helper = (op, ...rest) => JSON.parse(
  execFileSync(PY, [HELPER, op, DIR, POU, VAR, ...rest], { encoding: 'utf8' }).trim(),
);

async function buildAndReport(label) {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
  const inst = (bp.lines ?? []).some((l) => /Building instance tree/.test(l));
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`  ${label.padEnd(32)} is_compiled=${String(b.is_compiled).padEnd(5)} `
    + `stalled=${String(b.stalled).padEnd(5)} (${b.elapsed_s}s)  Errors=${e.count} real=${real.length} instanceTree=${inst}`);
  for (const l of real.slice(0, 3)) console.log(`      ${l}`);
  await run('mw_ide_close');
  return { compiled: b.is_compiled, stalled: b.stalled, real: real.length, inst };
}

line('1. fresh stage, baseline build');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
const baseline = await buildAndReport('baseline (nothing changed)');
const g0 = helper('grids');
console.log(`  grid before: count=${g0.grid_count} parsed=${g0.grid_parsed} bytes=${g0.grid_bytes} textHasVar=${g0.text_has_var}`);

line('2. add ONE declaration (.VB text + .VGR record). No body write, no tree write.');
const added = helper('add', 'BOOL');
console.log(`  added '${added.added}' as handle ${added.handle}`);
console.log(`  grid after : count=${added.grid_count} parsed=${added.grid_parsed} bytes=${added.grid_bytes} textHasVar=${added.text_has_var}`);
const last = (added.records ?? []).slice(-1)[0];
console.log(`  last record: ${JSON.stringify(last)}`);
check(added.text_has_var === true, 'the .VB text carries the declaration');
check(added.grid_count === added.grid_parsed, `grid count and parsed records agree (${added.grid_count})`);
check(!!last && last.name === VAR, `the appended record decodes as '${VAR}'`);

line('3. build');
const after = await buildAndReport('after the declaration');

line('VERDICT');
console.log(`  baseline          : compiled=${baseline.compiled} stalled=${baseline.stalled} real=${baseline.real}`);
console.log(`  + one declaration : compiled=${after.compiled} stalled=${after.stalled} real=${after.real} instanceTree=${after.inst}`);
if (!baseline.compiled) {
  console.log('\n  the BASELINE failed, so this run attributes nothing - rerun.');
} else if (after.compiled) {
  console.log('\n  *** DECLARATIONS ARE FINE ON THEIR OWN. ***');
  console.log('  The earlier failures were an interaction with the body write, and the plugin');
  console.log('  must NOT refuse mw_code_var_add.');
} else {
  console.log('\n  *** A DECLARATION ALONE BREAKS THE BUILD. ***');
  console.log('  Both stores are correct and the Errors pane is silent, so something else must');
  console.log('  carry the declaration. Until that is found, mw_code_var_add must warn loudly');
  console.log('  and the agent must build immediately to verify.');
}
console.log(failures === 0 ? '\n  all structural checks passed' : `\n  ${failures} structural check(s) failed`);
