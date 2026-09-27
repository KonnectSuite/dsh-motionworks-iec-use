/**
 * CAN a declaration be declared AND USED with no IDE step?
 *
 * That is the last gap. Round 12 established the rule: declaring is safe, using needs the
 * .VGR grid, and this plugin's append was believed to destroy the POU. But the destruction
 * was measured against an EARLIER append - three-string assumption, external marker left in
 * the trailing run of a record marked local. Both fixed since, and never re-tested.
 *
 * So this tests the corrected append end to end, judging by a build:
 *
 *   G  declaration + correct grid record + body that USES it   -> does it compile?
 *   H  declaration + grid, but body does NOT use it            -> control
 *   I  declaration only, no grid record (the known stall)      -> control
 *
 * Run:  MW_PLUGIN=<installed> node test/decl_grid_usable.mjs
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
const GRID_HELPER = `${PLUGIN}\\test\\decl_grid_helper.py`;
const ZERO_HELPER = `${PLUGIN}\\test\\grid_zero_helper.py`;
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZUsable1';
const parse = (out) => JSON.parse(out.trim().split('\n').pop());
const gridHelper = (...a) => parse(execFileSync(PY, [GRID_HELPER, ...a], { encoding: 'utf8' }));
const zeroHelper = (...a) => parse(execFileSync(PY, [ZERO_HELPER, ...a], { encoding: 'utf8' }));

const results = [];

async function kase(label, prepare, useIt) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');

  let info = null;
  try { info = await prepare(); } catch (e) { console.log(`     prepare THREW: ${e.message.split('\n')[0].slice(0, 120)}`); }
  if (info) {
    console.log(`     vb=${info.vb_bytes}B hasVar=${info.vb_has_var} line=${info.vb_var_line_1based} `
      + `| grid=${info.grid_bytes}B count=${info.grid_count} parsed=${info.grid_parsed}`);
    if (info.our_record) console.log(`     our record: ${JSON.stringify(info.our_record)}`);
  }
  if (useIt) {
    const r = await run('mw_code_read_st', { pou: POU });
    const body = r.body.replace(/\s+$/, '') + `${NL}(* uses it *)${NL}${VAR} := NOT ${VAR};${NL}`;
    const w = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
    console.log(`     body uses it: applied=${w.result?.applied}`);
  }

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 3)) console.log(`       ${l}`);
  const post = gridHelper('state', DIR, POU, VAR);
  console.log(`     post: vb=${post.vb_bytes}B grid=${post.grid_bytes}B count=${post.grid_count} parsed=${post.grid_parsed}`);
  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length,
    vbAfter: post.vb_bytes, gridAfter: post.grid_bytes, gridCount: post.grid_count });
  await run('mw_ide_close');
}

await kase('G. declaration + CORRECT grid record + body USES it',
  () => gridHelper('decl-plus-grid', DIR, POU, VAR), true);

await kase('H. declaration + grid record, body does not use it',
  () => gridHelper('decl-plus-grid', DIR, POU, VAR), false);

await kase('I. declaration only, no grid record (known stall)',
  () => zeroHelper('add', DIR, POU, VAR), true);

console.log(`\n${'═'.repeat(96)}`);
console.log('  RESULT');
console.log('═'.repeat(96));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 44).padEnd(46)} compiled=${String(r.compiled).padEnd(5)} `
    + `stalled=${String(r.stalled).padEnd(5)} real=${r.real} gridCount=${r.gridCount}`);
}
const g = results.find((r) => r.label.startsWith('G'));
console.log('');
if (g?.compiled === true && g.real === 0) {
  console.log('  *** A DECLARATION CAN BE DECLARED AND USED WITH NO IDE STEP. ***');
  console.log('  The corrected append produces a grid record MotionWorks accepts: build clean,');
  console.log('  variable usable. The last gap is closed.');
} else if (g?.stalled) {
  console.log('  the corrected append still stalls - the record is closer but not right.');
  console.log('  Note whether the POU survived: gridCount and vbAfter above say so.');
} else {
  console.log('  see the table above.');
}
