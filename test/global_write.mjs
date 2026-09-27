/**
 * DOES WRITING TO A VAR_EXTERNAL GLOBAL STALL THE BUILD?
 *
 * Round 55's control established that the stall is caused by the BODY, in any POU - the IDE's own
 * TopCutterCamSetup stalls with the body I wrote and builds clean without it. That body is
 * type-correct, and it does exactly one notable thing: it WRITES to two VAR_EXTERNAL globals.
 *
 *    TopCutterCamReady   := NOT TopCutterCamReady;        a write
 *    TopCutterCamTableID := TopCutterCamTableID + 1;      a write
 *
 * Round 27 found two other faces of global trouble: adding a global can stall, and referencing a
 * global not declared VAR_EXTERNAL stalls with an empty Errors pane. This would be a third, and it
 * is the kind of rule a compiler should report rather than hang on.
 *
 * The test writes four bodies into the SAME IDE-created POU, one at a time, building after each.
 * Only the body changes:
 *
 *   1  read-only        : reads both globals into locals, writes nothing global
 *   2  write one        : assigns to a single BOOL global
 *   3  read and write   : the round-55 body, which is known to stall
 *   4  local only       : writes only a POU-local variable, no globals at all
 *
 * Run:  MW_PLUGIN=<installed> node test/global_write.mjs
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
const POU = 'TopCutterCamSetup';        // IDE-created, assigned to BG, known to build clean

const BODIES = [
  ['1. READ-ONLY', [
    '(* Reads both globals, writes neither. *)',
    'xSelect := TopCutterCamReady;',
    'iState := 1;',
    'IF TopCutterCamTableID > 100 THEN',
    '    iState := 2;',
    'END_IF;',
    '',
  ].join('\n')],

  ['2. WRITE ONE GLOBAL', [
    '(* Writes a single BOOL global, nothing else. *)',
    'TopCutterCamReady := TRUE;',
    '',
  ].join('\n')],

  ['3. READ AND WRITE  (the round-55 body)', [
    '(* Writes two globals. This is the body that stalled. *)',
    'TopCutterCamReady := NOT TopCutterCamReady;',
    'TopCutterCamTableID := TopCutterCamTableID + 1;',
    '',
  ].join('\n')],

  ['4. LOCAL ONLY', [
    '(* Writes only POU-local variables, no globals at all. *)',
    'xSelect := TRUE;',
    'iState := iState + 1;',
    '',
  ].join('\n')],
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

await fresh();
const baseline = await run('mw_ide_build');
console.log(`  baseline, untouched: is_compiled=${baseline.is_compiled}\n`);

for (const [label, body] of BODIES) {
  await fresh();                                  // clean project each time - no carry-over
  await run('mw_ide_close');
  let wrote = 'refused';
  try {
    const w = await run('mw_code_write_st', { pou: POU, body, dry_run: false, run_lint: true });
    wrote = (w.result ?? w).applied === true ? 'written' : 'not applied';
  } catch (e) {
    wrote = 'REFUSED: ' + String(e.message).split('\n')[1]?.trim().slice(0, 60);
  }
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const verdict = b.is_compiled === true ? 'CLEAN'
    : (b.stalled ? 'STALLED' : 'REJECTED');
  console.log(`  ${label.padEnd(36)} ${wrote.padEnd(10)} build=${verdict}`);
}

await run('mw_ide_close').catch(() => {});
