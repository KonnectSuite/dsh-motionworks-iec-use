/**
 * Is the pristine project ALREADY broken, and its clean build merely incremental?
 *
 * Established so far:
 *   - assign changes only NODES.LST, correctly; all 5 tasks survive; the tree is intact
 *   - yet after ANY assign the build reports 125 "No matching global variable found"
 *     errors naming the EXISTING POUs, never the new one
 *
 * MotionWorks compiles by delta - the Build pane lists a handful of units, and
 * CHGUNITS.LST tracks which ones changed. So a clean verdict may only ever have covered
 * a few units. Adding a program to a task changes the resource's program list, which
 * plausibly forces everything to be recompiled - and then latent errors in the ORIGINAL
 * project would appear.
 *
 * Test: on a FRESH stage with nothing assigned, delete the compile artifacts so nothing
 * can be reused, and build. If the same 125 errors appear, they were always there.
 *
 * Run:  MW_PLUGIN=<installed> node test/full_rebuild.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const countRefs = (lines) => (lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;

async function buildAndReport(label) {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
  const info = await run('mw_ide_errors', { pane: 'Build', limit: 60 });
  console.log(`  ${label}: is_compiled=${b.is_compiled} (${b.elapsed_s}s)  `
    + `Errors=${e.count} lines, ${countRefs(e.lines)} reference problems  Build pane=${info.count}`);
  return { compiled: b.is_compiled, refs: countRefs(e.lines), errors: e.count, buildLines: info.lines ?? [] };
}

line('1. fresh stage, NOTHING modified');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });

line('2. baseline build (what the plugin has been trusting)');
const baseline = await buildAndReport('baseline');
console.log('  units the baseline build actually compiled:');
for (const l of baseline.buildLines) console.log(`      ${l}`);
await run('mw_ide_close');

line('3. delete the compile artifacts so NOTHING can be reused, then build again');
// CHGUNITS.LST records which units the compiler considers changed; the per-function
// .CIC/.DIT pairs and the resource .ERR are its outputs. Removing them forces a full
// compile in the same way a fresh checkout would.
const victims = [];
const walk = (d) => {
  let entries = [];
  try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(CIC|DIT)$/i.test(e.name) || /^(CHGUNITS\.LST|__Resource\.ERR|cocrc\.lst)$/i.test(e.name)) {
      try { victims.push(p); rmSync(p, { force: true }); } catch { /* locked */ }
    }
  }
};
walk(DIR);
const byKind = {};
for (const v of victims) {
  const k = v.split('.').pop().toLowerCase();
  byKind[k] = (byKind[k] ?? 0) + 1;
}
console.log(`  removed ${victims.length} artifact(s): ${JSON.stringify(byKind)}`);

line('4. build with no artifacts to reuse');
const full = await buildAndReport('full rebuild');
console.log('  units the FULL build compiled:');
for (const l of (full.buildLines ?? []).slice(0, 30)) console.log(`      ${l}`);

line('VERDICT');
console.log(`  incremental baseline : compiled=${baseline.compiled}  reference problems=${baseline.refs}`);
console.log(`  full rebuild         : compiled=${full.compiled}  reference problems=${full.refs}`);
if (full.refs >= 100 && baseline.refs === 0) {
  console.log('\n  *** THE PRISTINE PROJECT DOES NOT FULLY COMPILE. ***');
  console.log('  The clean verdict only ever covered the units the incremental compiler chose');
  console.log('  to touch. Nothing the plugin does introduces these errors - adding a program');
  console.log('  merely forces the full compile that reveals them.');
} else if (full.refs === 0) {
  console.log('\n  a full rebuild is clean too, so the errors ARE caused by the assign.');
} else {
  console.log('\n  inconclusive - both builds show reference problems.');
}
