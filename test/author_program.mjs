/**
 * AUTHOR A REAL PROGRAM, END TO END.
 *
 * Every capability this plugin has is verified separately. This does what a user actually asks
 * for - "write me a program that does X, and make it run" - as ONE sequence, and stops claiming
 * success the moment any step does not hold up.
 *
 *   A  create a POU
 *   B  write its declarations
 *   C  write a body THAT USES those declarations, so the build has to resolve them
 *   D  assign it to a task, through COM, so it actually runs and is compile-checked
 *   E  build clean
 *   F  confirm from the FILE, from the COM model, and from the IDE's own variable model
 *   G  unassign and delete, and confirm the project is back to where it started
 *
 * Step C is the one that matters most. A POU that is not assigned is never compiled, so a green
 * build says nothing about it - that was learned the hard way earlier in this project. And a body
 * that does not reference its declarations cannot fail to resolve them, so it proves nothing
 * either. The body here reads and writes the declarations, which is what makes the build a real
 * test of whether the declarations landed.
 *
 * Run:  MW_PLUGIN=<installed> node test/author_program.mjs
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

const POU = 'ZzAuthored';
const TASK = 'SlowTsk';

const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${String(detail ?? '').slice(0, 60)}`);
};

// ── fresh stage ──────────────────────────────────────────────────────────────────
try { await run('mw_ide_close'); } catch { /* not running */ }
for (let i = 0; i < 10; i++) {
  try {
    for (const p of [DIR, MWT]) rmSync(p, { recursive: true, force: true });
    break;
  } catch { await new Promise((r) => setTimeout(r, 1500)); }
}
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

const baseline = await run('mw_ide_build');
console.log(`\n  baseline build: is_compiled=${baseline.is_compiled}`);

// ── A. create ────────────────────────────────────────────────────────────────────
console.log('\n  ══ A. create a POU ══');
await run('mw_ide_close');
const made = await run('mw_code_pou_create', {
  name: POU, template: 'TopCutterCamSetup', dry_run: false,
});
step('the POU was created', made?.result?.created === true || made?.created === true,
  JSON.stringify(made?.result ?? made).slice(0, 55));
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

// ── B. declarations ──────────────────────────────────────────────────────────────
console.log('\n  ══ B. its declarations ══');
await run('mw_ide_close');
const decls = [
  { name: 'nCount', type: 'DINT', section: 'VAR', initial_value: '0' },
  { name: 'xCfgOk', type: 'BOOL', section: 'VAR', initial_value: 'FALSE' },
];
let declOk = true;
for (const d of decls) {
  const r = await run('mw_code_var_add', { pou: POU, ...d, dry_run: false });
  const applied = r?.result?.applied === true || r?.applied === true;
  if (!applied) declOk = false;
}
step('both declarations were written', declOk, decls.map((d) => d.name).join(', '));
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

const readBack = await run('mw_code_read_st', { pou: POU });
const found = (readBack.variables ?? []).map((d) => d.name);
step('they read back from the file', found.includes('nCount') && found.includes('xCfgOk'),
  found.join(', '));

// ── C. a body that USES them ─────────────────────────────────────────────────────
console.log('\n  ══ C. a body that uses them ══');
await run('mw_ide_close');
const BODY = [
  '(* Authored end to end by the agent, to prove the workflow rather than a piece of it. *)',
  'nCount := nCount + 1;',
  'IF nCount > 100 THEN',
  '    nCount := 0;',
  'END_IF;',
  'xCfgOk := nCount < 50;',
  '',
].join('\n');
const wrote = await run('mw_code_write_st', { pou: POU, body: BODY, dry_run: false });
step('the body was written', wrote?.result?.applied === true || wrote?.applied === true,
  JSON.stringify(wrote?.result ?? wrote).slice(0, 55));
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

// ── D. assign, so it actually runs ───────────────────────────────────────────────
console.log('\n  ══ D. assign it so it is compiled ══');
const assigned = await run('mw_code_pou_assign', { task: TASK, pou: POU, dry_run: false });
step('assigned through COM', assigned?.assigned === true, JSON.stringify(assigned).slice(0, 55));

// ── E. build ─────────────────────────────────────────────────────────────────────
console.log('\n  ══ E. build ══');
const built = await run('mw_ide_build');
step('compiles cleanly', built.is_compiled === true,
  `is_compiled=${built.is_compiled} stalled=${built.stalled}`);

// ── F. three independent confirmations ───────────────────────────────────────────
console.log('\n  ══ F. confirm from three places ══');
const fromTree = (await run('mw_code_tasks')).tasks?.[TASK] ?? [];
step('the TREE lists the assignment', fromTree.includes(POU), fromTree.join(', '));
const fromCom = ((await run('mw_code_task_model')).tasks?.[TASK]?.instances ?? []).map((i) => i.name);
step('the COM model lists it too', fromCom.includes(POU), fromCom.join(', '));
try {
  const live = await run('mw_ide_variables', { pou: POU });
  const txt = JSON.stringify(live);
  step('the IDE sees the declarations', txt.includes('nCount') && txt.includes('xCfgOk'),
    `${(live.pous?.[0]?.count ?? '?')} variables`);
} catch (e) {
  step('the IDE sees the declarations', false, String(e.message).slice(0, 50));
}

// ── G. clean up, and prove it ────────────────────────────────────────────────────
console.log('\n  ══ G. clean up ══');
const un = await run('mw_code_pou_unassign', { task: TASK, pou: POU, dry_run: false });
step('unassigned', un?.unassigned === true, JSON.stringify(un).slice(0, 50));
await run('mw_ide_close');
const del = await run('mw_code_pou_delete', { name: POU, dry_run: false });
step('deleted', del?.result?.deleted === true || del?.deleted === true,
  JSON.stringify(del?.result ?? del).slice(0, 50));
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const after = await run('mw_ide_build');
step('the project still compiles', after.is_compiled === true,
  `is_compiled=${after.is_compiled}`);
const finalTasks = await run('mw_code_tasks');
step('the assignment is gone', !(finalTasks.tasks?.[TASK] ?? []).includes(POU),
  (finalTasks.tasks?.[TASK] ?? []).join(', '));

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(92)}`);
console.log('  AUTHOR A PROGRAM - SUMMARY');
console.log('═'.repeat(92));
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - bad} of ${results.length} pass`);
if (bad === 0) {
  console.log('\n  A user can ask for a program and get one that RUNS: created, declared, written,');
  console.log('  assigned, compiled, confirmed three ways, and cleanly removed.');
}
