/**
 * ISOLATION: edit an existing POU's body and change NOTHING else.
 *
 * Everything so far has bundled two changes together - a new variable AND a body edit -
 * and the build has failed with zero errors every time. The grid record is now provably
 * correct (it decodes to handle 1059, usage 1, row 26, type BOOL, name ZZProbeTag), the
 * "Variable not found" error is gone, and yet is_compiled stays false with an empty
 * Errors pane.
 *
 * So the variable may not be the cause at all. This changes ONLY the body text of an
 * existing POU - no declaration touched, no tree touched, no grid touched - and builds.
 *
 * If that alone fails, the body write is what the compiler objects to and the grid work
 * was chasing the wrong thing. If it succeeds, the variable really is the trigger and the
 * remaining difference is in the declaration.
 *
 * Run:  MW_PLUGIN=<installed> node test/body_only.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';

async function buildAndReport(label) {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
  console.log(`  ${label}: is_compiled=${b.is_compiled} (${b.elapsed_s}s)  Errors=${e.count}  BuildPane=${bp.count}`);
  if ((e.lines ?? []).length) {
    for (const l of (e.lines ?? []).slice(0, 5)) console.log(`      ${l}`);
  }
  const reachedInstance = (bp.lines ?? []).some((l) => /Building instance tree/.test(l));
  console.log(`      reached "Building instance tree": ${reachedInstance}`);
  if (!reachedInstance && (bp.lines ?? []).length) {
    console.log(`      last phase logged: ${(bp.lines ?? [])[(bp.lines ?? []).length - 1]}`);
  }
  await run('mw_ide_close');
  return { compiled: b.is_compiled, errors: e.count, reachedInstance };
}

line('1. fresh stage, build UNCHANGED to establish the baseline');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
const baseline = await buildAndReport('baseline (nothing changed)');

line('2. write the SAME body back, byte for byte, and build');
const read = await run('mw_code_read_st', { pou: POU });
const same = await run('mw_code_write_st', { pou: POU, body: read.body, dry_run: false });
console.log(`  rewrote the identical body: applied=${same.result?.applied}`);
const afterIdentical = await buildAndReport('after an identical rewrite');

line('3. append ONE comment line and build');
const edited = read.body.replace(/\s+$/, '') + `${NL}(* one extra comment *)${NL}`;
const w = await run('mw_code_write_st', { pou: POU, body: edited, dry_run: false });
console.log(`  appended a comment: applied=${w.result?.applied}`);
const afterComment = await buildAndReport('after a one-line comment edit');

line('VERDICT');
console.log(`  baseline                : compiled=${baseline.compiled} reachedInstance=${baseline.reachedInstance}`);
console.log(`  identical body rewrite  : compiled=${afterIdentical.compiled} reachedInstance=${afterIdentical.reachedInstance}`);
console.log(`  one extra comment       : compiled=${afterComment.compiled} reachedInstance=${afterComment.reachedInstance}`);
if (!baseline.compiled) {
  console.log('\n  the BASELINE failed, so this run cannot attribute anything - rerun.');
} else if (!afterIdentical.compiled) {
  console.log('\n  *** WRITING THE BODY AT ALL BREAKS THE BUILD ***, even when the text is');
  console.log('  unchanged. The variable and grid work was chasing the wrong cause.');
} else if (!afterComment.compiled) {
  console.log('\n  an identical rewrite is fine, but a COMMENT change breaks it - the');
  console.log('  difference is in what the writer emits for a modified body.');
} else {
  console.log('\n  body edits are clean on their own, so the DECLARATION is the trigger.');
}
