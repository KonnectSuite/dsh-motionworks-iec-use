/**
 * THE ONE LEAD: does it matter whether the body uses anything BESIDES the added declaration?
 *
 * Round 58 measured 14 stalls out of 15 - every kind of reference to an added declaration, both
 * types. One earlier run had built clean, and it is the only lead left:
 *
 *   round 56, arm 2   add a BOOL, then a body that assigned it AND read two INHERITED locals
 *                     -> CLEAN
 *
 *   round 58, all arms  a body that used the added declaration and NOTHING ELSE
 *                     -> STALLED, 14 of 15
 *
 * So this varies exactly that, three runs each:
 *
 *   F  added declaration alone        nB := NOT nB;
 *   G  added declaration + inherited  nB := NOT nB; xSelect := NOT xSelect; iState := iState + 1;
 *   H  inherited only, added UNUSED   xSelect := NOT xSelect; iState := iState + 1;
 *
 * H is the control that matters most. If a POU with an added declaration that the body never
 * mentions stalls, then the declaration's mere presence is enough and the whole "reference" framing
 * collapses. If H is clean and F stalls, the rule is about using it. If H and G are both clean and
 * only F stalls, round 56's lead is real and the workaround is usable: keep using the inherited
 * declarations alongside the new one.
 *
 * Run:  MW_PLUGIN=<installed> node test/added_decl_lead.mjs
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

// xSelect and iState are plain VARs in the template. No VAR_EXTERNAL name appears in any body here.
const INHERITED = 'xSelect := NOT xSelect;\niState := iState + 1;';

const VARIANTS = [
  ['F  added declaration alone', `nB := NOT nB;\n`],
  ['G  added + inherited locals', `nB := NOT nB;\n${INHERITED}\n`],
  ['H  inherited only, added UNUSED', `${INHERITED}\n`],
];

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

async function once(tag, bodyStatement, n) {
  const pou = `ZzL${tag}${n}`;
  try {
    await fresh();
    await run('mw_ide_close');
    await run('mw_code_pou_create', { name: pou, template: TEMPLATE, dry_run: false });
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_ide_close');
    await run('mw_code_var_add', {
      pou, name: 'nB', type: 'BOOL', section: 'VAR', initial_value: 'FALSE', dry_run: false,
    });
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_ide_close');
    try {
      await run('mw_code_write_st', { pou, body: `(* ${tag} run ${n} *)\n${bodyStatement}`, dry_run: false });
    } catch { return 'REFUSED'; }
    await run('mw_ide_start');
    await run('mw_ide_open', { path: MWT });
    await run('mw_code_pou_assign', { task: TASK, pou, dry_run: false });
    const b = await run('mw_ide_build');
    return b.is_compiled === true ? 'CLEAN' : (b.stalled ? 'STALLED' : 'REJECTED');
  } catch {
    return 'ERROR';
  }
}

console.log(`  ${RUNS} runs per variant\n`);
const summary = [];
for (const [label, statement] of VARIANTS) {
  const outcomes = [];
  for (let n = 1; n <= RUNS; n += 1) outcomes.push(await once(label[0], statement, n));
  const clean = outcomes.filter((o) => o === 'CLEAN').length;
  summary.push({ label, statement: statement.replace(/\n/g, ' ').trim(), clean,
    stalled: outcomes.filter((o) => o === 'STALLED').length, outcomes });
  console.log(`  ${label.padEnd(32)} ${summary.at(-1).clean} clean / ${summary.at(-1).stalled} stalled`
    + `   [${outcomes.join(' ')}]`);
}

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(96)}`);
for (const s of summary) {
  const verdict = s.stalled === 0 ? 'safe' : (s.clean === 0 ? 'ALWAYS STALLS' : 'MIXED');
  console.log(`  ${verdict.padEnd(14)} ${s.label}`);
}
const F = summary[0]; const G = summary[1]; const H = summary[2];
console.log(`\n  F (added only)      ${F.clean} clean`);
console.log(`  G (added+inherited) ${G.clean} clean`);
console.log(`  H (added UNUSED)    ${H.clean} clean`);
if (H.clean === RUNS && F.clean === 0) {
  console.log('\n  The declaration being PRESENT is fine; USING it is what stalls.');
} else if (H.clean === 0) {
  console.log('\n  An added declaration stalls the POU even when the body never mentions it -');
  console.log('  the "reference" framing is wrong and the declaration itself is the problem.');
} else if (G.clean === RUNS && F.clean === 0) {
  console.log('\n  Round 56\'s lead is real: using the added declaration ALONGSIDE inherited ones');
  console.log('  compiles, while using it alone does not. That is a usable workaround.');
} else {
  console.log('\n  Mixed - the rates above are the only thing worth quoting.');
}
