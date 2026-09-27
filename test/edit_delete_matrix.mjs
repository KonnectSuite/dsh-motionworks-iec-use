/**
 * EVERY EDIT / ADD / DELETE, ON A CREATED POU AND ON AN EXISTING ONE.
 *
 * Round 60 guarded mw_code_var_add: adding a declaration to a POU this plugin created stalls the
 * build, 28 of 29 runs. But var_add is only one of three mutation tools, and the other two have
 * never been tried on a created POU:
 *
 *   mw_code_var_edit    renames or retypes an existing declaration
 *   mw_code_var_delete  removes one
 *
 * The capability matrix exercises both - on an EXISTING POU only - and passes. Whether they stall a
 * CREATED POU is unmeasured, and if they do, an agent can break its project through a tool that
 * still reports success. So: three runs each, on both kinds of POU, with a build after every one.
 *
 *   I  created POU,  edit an inherited declaration,   build
 *   J  created POU,  delete an inherited declaration, build
 *   K  existing POU, edit a declaration,              build   - the matrix's case, re-measured
 *   L  existing POU, delete a declaration,            build
 *
 * If I or J stalls, the guard added in round 60 has to cover those tools too.
 *
 * Run:  MW_PLUGIN=<installed> node test/edit_delete_matrix.mjs
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
const RUNS = Number(process.env.MW_RUNS ?? 3);

// A POU-local declaration that exists in the template and that no body depends on.
const VICTIM = 'xGenerate';
const RENAMED = 'xGenerateRenamed';

async function fresh() {
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
}

async function arm(kind, created, n) {
  const pou = created ? `ZzM${kind[0]}${n}` : TEMPLATE;
  try {
    await fresh();
    await run('mw_ide_close');
    if (created) {
      await run('mw_code_pou_create', { name: pou, template: TEMPLATE, dry_run: false });
      await run('mw_ide_start');
      await run('mw_ide_open', { path: MWT });
      await run('mw_ide_close');
    }
    let mutated;
    if (kind === 'edit') {
      const e = await run('mw_code_var_edit', {
        pou, name: VICTIM, new_name: RENAMED, dry_run: false,
      });
      mutated = (e.result ?? e).applied === true ? 'edited' : 'not applied';
    } else {
      const d = await run('mw_code_var_delete', { pou, name: VICTIM, dry_run: false });
      mutated = (d.result ?? d).applied === true ? 'deleted' : 'not applied';
    }
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    if (created) await run('mw_code_pou_assign', { task: TASK, pou, dry_run: false });
    const b = await run('mw_ide_build');
    const verdict = b.is_compiled === true ? 'CLEAN' : (b.stalled ? 'STALLED' : 'REJECTED');
    return { mutated, verdict };
  } catch (e) {
    return { mutated: 'ERROR', verdict: 'ERROR: ' + String(e.message).split('\n')[0].slice(0, 40) };
  }
}

const ARMS = [
  ['I  created POU,  edit', 'edit', true],
  ['J  created POU,  delete', 'delete', true],
  ['K  existing POU, edit', 'edit', false],
  ['L  existing POU, delete', 'delete', false],
];

console.log(`  ${RUNS} runs per arm, build after every one\n`);
const summary = [];
for (const [label, kind, created] of ARMS) {
  const outcomes = [];
  let mutated = '?';
  for (let n = 1; n <= RUNS; n += 1) {
    const r = await arm(kind, created, n);
    mutated = r.mutated;
    outcomes.push(r.verdict);
  }
  const clean = outcomes.filter((o) => o === 'CLEAN').length;
  summary.push({ label, mutated, clean, outcomes });
  console.log(`  ${label.padEnd(28)} ${mutated.padEnd(12)} ${clean} clean / ${RUNS - clean} not`
    + `   [${outcomes.join(' ')}]`);
}

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(92)}`);
for (const s of summary) {
  const verdict = s.clean === RUNS ? 'safe' : (s.clean === 0 ? 'ALWAYS STALLS' : 'MIXED');
  console.log(`  ${verdict.padEnd(14)} ${s.label}`);
}
const createdBad = summary.slice(0, 2).filter((s) => s.clean < RUNS);
const existingBad = summary.slice(2).filter((s) => s.clean < RUNS);
if (createdBad.length) {
  console.log(`\n  ${createdBad.map((s) => s.label.trim()).join(' and ')} stall a CREATED POU.`);
  console.log('  The round-60 guard covers var_add only and must be extended to these.');
} else {
  console.log('\n  Neither edit nor delete stalls a created POU. Round 60\'s guard is correctly');
  console.log('  scoped to var_add alone, and nothing further is needed.');
}
if (existingBad.length) {
  console.log(`\n  NOTE: ${existingBad.map((s) => s.label.trim()).join(', ')} also failed on an`);
  console.log('  EXISTING POU, which the matrix reports as passing - worth reconciling.');
}
