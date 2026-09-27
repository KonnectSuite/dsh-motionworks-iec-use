/**
 * Can a declaration be added by ZEROING the grid and letting the IDE rebuild it?
 *
 * The grid cannot be deleted (CompoundFile has no removal API), so the helper zeroes its
 * record count instead. Two cases on fresh copies, both judged by a build:
 *
 *   add             declaration in the .VB, grid left stale   (the known-bad control)
 *   add-zero-grid   declaration in the .VB, grid count set 0  (does the IDE rebuild it?)
 *
 * Run:  MW_PLUGIN=<installed> node test/grid_zero.mjs
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
const HELPER = `${PLUGIN}\\test\\grid_zero_helper.py`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const helper = (...args) => JSON.parse(
  execFileSync(PY, [HELPER, ...args], { encoding: 'utf8' }).trim().split('\n').pop(),
);

async function stageFresh() {
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
}

async function openBuild() {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 2)) console.log(`       ${l}`);
  return { compiled: b.is_compiled, stalled: !!b.stalled, real: real.length };
}

const results = [];

for (const [op, label] of [
  ['add', 'A. declaration, grid left STALE (control)'],
  ['add-zero-grid', 'B. declaration, grid count set to 0'],
]) {
  line(label);
  await stageFresh();
  let before = null;
  let after = null;
  try {
    before = helper('state', DIR, POU, 'ZZZeroProbe');
    after = helper(op, DIR, POU, 'ZZZeroProbe');
    console.log(`  before: grid=${before.grid_bytes}B count=${before.grid_count} parsed=${before.grid_parsed} vb=${before.vb_bytes}B`);
    console.log(`  after : grid=${after.grid_bytes}B count=${after.grid_count} parsed=${after.grid_parsed} `
      + `vb=${after.vb_bytes}B hasVar=${after.vb_has_var}`);
  } catch (e) {
    console.log(`  helper failed: ${e.message.split('\n')[0].slice(0, 140)}`);
  }
  const b = await openBuild();
  const post = (() => { try { return helper('state', DIR, POU, 'ZZZeroProbe'); } catch { return null; } })();
  if (post) {
    console.log(`  after build: grid=${post.grid_bytes}B count=${post.grid_count} parsed=${post.grid_parsed} `
      + `vb=${post.vb_bytes}B hasVar=${post.vb_has_var}`);
  }
  results.push({ label, ...b, post });
  await run('mw_ide_close');
}

line('VERDICT');
for (const r of results) {
  console.log(`  ${r.label}`);
  console.log(`     compiled=${r.compiled} stalled=${r.stalled} real=${r.real}`);
}
const b = results.find((r) => r.label.startsWith('B'));
if (b && b.compiled === true && b.real === 0) {
  console.log('\n  *** ZEROING THE GRID WORKS - the IDE rebuilds it from the text. ***');
  console.log('  That is the declaration path, with no binary surgery at all.');
} else if (b && b.post && b.post.grid_count > 0 && b.post.grid_parsed > 0) {
  console.log('\n  the grid was repopulated, but the build still did not pass - look above.');
} else {
  console.log('\n  zeroing the grid does not make the IDE rebuild it.');
}
