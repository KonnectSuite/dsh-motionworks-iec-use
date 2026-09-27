/**
 * DECLARATION ALONE vs DECLARATION + BODY: which one actually breaks the build?
 *
 * The last run produced a result that contradicts everything before it. A declaration added
 * to the .VB, with the .VGR grid left STALE and untouched, gave is_compiled=true in 4.1s -
 * and neither store was damaged afterwards (.VB stayed at 1134 bytes, the grid stayed at
 * 1565). Every earlier failing test ALSO wrote the body, so this separates them:

 *   C  declaration only, no body write          -> ?
 *   D  declaration AND a body write             -> ?
 *   E  body write only, no declaration          -> known clean, included as a control
 *
 * If C passes and D fails, the plugin can add declarations - it just must not change the
 * body in the same step, which is a rule an agent can follow. If both pass, the earlier
 * failures were something else again.
 *
 * Run:  MW_PLUGIN=<installed> node test/decl_vs_body.mjs
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
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZDeclOnly2';
const helper = (...args) => JSON.parse(
  execFileSync(PY, [HELPER, ...args], { encoding: 'utf8' }).trim().split('\n').pop(),
);

const results = [];

async function kase(label, prepare) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');

  const before = helper('state', DIR, POU, VAR);
  let note = '';
  try { note = await prepare(); } catch (e) { note = `THREW: ${e.message.split('\n')[0].slice(0, 80)}`; }
  const after = helper('state', DIR, POU, VAR);
  console.log(`     before: vb=${before.vb_bytes}B gridCount=${before.grid_count}`);
  console.log(`     after : vb=${after.vb_bytes}B gridCount=${after.grid_count} hasVar=${after.vb_has_var}  ${note}`);

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build : is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 2)) console.log(`       ${l}`);
  const post = helper('state', DIR, POU, VAR);
  console.log(`     post  : vb=${post.vb_bytes}B grid=${post.grid_bytes}B count=${post.grid_count}`);
  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length,
    vbAfter: post.vb_bytes, gridAfter: post.grid_bytes });
  await run('mw_ide_close');
}

await kase('C. declaration only (no body write)', () => {
  helper('add', DIR, POU, VAR);
  return 'declaration written to .VB';
});

await kase('D. declaration AND a body write', async () => {
  helper('add', DIR, POU, VAR);
  const r = await run('mw_code_read_st', { pou: POU });
  const edited = r.body.replace(/\s+$/, '') + `${NL}(* decl+body probe *)${NL}`;
  const w = await run('mw_code_write_st', { pou: POU, body: edited, dry_run: false });
  return `declaration + body (applied=${w.result?.applied})`;
});

await kase('F. declaration AND a body that USES it', async () => {
  helper('add', DIR, POU, VAR);
  const r = await run('mw_code_read_st', { pou: POU });
  const edited = r.body.replace(/\s+$/, '') + `${NL}(* uses the new declaration *)${NL}${VAR} := NOT ${VAR};${NL}`;
  const w = await run('mw_code_write_st', { pou: POU, body: edited, dry_run: false });
  return `declaration + body using it (applied=${w.result?.applied})`;
});

await kase('E. body write only (control)', async () => {
  const r = await run('mw_code_read_st', { pou: POU });
  const edited = r.body.replace(/\s+$/, '') + `${NL}(* body only probe *)${NL}`;
  const w = await run('mw_code_write_st', { pou: POU, body: edited, dry_run: false });
  return `body only (applied=${w.result?.applied})`;
});

console.log(`\n${'═'.repeat(92)}`);
console.log('  RESULT');
console.log('═'.repeat(92));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.padEnd(38)} compiled=${String(r.compiled).padEnd(5)} `
    + `stalled=${String(r.stalled).padEnd(5)} real=${r.real}  vb=${r.vbAfter}B grid=${r.gridAfter}B`);
}
const c = results.find((r) => r.label.startsWith('C'));
const d = results.find((r) => r.label.startsWith('D'));
console.log('');
if (c?.compiled === true && d?.compiled === false) {
  console.log('  *** A DECLARATION ALONE IS FINE; ADDING IT TOGETHER WITH A BODY EDIT IS NOT. ***');
  console.log('  That is a rule an agent can follow: change declarations and body in separate steps,');
  console.log('  building in between.');
} else if (c?.compiled === true && d?.compiled === true) {
  console.log('  both pass - the earlier failures were something else again.');
} else {
  console.log('  see the table above.');
}
