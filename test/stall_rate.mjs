/**
 * HOW OFTEN DOES IT ACTUALLY STALL? Five identical runs, one variable: nothing.
 *
 * Four rounds have produced findings that do not agree. The same operation - create a POU from a
 * template, add a declaration, write a body that uses it, assign, build - has stalled twice and
 * built clean twice, on the same POU and the same project. Each of those was a single run, and
 * each was reported as if it settled something. It did not.
 *
 * A defect that appears in half the runs is not measured by one arm. This runs the identical
 * sequence five times, with no variation at all between runs except the POU name, and records the
 * outcome of each. The number that matters is the stall RATE.
 *
 *   run N: fresh stage, create ZzR{N}, reopen, add one DINT, reopen, write a body using it,
 *          assign to SlowTsk, build
 *
 * Everything is written down per run - the add's before/after byte counts, whether the declaration
 * reads back, the .VB size before and after the build - so a run that stalls can be compared
 * against a run that does not, instead of being argued about.
 *
 * Run:  MW_PLUGIN=<installed> node test/stall_rate.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const TEMPLATE = 'TopCutterCamSetup';
const TASK = 'SlowTsk';
const RUNS = Number(process.env.MW_RUNS ?? 5);

// Never varies between runs. Touches only the new declaration and POU-local variables.
const BODY = [
  '(* Fixed body: the added declaration and two POU-local variables. No globals. *)',
  'nVar := nVar + 1;',
  'xSelect := NOT xSelect;',
  'IF nVar > 10 THEN',
  '    nVar := 0;',
  'END_IF;',
  '',
].join('\n');

async function fresh() {
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (let i = 0; i < 10; i++) {
    try {
      for (const p of [DIR, MWT]) rmSync(p, { recursive: true, force: true });
      break;
    } catch { await new Promise((r) => setTimeout(r, 1500)); }
  }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
}

const rows = [];
console.log(`  running the identical sequence ${RUNS} times\n`);
console.log('  run  create  add           decls  write      build      .VB after');

for (let n = 1; n <= RUNS; n += 1) {
  const pou = `ZzR${n}`;
  const notes = {};
  try {
    await fresh();

    await run('mw_ide_close');
    const made = await run('mw_code_pou_create', { name: pou, template: TEMPLATE, dry_run: false });
    notes.create = (made.result ?? made).pou === pou ? 'ok' : 'FAIL';

    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_ide_close');
    const add = await run('mw_code_var_add', {
      pou, name: 'nVar', type: 'DINT', section: 'VAR', initial_value: '0', dry_run: false,
    });
    const ar = add.result ?? add;
    notes.add = ar.applied ? `${ar.before_bytes}->${ar.after_bytes}` : 'FAILED';

    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    const read = await run('mw_code_read_st', { pou });
    notes.decls = (read.variables ?? []).length;

    await run('mw_ide_close');
    try {
      const w = await run('mw_code_write_st', { pou, body: BODY, dry_run: false });
      notes.write = (w.result ?? w).applied === true ? 'written' : 'no';
    } catch (e) {
      notes.write = 'REFUSED';
    }

    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    const asg = await run('mw_code_pou_assign', { task: TASK, pou, dry_run: false });
    const b = await run('mw_ide_build');
    notes.build = b.is_compiled === true ? 'CLEAN' : (b.stalled ? 'STALLED' : 'REJECTED');
    notes.assigned = asg.assigned === true ? 'ok' : 'FAIL';

    // how big is the POU now - a destroyed one reads 0 bytes
    try {
      const r2 = await run('mw_code_read_st', { pou });
      notes.vb = (r2.body ?? '').length;
    } catch { notes.vb = '?'; }
  } catch (e) {
    notes.build = notes.build ?? ('ERROR: ' + String(e.message).split('\n')[0].slice(0, 40));
  }

  rows.push({ n, ...notes });
  console.log(`  ${String(n).padStart(3)}  ${String(notes.create ?? '-').padEnd(6)}  `
    + `${String(notes.add ?? '-').padEnd(12)}  ${String(notes.decls ?? '-').padEnd(5)}  `
    + `${String(notes.write ?? '-').padEnd(9)}  ${String(notes.build ?? '-').padEnd(9)}  `
    + `${notes.vb ?? '-'}`);
}

await run('mw_ide_close').catch(() => {});

const stalls = rows.filter((r) => r.build === 'STALLED').length;
const clean = rows.filter((r) => r.build === 'CLEAN').length;
console.log(`\n${'═'.repeat(84)}`);
console.log(`  ${clean} clean, ${stalls} stalled, ${rows.length - clean - stalls} other, out of ${rows.length}`);
console.log('═'.repeat(84));
if (clean === rows.length) {
  console.log('\n  It does not reproduce at all under a fixed body. Whatever stalled in rounds 40-56 was');
  console.log('  caused by something that varies between tests, not by creation or by the add.');
} else if (stalls === rows.length) {
  console.log('\n  It reproduces every time. The sequence is genuinely broken and the variation in');
  console.log('  earlier rounds came from the tests, not the defect.');
} else {
  console.log('\n  IT IS INTERMITTENT. Chasing it with single runs is what produced four findings that');
  console.log('  do not agree; the rate above is the only number worth quoting from these rounds.');
}
