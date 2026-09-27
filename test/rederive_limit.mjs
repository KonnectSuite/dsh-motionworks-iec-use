/**
 * RE-DERIVING THE CREATE-THEN-DECLARE LIMITATION.
 *
 * Round 44 added a warning to mw_code_pou_create saying that ADDING A DECLARATION to a created POU
 * breaks it, and named that as the tool's limitation. Round 55 showed why that conclusion was
 * unsound: the test it came from wrote a body that READS A GLOBAL, and reading a VAR_EXTERNAL global
 * stalls the build in ANY POU - including the IDE's own TopCutterCamSetup, which stalled with the
 * same body and builds clean without it.
 *
 * So the warning may be steering agents away from a feature that works. It has to be re-derived with
 * a body that touches no global, and removed if the feature is sound. That is this file's job.
 *
 * The template declares both kinds:
 *
 *   VAR_EXTERNAL   TopCutterCamTableID, TopCutterCamReady, TopCutterCamError, TopCutterCamErrorID
 *   VAR (local)    fbCamGen, fbCamSelect, CamData, CamTable, xGenerate, xSelect, iState,
 *                  TopCutterEyeToKnifeDistance
 *
 * and the bodies below use ONLY the local ones, so nothing here reads a global.
 *
 *   A  clone, no change, body over locals, assign, build      - the control
 *   B  clone, ONE ADDED DECLARATION, body over locals AND the new one, assign, build
 *   C  the same as B but into the IDE's own POU, for comparison
 *
 * If B compiles, the warning is wrong and comes out of the tool description.
 *
 * Run:  MW_PLUGIN=<installed> node test/rederive_limit.mjs
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

// A body over LOCAL declarations ONLY. xSelect and iState are plain VARs in the template.
// TopCutterEyeToKnifeDistance was in the first version of this body and is VAR_EXTERNAL - it is a
// GLOBAL, which is why arm A stalled and why this file exists.
const LOCAL_BODY = [
  '(* Uses only POU-local declarations - no global is read or written. *)',
  'xSelect := NOT xSelect;',
  'iState := iState + 1;',
  'IF iState > 10 THEN',
  '    iState := 0;',
  'END_IF;',
  '',
].join('\n');

const WITH_NEW = [
  '(* The same, plus the declaration added after creation. *)',
  'nAdded := nAdded + 1;',
  'xSelect := NOT xSelect;',
  'iState := iState + 1;',
  'IF nAdded > 10 THEN',
  '    nAdded := 0;',
  'END_IF;',
  '',
].join('\n');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${String(detail ?? '').slice(0, 56)}`);
};

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

async function writeBody(pou, body) {
  await run('mw_ide_close');
  let outcome;
  try {
    const w = await run('mw_code_write_st', { pou, body, dry_run: false });
    outcome = (w.result ?? w).applied === true ? 'written' : 'not applied';
  } catch (e) {
    outcome = 'REFUSED: ' + String(e.message).split('\n')[1]?.trim().slice(0, 50);
  }
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  return outcome;
}

// ── A. the control: a clone, its own body, no declaration added ──────────────────
console.log('\n  ══ A. clone, body over locals, no declaration added ══');
await fresh();
await run('mw_code_pou_create', { name: 'ZzA56', template: TEMPLATE, dry_run: false });
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
console.log(`     ${await writeBody('ZzA56', LOCAL_BODY)}`);
await run('mw_code_pou_assign', { task: TASK, pou: 'ZzA56', dry_run: false });
let b = await run('mw_ide_build');
check('A: clone + local body compiles', b.is_compiled === true,
  `is_compiled=${b.is_compiled} stalled=${b.stalled}`);

// ── B. THE QUESTION: a clone, ONE ADDED DECLARATION, a body that uses it ─────────
console.log('\n  ══ B. clone, ONE ADDED DECLARATION, body over locals AND the new one ══');
await fresh();
await run('mw_code_pou_create', { name: 'ZzB56', template: TEMPLATE, dry_run: false });
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
await run('mw_ide_close');
const added = await run('mw_code_var_add', {
  pou: 'ZzB56', name: 'nAdded', type: 'DINT', section: 'VAR', initial_value: '0', dry_run: false,
});
check('B: the declaration was added', (added.result ?? added).applied === true,
  JSON.stringify(added.result ?? added).slice(0, 50));
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
console.log(`     ${await writeBody('ZzB56', WITH_NEW)}`);
const reread = await run('mw_code_read_st', { pou: 'ZzB56' });
check('B: the declaration is still there', (reread.variables ?? []).some((v) => v.name === 'nAdded'),
  `${(reread.variables ?? []).length} declarations`);
await run('mw_code_pou_assign', { task: TASK, pou: 'ZzB56', dry_run: false });
b = await run('mw_ide_build');
check('*** B: clone + added declaration compiles ***', b.is_compiled === true,
  `is_compiled=${b.is_compiled} stalled=${b.stalled}`);

// ── C. the same add into the IDE's own POU, for comparison ───────────────────────
console.log("\n  ══ C. the same declaration added to the IDE's OWN POU ══");
await fresh();
await run('mw_ide_close');
const added2 = await run('mw_code_var_add', {
  pou: TEMPLATE, name: 'nAdded', type: 'DINT', section: 'VAR', initial_value: '0', dry_run: false,
});
check('C: the declaration was added', (added2.result ?? added2).applied === true, '');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
console.log(`     ${await writeBody(TEMPLATE, WITH_NEW)}`);
b = await run('mw_ide_build');
check('C: the IDE POU with the added declaration compiles', b.is_compiled === true,
  `is_compiled=${b.is_compiled} stalled=${b.stalled}`);

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(90)}`);
const bad = results.filter((r) => !r.ok).length;
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
console.log(`\n  ${results.length - bad} of ${results.length} pass`);
const bOK = results.find((r) => r.name.includes('B: clone + added declaration'));
if (bOK?.ok) {
  console.log('\n  THE WARNING IS WRONG. A created POU accepts an added declaration and compiles.');
  console.log('  The round-44 limitation must be removed from mw_code_pou_create.');
} else {
  console.log('\n  The warning stands: a created POU still fails with an added declaration,');
  console.log('  even with a body that touches no global.');
}
