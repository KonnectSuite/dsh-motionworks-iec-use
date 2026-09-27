/**
 * THE ASSIGNMENT, END TO END, THROUGH THE TOOLS.
 *
 * For seventeen rounds mw_code_pou_assign refused, because both directions of editing PROJECT.TRE
 * by hand damaged the project: an insert let it open and then rewrote three nodes, a removal
 * stopped it opening at all. The refusal was right. The supported API simply had not been found.
 *
 * It has now:
 *
 *   task.ProgramInstances.Create(instance, type)   then   Save()
 *
 * and the IDE writes the tree itself. This exercises the whole thing the way an agent would:
 *
 *   A  read the tasks both ways, and confirm the two agree BEFORE anything changes
 *   B  dry_run an assignment - it must change nothing
 *   C  assign a POU that exists, then confirm BOTH readers see it
 *   D  build - an assignment the compiler cannot use is worth nothing
 *   E  unassign, confirm both readers agree again, and build
 *   F  a bad call reports a reason instead of corrupting anything
 *
 * Run:  MW_PLUGIN=<installed> node test/assign_e2e.mjs
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

const TASK = 'SlowTsk';
// A POU that is ALREADY assigned cannot be assigned again - to the same task the IDE answers
// "ProgramInstance already exists", and to a different task it answers "Internal error in
// 'Create (internal creation process)'", because a program instance is a single running instance
// and cannot be in two tasks at once. So the test makes its own program, which is also the real
// workflow: create a POU, assign it, write its code.
const POU = 'ZzAssignProbe';
const inst = (r) => (r.tasks?.[TASK]?.instances ?? []).map((i) => i.name);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(46)} ${String(detail).slice(0, 70)}`);
};

async function bothReaders() {
  const com = await run('mw_code_task_model');
  const tree = await run('mw_code_tasks');
  return { com: inst(com), tree: tree.tasks?.[TASK] ?? [] };
}

// ── stage and open ───────────────────────────────────────────────────────────────
// The IDE holds an open handle on the staged project, so closing it is not enough on its own -
// the delete that mw_ide_stage does first fails with EPERM until the handle is released.
try { await run('mw_ide_close'); } catch { /* not running */ }
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    for (const p of [DIR, `${DIR}.mwt`]) rmSync(p, { recursive: true, force: true });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_close');
await run('mw_ide_start');
await run('mw_ide_open', { path: `${DIR}.mwt` });

console.log('\n  ══ A. the two readers, before anything changes ══');
let a = await bothReaders();
console.log(`     COM : ${JSON.stringify(a.com)}`);
console.log(`     TREE: ${JSON.stringify(a.tree)}`);
check('both readers agree at the start', JSON.stringify(a.com) === JSON.stringify(a.tree),
  a.com.join(', '));

console.log('\n  ══ B. dry_run must change nothing ══');
const dry = await run('mw_code_pou_assign', { task: TASK, pou: POU });
let b = await bothReaders();
check('dry_run reported a plan', dry.dry_run === true, JSON.stringify(dry.currently_assigned ?? []));
check('dry_run changed nothing', JSON.stringify(b.com) === JSON.stringify(a.com),
  JSON.stringify(b.com));

console.log('\n  ══ C. assign, and confirm BOTH readers see it ══');
// Create the program first, then assign it - the workflow an agent would actually follow.
const made = await run('mw_code_pou_create', { name: POU, template: 'TopCutterCamSetup', dry_run: false });
console.log(`     created ${POU}: ${JSON.stringify(made).slice(0, 100)}`);
try { await run('mw_ide_close'); } catch { /* needs the IDE closed to write */ }
await run('mw_ide_start');
await run('mw_ide_open', { path: `${DIR}.mwt` });
const assigned = await run('mw_code_pou_assign', { task: TASK, pou: POU, dry_run: false });
console.log(`     result: ${JSON.stringify(assigned).slice(0, 150)}`);
let c = await bothReaders();
check('the COM reader sees the assignment', c.com.includes(POU), JSON.stringify(c.com));
check('the TREE reader sees it too', c.tree.includes(POU), JSON.stringify(c.tree));
check('the two still agree', JSON.stringify(c.com) === JSON.stringify(c.tree), '');

console.log('\n  ══ D. build - an unusable assignment is worth nothing ══');
const built = await run('mw_ide_build');
check('the project still compiles', built.is_compiled === true,
  `is_compiled=${built.is_compiled} stalled=${built.stalled}`);

console.log('\n  ══ E. assigning the same program twice must be refused, not duplicated ══');
let twice = null;
try {
  twice = await run('mw_code_pou_assign', { task: TASK, pou: POU, dry_run: false });
} catch (e) { twice = { error: String(e.message).split('\n')[0] }; }
const e = await bothReaders();
check('a duplicate assignment is rejected', JSON.stringify(e.com) === JSON.stringify(c.com),
  (twice.error ?? JSON.stringify(twice)).slice(0, 60));

console.log('\n  ══ F. unassign, and rebuild ══');
const un = await run('mw_code_pou_unassign', { task: TASK, pou: POU, dry_run: false });
console.log(`     result: ${JSON.stringify(un).slice(0, 150)}`);
let f = await bothReaders();
check('COM no longer lists it', !f.com.includes(POU), JSON.stringify(f.com));
check('the TREE no longer lists it', !f.tree.includes(POU), JSON.stringify(f.tree));
check('back to the starting state', JSON.stringify(f.com) === JSON.stringify(a.com), '');
const built2 = await run('mw_ide_build');
check('still compiles after unassign', built2.is_compiled === true,
  `is_compiled=${built2.is_compiled} stalled=${built2.stalled}`);

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(88)}`);
console.log('  SUMMARY');
console.log('═'.repeat(88));
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - bad} of ${results.length} pass`);
