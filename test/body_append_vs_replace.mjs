/**
 * APPEND THE BODY, OR REPLACE IT - which one stalls?
 *
 * The capability matrix has passed "WRITE: POU declaration that the body USES" for many rounds. My
 * round-56 test C did the same thing into the same POU and STALLED. Reading both, the only
 * difference is what the body becomes:
 *
 *   matrix   r.body.replace(/\s+$/, '') + '...MatrixUsed := NOT MatrixUsed;'   APPENDS
 *   my test  a short body written from scratch                               REPLACES
 *
 * So this isolates exactly that. Four arms, same POU each time, fresh project each time, one
 * variable: whether the original body is kept.
 *
 *   1  ADD + APPEND to the inherited body      - what the matrix does
 *   2  ADD + REPLACE with a short body         - what I did
 *   3  NO ADD + APPEND (nothing else changes)  - control for the append itself
 *   4  NO ADD + REPLACE with a short local body - control for the replacement itself
 *
 * If 2 fails while 1 and 3 pass, the rule is that REPLACING the body of a POU that has an added
 * declaration stalls - which would be a sharper and stranger finding than "adds break clones".
 *
 * Run:  MW_PLUGIN=<installed> node test/body_append_vs_replace.mjs
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
const POU = 'TopCutterCamSetup';
const NL = '\n';

// A short body that touches only POU-local declarations.
const SHORT = [
  '(* Short body built from scratch, over POU-local declarations only. *)',
  'xSelect := NOT xSelect;',
  'iState := iState + 1;',
  'IF iState > 10 THEN',
  '    iState := 0;',
  'END_IF;',
  '',
].join(NL);

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

async function arm(label, { add, replace }) {
  await fresh();
  await run('mw_ide_close');
  if (add) {
    await run('mw_code_var_add', {
      pou: POU, name: 'nArm', type: 'BOOL', section: 'VAR', initial_value: 'FALSE', dry_run: false,
    });
  }
  const r = await run('mw_code_read_st', { pou: POU });
  const inherited = r.body ?? '';
  const body = replace
    ? (add ? SHORT + `nArm := NOT nArm;${NL}` : SHORT)
    : inherited.replace(/\s+$/, '') + NL + (add ? `nArm := NOT nArm;${NL}` : `xSelect := xSelect;${NL}`);
  let outcome;
  try {
    const w = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
    outcome = (w.result ?? w).applied === true ? 'written' : 'not applied';
  } catch (e) {
    outcome = 'REFUSED: ' + String(e.message).split('\n')[1]?.trim().slice(0, 46);
  }
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const verdict = b.is_compiled === true ? 'CLEAN' : (b.stalled ? 'STALLED' : 'REJECTED');
  console.log(`  ${label.padEnd(46)} ${outcome.padEnd(11)} ${verdict}`);
  return b.is_compiled === true;
}

console.log('  arm                                            write       build');
await arm('1  ADD + APPEND to the inherited body', { add: true, replace: false });
await arm('2  ADD + REPLACE with a short body', { add: true, replace: true });
await arm('3  no add + APPEND', { add: false, replace: false });
await arm('4  no add + REPLACE with a short body', { add: false, replace: true });

await run('mw_ide_close').catch(() => {});
