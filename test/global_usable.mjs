/**
 * IS A NEWLY ADDED GLOBAL USABLE?
 *
 * Rounds 13-17 established that a POU-scoped declaration can be written but not USED: the
 * compiler resolves a POU variable through that POU's .VGR grid, and a declaration living
 * only in the text is not in it, so referring to it stalls the build.
 *
 * But GLOBALS are a different path entirely. mw_code_var_add writes Global_Variables.VB and
 * the project builds cleanly afterwards - verified repeatedly - and the resource-level
 * Global_Variables.VGR has a different layout from a POU grid. What was never tested is the
 * half that actually matters: can a NEW global be USED in a POU body?
 *
 * Nobody asked, because the global case was once REFUSED and later un-refused, and both
 * times only the build was checked, not the use. If a new global is usable, then an agent
 * can add a working variable today and the POU-scoped limitation stops being a dead end.
 *
 *   Q  add a global, then USE it in a POU body       -> ?
 *   R  add a global, do not use it (control)         -> known clean
 *   S  use an EXISTING global in a body (control)    -> known clean, proves the method
 *
 * Run:  MW_PLUGIN=<installed> node test/global_usable.mjs
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
const VAR = 'ZZGlobalProbe';
const results = [];

async function kase(label, prepare) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');
  try { console.log(`     ${await prepare()}`); }
  catch (e) { console.log(`     prepare THREW: ${e.message.split('\n')[0].slice(0, 110)}`); }

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global|undeclared|unknown/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 4)) console.log(`       ${l}`);
  let globals = null;
  try { globals = (await run('mw_code_globals')).count; } catch { /* ignore */ }
  console.log(`     globals now: ${globals}`);
  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length, globals });
  await run('mw_ide_close');
}

await kase('Q. add a GLOBAL, then USE it in a POU body', async () => {
  const w = await run('mw_code_var_add', {
    name: VAR, type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'FALSE', dry_run: false,
  });
  const g = await run('mw_code_globals');
  const visible = (g.variables ?? []).some((v) => v.name === VAR);
  const r = await run('mw_code_read_st', { pou: POU });
  const body = r.body.replace(/\s+$/, '') + `${NL}(* uses the new global *)${NL}${VAR} := NOT ${VAR};${NL}`;
  const bw = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
  return `global applied=${w.result?.applied} visible=${visible}; body uses it applied=${bw.result?.applied}`;
});

await kase('R. add a GLOBAL, do not use it (control)', async () => {
  const w = await run('mw_code_var_add', {
    name: VAR, type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'FALSE', dry_run: false,
  });
  const g = await run('mw_code_globals');
  return `global applied=${w.result?.applied} count=${g.count}`;
});

await kase('S. use an EXISTING global in a body (proves the method)', async () => {
  const g = await run('mw_code_globals');
  const existing = (g.variables ?? []).find((v) => v.type === 'BOOL' && /^[A-Za-z_]/.test(v.name));
  if (!existing) throw new Error('no existing BOOL global found');
  const r = await run('mw_code_read_st', { pou: POU });
  const body = r.body.replace(/\s+$/, '') + `${NL}(* uses an existing global *)${NL}${existing.name} := NOT ${existing.name};${NL}`;
  const bw = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
  return `used existing global ${existing.name}; applied=${bw.result?.applied}`;
});

console.log(`\n${'═'.repeat(96)}`);
console.log('  RESULT');
console.log('═'.repeat(96));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 46).padEnd(48)} `
    + `compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real} globals=${r.globals}`);
}
const q = results.find((r) => r.label.startsWith('Q'));
console.log('');
if (q?.compiled === true && q.real === 0) {
  console.log('  *** A NEW GLOBAL IS USABLE. ***');
  console.log('  So an agent CAN add a working variable today - as a global - and the POU-scoped');
  console.log('  limitation is a restriction on scope, not a dead end.');
} else if (q?.stalled) {
  console.log('  a new global is NOT usable either - the same grid rule applies to the resource');
  console.log('  Global_Variables.VGR. Then the limitation is uniform and worth stating that way.');
} else {
  console.log('  see the table above.');
}
