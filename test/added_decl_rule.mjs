/**
 * THE EXACT RULE: which use of an added declaration stalls?
 *
 * Round 57 established that the sequence is deterministic - 5 of 5 stalls - and gave this contrast:
 *
 *   create, ADD a declaration and use it in a comparison     STALLED
 *   create, ADD a declaration and only ASSIGN it             CLEAN
 *
 * But the capability matrix has passed "a declaration that the body USES" for many rounds, with
 *   MatrixUsed := NOT MatrixUsed;      a BOOL, read and written on one line
 * while round 57's body was
 *   nVar := nVar + 1;  IF nVar > 10    a DINT, read in an arithmetic expression and a comparison
 *
 * So two things differ at once - the TYPE and the KIND of use - and either could be the trigger.
 * This separates them, and applies round 57's method: THREE runs per variant, because a single run
 * is what produced four findings that did not agree.
 *
 *   A  BOOL, assign only        nB := TRUE;
 *   B  BOOL, read + write       nB := NOT nB;
 *   C  DINT, assign only        nD := 1;
 *   D  DINT, read + write       nD := nD + 1;
 *   E  DINT, comparison only    IF nD > 10 THEN xSelect := TRUE; END_IF;
 *
 * Anything that stalls is reported with its rate over the three runs. That is the number worth
 * quoting.
 *
 * Run:  MW_PLUGIN=<installed> node test/added_decl_rule.mjs
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

const VARIANTS = [
  ['A  BOOL, assign only', 'BOOL', 'nB := TRUE;'],
  ['B  BOOL, read + write', 'BOOL', 'nB := NOT nB;'],
  ['C  DINT, assign only', 'DINT', 'nD := 1;'],
  ['D  DINT, read + write', 'DINT', 'nD := nD + 1;'],
  ['E  DINT, comparison only', 'DINT', 'IF nD > 10 THEN\n    xSelect := TRUE;\nEND_IF;'],
];

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

async function once(label, type, statement, n) {
  const name = type === 'BOOL' ? 'nB' : 'nD';
  const pou = `ZzV${label[0]}${n}`;
  try {
    await fresh();
    await run('mw_ide_close');
    await run('mw_code_pou_create', { name: pou, template: TEMPLATE, dry_run: false });
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_ide_close');
    await run('mw_code_var_add', {
      pou, name, type, section: 'VAR', initial_value: '0', dry_run: false,
    });
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_ide_close');
    const body = `(* variant ${label} *)\n${statement}\n`;
    try {
      await run('mw_code_write_st', { pou, body, dry_run: false });
    } catch { return 'REFUSED'; }
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_code_pou_assign', { task: TASK, pou, dry_run: false });
    const b = await run('mw_ide_build');
    return b.is_compiled === true ? 'CLEAN' : (b.stalled ? 'STALLED' : 'REJECTED');
  } catch (e) {
    return 'ERROR';
  }
}

console.log(`  ${RUNS} runs per variant, identical except the statement\n`);
const summary = [];
for (const [label, type, statement] of VARIANTS) {
  const outcomes = [];
  for (let n = 1; n <= RUNS; n += 1) outcomes.push(await once(label, type, statement, n));
  const clean = outcomes.filter((o) => o === 'CLEAN').length;
  const stalled = outcomes.filter((o) => o === 'STALLED').length;
  summary.push({ label, statement: statement.replace(/\n/g, ' '), clean, stalled, outcomes });
  console.log(`  ${label.padEnd(28)} ${String(statement.replace(/\n/g, ' ')).padEnd(40)} `
    + `${clean} clean / ${stalled} stalled   [${outcomes.join(' ')}]`);
}

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(104)}`);
console.log('  THE RULE');
console.log('═'.repeat(104));
for (const s of summary) {
  const verdict = s.stalled === 0 ? 'safe' : (s.clean === 0 ? 'ALWAYS STALLS' : 'flaky');
  console.log(`  ${verdict.padEnd(14)} ${s.label.padEnd(28)} ${s.statement}`);
}
