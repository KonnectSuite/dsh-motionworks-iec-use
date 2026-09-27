/**
 * CAPABILITY MATRIX: verify each operation end to end, on a fresh copy, by building.
 *
 * The plugin refuses two operations (POU declarations, new-POU assignment). Everything
 * else should work, and "should" is not good enough - each one is exercised here and the
 * verdict comes from MotionWorks compiling the result.
 *
 * One fresh stage per case, so no case can be blamed on another's leftovers.
 *
 * Run:  MW_PLUGIN=<installed> node test/capability_matrix.mjs
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

const results = [];

async function freshStage(label) {
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  try { rmSync(`${PLUGIN}\\backups\\archived-pous\\MatrixProbe`, { recursive: true, force: true }); } catch { /* absent */ }
  await run('mw_ide_stage', { source: SOURCE });
  console.log(`\n  ── ${label}`);
}

async function build() {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  const verdict = b.is_compiled === true ? 'PASS' : (b.stalled ? 'STALLED' : 'FAILED');
  console.log(`     build: ${verdict} (is_compiled=${b.is_compiled} stalled=${b.stalled} ${b.elapsed_s}s) `
    + `realProblems=${real.length}`);
  for (const l of real.slice(0, 2)) console.log(`       ${l}`);
  return { verdict, real: real.length, stalled: !!b.stalled };
}

async function kase(label, prepare) {
  await freshStage(label);
  let prep = 'ok';
  try { prep = await prepare(); } catch (e) { prep = `THREW: ${e.message.split('\n')[0].slice(0, 90)}`; }
  console.log(`     setup: ${typeof prep === 'string' ? prep : JSON.stringify(prep).slice(0, 140)}`);
  const b = await build();
  results.push({ label, prep, ...b });
  await run('mw_ide_close');
}

// 1. read-only
await kase('READ: pous / read_st / globals / tasks / unsupported', async () => {
  const p = await run('mw_code_pous');
  const r = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  const g = await run('mw_code_globals');
  const t = await run('mw_code_tasks');
  const u = await run('mw_code_unsupported');
  return `${p.pous.length} POUs, ${(r.variables ?? []).length} decls, ${g.count} globals, `
    + `${Object.keys(t.tasks).length} tasks, ${u.blocked.length} unsupported`;
});

// 2. body edit
await kase('WRITE: edit an existing POU body', async () => {
  const before = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  const edited = before.body.replace(/\s+$/, '') + `${NL}(* matrix probe *)${NL}`;
  const w = await run('mw_code_write_st', { pou: 'TopCutterCamSetup', body: edited, dry_run: false });
  const back = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  return `applied=${w.result?.applied} roundTrips=${back.body === edited}`;
});

// 3. global add
await kase('WRITE: add a GLOBAL variable', async () => {
  const w = await run('mw_code_var_add', {
    name: 'MatrixGlobal', type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'TRUE', dry_run: false,
  });
  const g = await run('mw_code_globals');
  return `applied=${w.result?.applied} globalsNow=${g.count} visible=${g.variables.some((v) => v.name === 'MatrixGlobal')}`;
});

// 4. global delete
await kase('WRITE: add then delete a GLOBAL variable', async () => {
  await run('mw_code_var_add', { name: 'MatrixGlobal2', type: 'BOOL', section: 'VAR_GLOBAL', dry_run: false });
  const d = await run('mw_code_var_delete', { name: 'MatrixGlobal2', force: true, dry_run: false });
  const g = await run('mw_code_globals');
  return `deleted=${d.result?.applied} stillPresent=${g.variables.some((v) => v.name === 'MatrixGlobal2')}`;
});

// 5. POU create (unassigned)
await kase('WRITE: create a POU (unassigned)', async () => {
  const c = await run('mw_code_pou_create', { name: 'MatrixProbe', template: 'TopCutterInitialize', dry_run: false });
  const p = await run('mw_code_pous');
  return `created=${!!c.result?.node_ids} pousNow=${p.pous.length}`;
});

