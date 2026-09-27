/**
 * Is the missing INITIAL VALUE what stalls a declaration?
 *
 * Round 13 separated two failure modes: a wrong .VGR record DESTROYS the POU, while a
 * declaration that is not in the grid merely STALLS the build with the POU intact. The
 * shipped tool does the second, which is safe but leaves a declared variable unusable.
 *
 * Looking again at the TEXT rather than the grid, the pristine .VB writes an initialiser on
 * every local scalar:
 *
 *     xGenerate :	BOOL := FALSE;      and its grid record carries init='FALSE'
 *     iState    :	INT  := 0;          and its grid record carries init='0'
 *     CamData   :	CamSegmentStruct;   struct, no initialiser, grid init=''
 *
 * and mw_code_var_add writes a bare declaration with no initialiser at all. If the compiler
 * builds a grid entry from the text when it has none, an initialiser-less local may be the
 * one thing standing between a declaration and a usable variable - which would make this
 * solvable without writing any binary at all.
 *
 *   J  declaration WITH initial_value, then USED in the body   -> ?
 *   K  declaration WITHOUT initial_value, then USED (control)  -> known to stall
 *   L  declaration WITH initial_value, not used                -> control
 *
 * Run:  MW_PLUGIN=<installed> node test/decl_initial_value.mjs
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
const results = [];

async function kase(label, varName, initialValue, useIt) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');

  const add = await run('mw_code_var_add', {
    pou: POU, name: varName, type: 'BOOL', section: 'VAR',
    ...(initialValue ? { initial_value: initialValue } : {}),
    dry_run: false,
  });
  const read = await run('mw_code_read_st', { pou: POU });
  const declared = (read.variables ?? []).find((v) => v.name === varName);
  console.log(`     declared: ${declared ? JSON.stringify(declared) : 'NOT FOUND'}  (applied=${add.result?.applied})`);
  // Show the raw text line, since that is what the compiler reads.
  const line = (read.body ? '' : '');
  if (declared) console.log(`     initial_value as the engine sees it: ${JSON.stringify(declared.initial_value)}`);

  if (useIt) {
    const body = read.body.replace(/\s+$/, '') + `${NL}(* uses it *)${NL}${varName} := NOT ${varName};${NL}`;
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

  const after = await run('mw_code_read_st', { pou: POU }).catch(() => null);
  let intact = null;
  try {
    const probe = await import('node:fs');
    const src = `${DIR}\\POE\\${POU}\\src.st1`;
    intact = probe.statSync(src).size;
  } catch { /* ignore */ }
  console.log(`     src.st1 after: ${intact} bytes`);

  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length, intact });
  await run('mw_ide_close');
}

await kase('J. WITH initial_value FALSE, then USED', 'ZZInitVal1', 'FALSE', true);
await kase('K. WITHOUT initial_value, then USED (control)', 'ZZInitVal2', null, true);
await kase('L. WITH initial_value FALSE, not used', 'ZZInitVal3', 'FALSE', false);

console.log(`\n${'═'.repeat(92)}`);
console.log('  RESULT');
console.log('═'.repeat(92));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 42).padEnd(44)} `
    + `compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real}`);
}
const j = results.find((r) => r.label.startsWith('J'));
console.log('');
if (j?.compiled === true && j.real === 0) {
  console.log('  *** THE INITIAL VALUE WAS THE MISSING PIECE. ***');
  console.log('  A declaration with an initialiser is USABLE with no binary surgery at all.');
} else if (j?.stalled) {
  console.log('  an initial value alone does not make the variable usable - the grid still governs.');
} else {
  console.log('  see the table above.');
}
