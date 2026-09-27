/**
 * WHY does the build stall? Check for a blocking modal dialog.
 *
 * The build reports is_compiled=false with is_modified stuck true and an EMPTY Errors pane.
 * A compiler that never finishes and never complains is odd. One explanation fits both
 * facts: it is waiting on a modal dialog - and the bridge already knows how to find those,
 * because an unlicensed build shows one before the IDE has a window of its own.
 *
 * While a modal dialog is up the frame is DISABLED and the COM API reports nothing, which
 * is exactly the shape of "is_modified stays true, no errors, never settles".
 *
 * So: add a declaration, start the build, and poll the IDE's dialog state WHILE it runs.
 *
 * Run:  MW_PLUGIN=<installed> node test/stall_diagnosis.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const { verb } = mod.__internals;
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const HELPER = `${PLUGIN}\\test\\declaration_helper.py`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';

line('1. fresh stage, create the POU change (helper bypasses the shipped refusal)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
const added = JSON.parse(execFileSync(PY, [HELPER, 'add', DIR, POU, 'ZZStallProbe'], { encoding: 'utf8' }).trim());
const last = (added.records ?? []).slice(-1)[0];
console.log(`  added: ${JSON.stringify(last)}`);
console.log(`  grid: count=${added.grid_count} parsed=${added.grid_parsed}`);

line('2. open, then start the build WITHOUT waiting, and poll the IDE while it runs');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

// Kick the build off but do not await it to completion: poll alongside it instead.
const buildPromise = run('mw_ide_build').catch((e) => ({ error: e.message }));

for (let i = 0; i < 14; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  let state = 'n/a';
  let dialog = 'n/a';
  let cs = 'n/a';
  try { state = JSON.stringify(await verb('ide_state', {}, 15000)).slice(0, 150); } catch (e) { state = `ERR ${e.message.split('\n')[0].slice(0, 60)}`; }
  try { dialog = JSON.stringify(await verb('answer_dialog', { answer: null }, 15000)).slice(0, 150); } catch (e) { dialog = `ERR ${e.message.split('\n')[0].slice(0, 60)}`; }
  try { cs = JSON.stringify(await verb('compile_state', {}, 15000)); } catch (e) { cs = `ERR ${e.message.split('\n')[0].slice(0, 60)}`; }
  console.log(`\n  t+${(i + 1) * 6}s`);
  console.log(`    compile_state : ${cs}`);
  console.log(`    ide_state     : ${state}`);
  console.log(`    dialog        : ${dialog}`);
  if (/dialog_present":true/.test(dialog) || /"is_up":true/.test(dialog)) {
    console.log('    *** A MODAL DIALOG IS UP ***');
  }
}

line('3. the build result');
const b = await buildPromise;
console.log(`  ${JSON.stringify(b).slice(0, 260)}`);

line('4. and what the IDE looks like now');
try { console.log(`  ${JSON.stringify(await verb('ide_state', {}, 20000)).slice(0, 300)}`); } catch (e) { console.log(`  ${e.message}`); }