// 6. POU create + body
await kase('WRITE: create a POU and write its body', async () => {
  await run('mw_code_pou_create', { name: 'MatrixProbe', template: 'TopCutterInitialize', dry_run: false });
  // Use only symbols the cloned template actually declares, so the linter is satisfied and
  // the case tests the WRITE path rather than the linter's (correct) refusal.
  const w = await run('mw_code_write_st', {
    pou: 'MatrixProbe',
    body: `(* matrix probe: body replaced, nothing added *)${NL}`,
    dry_run: false,
  });
  const back = await run('mw_code_read_st', { pou: 'MatrixProbe' });
  return `applied=${w.result?.applied} bodyLen=${(back.body ?? '').length}`;
});

// 7. POU delete (round trip)
await kase('WRITE: create then delete a POU', async () => {
  await run('mw_code_pou_create', { name: 'MatrixProbe', template: 'TopCutterInitialize', dry_run: false });
  const before = (await run('mw_code_pous')).pous.length;
  const d = await run('mw_code_pou_delete', { name: 'MatrixProbe', dry_run: false });
  const after = (await run('mw_code_pous')).pous.length;
  return `deleted=${!!d.result} ${before} -> ${after}`;
});

// 8. POU-scoped declaration, not used
await kase('WRITE: add a POU-scoped declaration (unused)', async () => {
  const w = await run('mw_code_var_add', {
    pou: 'TopCutterCamSetup', name: 'MatrixDecl', type: 'BOOL', section: 'VAR', dry_run: false,
  });
  const r = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  return `applied=${w.result?.applied} visible=${(r.variables ?? []).some((v) => v.name === 'MatrixDecl')}`;
});

// 9. POU-scoped declaration plus a body write
await kase('WRITE: POU declaration + unrelated body edit', async () => {
  await run('mw_code_var_add', {
    pou: 'TopCutterCamSetup', name: 'MatrixDecl2', type: 'BOOL', section: 'VAR', dry_run: false,
  });
  const r = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  const w = await run('mw_code_write_st', {
    pou: 'TopCutterCamSetup', body: r.body.replace(/\s+$/, '') + `${NL}(* matrix decl+body *)${NL}`, dry_run: false,
  });
  return `decl+body applied=${w.result?.applied}`;
});

// 10. POU-scoped declaration that is USED - the round-19 capability
await kase('WRITE: POU declaration that the body USES', async () => {
  const add = await run('mw_code_var_add', {
    pou: 'TopCutterCamSetup', name: 'MatrixUsed', type: 'BOOL',
    section: 'VAR', initial_value: 'FALSE', dry_run: false,
  });
  const r = await run('mw_code_read_st', { pou: 'TopCutterCamSetup' });
  const w = await run('mw_code_write_st', {
    pou: 'TopCutterCamSetup',
    body: r.body.replace(/\s+$/, '') + `${NL}(* uses the declared variable *)${NL}MatrixUsed := NOT MatrixUsed;${NL}`,
    dry_run: false,
  });
  return `declared=${add.result?.applied} used=${w.result?.applied}`;
});

// 11. export, both formats
await kase('READ: export a POU to a file', async () => {
  const e = await run('mw_code_export_pou', { pou: 'TopCutterCamSetup' });
  return `bytes=${e.bytes} lines=${e.lines} decls=${e.declarations}`;
});

console.log(`\n${'═'.repeat(96)}`);
console.log('  CAPABILITY MATRIX');
console.log('═'.repeat(96));
console.log(`  ${'operation'.padEnd(48)} ${'build'.padEnd(9)} real  setup`);
for (const r of results) {
  const ok = r.verdict === 'PASS' && r.real === 0;
  console.log(`  ${(ok ? 'PASS  ' : 'CHECK ') + r.label.slice(0, 41).padEnd(48)} `
    + `${r.verdict.padEnd(9)} ${String(r.real).padEnd(5)} ${String(r.prep).slice(0, 52)}`);
}
const passed = results.filter((r) => r.verdict === 'PASS' && r.real === 0).length;
console.log(`\n  ${passed} of ${results.length} operations compile cleanly end to end.`);
