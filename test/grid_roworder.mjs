/**
 * Does the ROW ORDER of the grid records explain the POU destruction?
 *
 * Every previous attempt appended the new record at the END. This one places it where its
 * row belongs. Both write the same record content - only the position differs - so if one
 * compiles and the other destroys the POU, position is the answer.
 *
 *   R1  record inserted IN ROW ORDER, then the variable is USED   -> ?
 *   R2  record appended AT THE END (the old behaviour), USED      -> control, expected bad
 *   R3  record inserted IN ROW ORDER, variable NOT used           -> control
 *
 * Run:  MW_PLUGIN=<installed> node test/grid_roworder.mjs
 */
import { existsSync, rmSync, statSync } from 'node:fs';
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
const HELPER = `${PLUGIN}\\test\\grid_roworder.py`;
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const results = [];

function sizes() {
  try { return statSync(`${DIR}\\POE\\${POU}\\src.st1`).size; } catch { return -1; }
}

async function kase(label, extraArg, useIt) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');

  const before = sizes();
  let note = '';
  try {
    note = execFileSync(PY, [HELPER, DIR, POU, 'ZZRowProbe', ...(extraArg ? [extraArg] : [])],
      { encoding: 'utf8' }).trim().split('\n').pop().trim();
  } catch (e) { note = `HELPER FAILED: ${String(e.message).split('\n')[0].slice(0, 110)}`; }
  console.log(`     ${note}`);
  console.log(`     src.st1 before=${before} after-edit=${sizes()}`);

  if (useIt) {
    const r = await run('mw_code_read_st', { pou: POU });
    const body = r.body.replace(/\s+$/, '') + `${NL}(* uses it *)${NL}ZZRowProbe := NOT ZZRowProbe;${NL}`;
    await run('mw_code_write_st', { pou: POU, body, dry_run: false });
    console.log('     body uses it');
  }

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching|undeclared/i.test(l));
  const after = sizes();
  const survived = after === before;
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 3)) console.log(`       ${l}`);
  console.log(`     src.st1 after=${after}  ${survived ? 'POU INTACT' : '*** POU DESTROYED ***'}`);

  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length, survived, after });
  await run('mw_ide_close');
}

await kase('R1. record IN ROW ORDER, then USED', null, true);
await kase('R2. record AT THE END, then USED (old behaviour)', '--at-end', true);
await kase('R3. record IN ROW ORDER, NOT used', null, false);

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 48).padEnd(50)} `
    + `compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} `
    + `real=${r.real} ${r.survived ? 'intact' : 'DESTROYED'}`);
}
const r1 = results.find((r) => r.label.startsWith('R1'));
const r2 = results.find((r) => r.label.startsWith('R2'));
console.log('');
if (r1?.compiled === true && r1.real === 0) {
  console.log('  *** ROW ORDER WAS THE ANSWER. ***');
  console.log('  The same record content compiles when placed where its row belongs, so a');
  console.log('  declaration can be declared AND used with no IDE step at all.');
} else if (r1 && !r1.survived) {
  console.log('  row order does not save it - the record is still rejected, and still destructively.');
} else if (r1?.stalled && r2 && !r2.survived) {
  console.log('  row order changes the failure MODE: stalled-and-intact instead of destroyed.');
  console.log('  That is progress - the record is closer - but the variable is still not usable.');
} else {
  console.log('  see the table above.');
}
