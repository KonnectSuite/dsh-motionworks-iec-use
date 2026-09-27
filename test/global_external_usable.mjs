/**
 * CAN A GLOBAL BE ADDED AND THEN ACTUALLY USED?
 *
 * Round 18 established that naming a global a POU has not declared as VAR_EXTERNAL makes the
 * build STALL - silently, with an empty Errors pane. IEC 61131-3 requires the declaration, and
 * a new global never had one, so a global added through this plugin could be declared but never
 * used. That was the last real gap in the variable story.
 *
 * The obstacle was that a VAR_EXTERNAL declaration is a POU-scoped declaration, so it needs a
 * grid record - and append_grid_variable wrote usage=1 (local) unconditionally. A record saying
 * LOCAL for a declaration the text marks EXTERNAL is a contradiction between the two stores.
 * That is fixed: usage 5 and the ffffffff marker are written for VAR_EXTERNAL, matching a real
 * external record byte for byte.
 *
 * So the whole chain is now testable for the first time:
 *
 *   1. add a GLOBAL variable
 *   2. declare it VAR_EXTERNAL in a POU     (a POU-scoped declaration, now with the right record)
 *   3. USE it in that POU's body
 *   4. build
 *
 *   G1  global + VAR_EXTERNAL + USE      -> ?
 *   G2  global + VAR_EXTERNAL, not used  -> control
 *   G3  global only, then USE            -> the known stall, control
 *
 * Run:  MW_PLUGIN=<installed> node test/global_external_usable.mjs
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
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZSharedTag';
const results = [];

async function kase(label, declareExternal, useIt) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');

  const g = await run('mw_code_var_add', {
    name: VAR, type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'FALSE', dry_run: false,
  });
  const gl = await run('mw_code_globals');
  console.log(`     global  : applied=${g.result?.applied} visible=${(gl.variables ?? []).some((v) => v.name === VAR)}`);

  if (declareExternal) {
    const e = await run('mw_code_var_add', {
      pou: POU, name: VAR, type: 'BOOL', section: 'VAR_EXTERNAL', dry_run: false,
    });
    console.log(`     external: applied=${e.result?.applied}`);
    for (const n of (e.result?.notes ?? [])) console.log(`       note: ${String(n).slice(0, 110)}`);
  }

  const r = await run('mw_code_read_st', { pou: POU });
  const declared = (r.variables ?? []).find((v) => v.name === VAR);
  console.log(`     POU sees it: ${declared ? `section=${declared.section}` : 'no'}`);

  if (useIt) {
    const body = r.body.replace(/\s+$/, '') + `${NL}(* uses the global via VAR_EXTERNAL *)${NL}${VAR} := NOT ${VAR};${NL}`;
    try {
      const w = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
      console.log(`     body    : applied=${w.result?.applied}`);
    } catch (err) {
      console.log(`     body REFUSED: ${String(err.message).replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build   : is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 3)) console.log(`       ${l}`);
  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length });
  await run('mw_ide_close');
}

await kase('G1. global + VAR_EXTERNAL + USE', true, true);
await kase('G2. global + VAR_EXTERNAL, not used', true, false);
await kase('G3. global only, then USE (the old stall)', false, true);

console.log(`\n${'═'.repeat(94)}`);
console.log('  RESULT');
console.log('═'.repeat(94));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 44).padEnd(46)} `
    + `compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real}`);
}
const g1 = results.find((r) => r.label.startsWith('G1'));
console.log('');
if (g1?.compiled === true && g1.real === 0) {
  console.log('  *** A GLOBAL CAN BE ADDED AND USED. ***');
  console.log('  global -> VAR_EXTERNAL -> use -> build clean. The last variable gap is closed.');
} else if (g1?.stalled) {
  console.log('  still stalls - see the notes above for what was written and what the POU sees.');
} else {
  console.log('  see the table above.');
}
