/**
 * AUTHOR A PROGRAM - THE WORKING PATH, END TO END.
 *
 * A user's most common request is "write me a program that does X". Round 39 tested that as one
 * sequence and scored 8 of 13. Thirteen rounds after it established exactly why: adding a
 * declaration to a created POU destroys it when it is compiled, while a created POU's INHERITED
 * declarations are perfectly usable. The complete elimination list is in SKILL.md.
 *
 * So the working path is:
 *
 *   A  create a POU from a template that already declares what the program needs
 *   B  write a body that USES THE INHERITED declarations - no var_add anywhere
 *   C  assign it, so it actually runs and is compile-checked
 *   D  build clean
 *   E  confirm from the tree, from the COM model, and from the IDE's own variable model
 *   F  unassign and delete, and confirm the project is where it started
 *
 * Step B is the one that matters. A body that does not reference its declarations cannot fail to
 * resolve them and so proves nothing; this body reads and writes the declarations the template
 * brought with it, which makes the build a real test.
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
const TEMPLATE = 'TopCutterCamSetup';   // declares 12 variables, usable as they come
const TASK = 'SlowTsk';

const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(50)} ${String(detail ?? '').slice(0, 60)}`);
};

async function reopen() {
  try { await run('mw_ide_close'); } catch { /* not running */ }
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
}

// ── fresh stage ──────────────────────────────────────────────────────────────────
try { await run('mw_ide_close'); } catch { /* not running */ }
for (let i = 0; i < 10; i++) {
  try {
    for (const p of [DIR, MWT]) rmSync(p, { recursive: true, force: true });
    break;
  } catch { await new Promise((r) => setTimeout(r, 1500)); }
}
await run('mw_ide_stage', { source: SOURCE });
await reopen();
const baseline = await run('mw_ide_build');
console.log(`\n  baseline build: is_compiled=${baseline.is_compiled}`);

// ── A. create ────────────────────────────────────────────────────────────────────
console.log('\n  ══ A. create a POU ══');
await run('mw_ide_close');
const made = await run('mw_code_pou_create', { name: POU, template: TEMPLATE, dry_run: false });
step('the POU was created', (made.result ?? made).pou === POU,
  JSON.stringify(made.result ?? made).slice(0, 54));
await reopen();

// ── B. its INHERITED declarations, and a body that uses them ─────────────────────
console.log('\n  ══ B. the declarations it inherited, and a body that uses them ══');
const before = await run('mw_code_read_st', { pou: POU });
const decls = before.variables ?? [];
step("it inherited the template's declarations", decls.length >= 10,
  `${decls.length}: ${decls.slice(0, 4).map((v) => v.name).join(', ')}...`);

// Use only names the POU actually declares, so the build has to resolve them all.
const writable = decls
  .filter((v) => /^(BOOL|UINT|DINT|INT|REAL|LREAL)$/i.test(String(v.type ?? '')))
  .map((v) => v.name);
console.log(`     usable declarations: ${writable.join(', ') || '(none)'}`);
if (writable.length < 2) {
  step('a body can be written against them', false, 'too few elementary declarations');
} else {
  const first = writable[0];
  const second = writable[1];
  const isBool = /BOOL/i.test(String(decls.find((v) => v.name === first)?.type));
  const BODY = [
    '(* Authored end to end through the plugin, using declarations inherited from the template. *)',
    `${first} := ${isBool ? 'TRUE' : '1'};`,
    `IF ${second} <> ${second} THEN`,
    `    ${second} := ${first};`,
    'END_IF;',
    '',
  ].join('\n');
  await run('mw_ide_close');
  const wrote = await run('mw_code_write_st', { pou: POU, body: BODY, dry_run: false });
  step('the body was written', (wrote.result ?? wrote).applied === true,
    JSON.stringify(wrote.result ?? wrote).slice(0, 54));
  await reopen();
  const after = await run('mw_code_read_st', { pou: POU });
  step('it survives the reopen', (after.variables ?? []).length === decls.length,
    `${(after.variables ?? []).length} declarations, body ${(after.body ?? '').length} chars`);
}

// ── C. assign, so it is compiled ─────────────────────────────────────────────────
console.log('\n  ══ C. assign it so it actually runs ══');
const assigned = await run('mw_code_pou_assign', { task: TASK, pou: POU, dry_run: false });
step('assigned through COM', assigned.assigned === true, JSON.stringify(assigned).slice(0, 54));

// ── D. build ─────────────────────────────────────────────────────────────────────
console.log('\n  ══ D. build ══');
const built = await run('mw_ide_build');
step('compiles cleanly', built.is_compiled === true,
  `is_compiled=${built.is_compiled} stalled=${built.stalled}`);

// ── E. three independent confirmations ───────────────────────────────────────────
console.log('\n  ══ E. confirm from three places ══');
const fromTree = (await run('mw_code_tasks')).tasks?.[TASK] ?? [];
step('the TREE lists the assignment', fromTree.includes(POU), fromTree.join(', '));
const fromCom = ((await run('mw_code_task_model')).tasks?.[TASK]?.instances ?? []).map((i) => i.name);
step('the COM model lists it too', fromCom.includes(POU), fromCom.join(', '));
try {
  const live = await run('mw_ide_variables', { pou: POU });
  const n = live.pous?.[0]?.count ?? 0;
  step('the IDE sees its declarations', n > 0, `${n} variables from the live model`);
} catch (e) { step('the IDE sees its declarations', false, String(e.message).slice(0, 50)); }

// ── F. clean up ──────────────────────────────────────────────────────────────────
console.log('\n  ══ F. clean up, and prove it ══');
const un = await run('mw_code_pou_unassign', { task: TASK, pou: POU, dry_run: false });
step('unassigned', un.unassigned === true, JSON.stringify(un).slice(0, 50));
await run('mw_ide_close');
const del = await run('mw_code_pou_delete', { name: POU, dry_run: false });
const went = (del.result ?? del).archived_to !== undefined || (del.result ?? del).deleted === true;
step('deleted', went, JSON.stringify(del.result ?? del).slice(0, 50));
await reopen();
const finalBuild = await run('mw_ide_build');
step('the project still compiles', finalBuild.is_compiled === true,
  `is_compiled=${finalBuild.is_compiled}`);
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
  console.log('\n  A user can ask for a program and get one that RUNS: created, written against its');
  console.log('  inherited declarations, assigned, compiled, confirmed three ways, and removed cleanly.');
}
