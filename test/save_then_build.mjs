/**
 * Does the IDE need to SAVE before it can compile a file-level edit correctly?
 *
 * The situation:
 *   - TopCutterCamSetup declares five VAR_EXTERNAL variables (TopCutterCamTableID,
 *     TopCutterCamReady, TopCutterCamError, TopCutterCamErrorID, TopCutterEyeToKnifeDistance)
 *     that have NO matching VAR_GLOBAL in the project
 *   - the pristine project nevertheless compiles cleanly, including a full rebuild
 *   - assign only edits NODES.LST, correctly, and all five tasks survive
 *   - and yet after an assign the build reports 125 "No matching global variable found"
 *     errors - exactly those unresolvable externals, for every POU that has them
 *
 * The likeliest explanation left: the plugin edits the project ON DISK while the IDE is
 * closed, and when the IDE reopens it holds a model that does not match the files. Its
 * compile then runs against an inconsistent view. If having the IDE SAVE the project
 * first reconciles the two, the errors go away and the fix is a save after every
 * file-level write.
 *
 * Run:  MW_PLUGIN=<installed> node test/save_then_build.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const { verb } = mod.__internals;
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const refs = (lines) => (lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;

async function build(label) {
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
  console.log(`  ${label}: is_compiled=${b.is_compiled} (${b.elapsed_s}s)  `
    + `Errors=${e.count} lines, ${refs(e.lines)} reference problems`);
  return { compiled: b.is_compiled, refs: refs(e.lines) };
}

line('1. fresh stage, create + assign (the sequence that breaks)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\SaveProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_code_pou_create', { name: 'SaveProbe', template: 'TopCutterInitialize', dry_run: false });
await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'SaveProbe', dry_run: false });
console.log('  created SaveProbe and assigned it to SlowTsk');

line('2. open and build - reproducing the failure');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const withoutSave = await build('build WITHOUT a save');

line('3. now SAVE the project through the IDE, then build again');
let saved = 'not attempted';
try {
  const r = await verb('save', {}, 180000);
  saved = JSON.stringify(r);
} catch (e) { saved = `FAILED: ${e.message.split('\n')[0]}`; }
console.log(`  save -> ${saved}`);
await new Promise((r) => setTimeout(r, 2000));
const withSave = await build('build AFTER a save');

line('VERDICT');
console.log(`  without save : compiled=${withoutSave.compiled}  reference problems=${withoutSave.refs}`);
console.log(`  after save   : compiled=${withSave.compiled}  reference problems=${withSave.refs}`);
if (withSave.refs === 0 && withoutSave.refs > 0) {
  console.log('\n  *** THE IDE NEEDS A SAVE. ***');
  console.log('  A file-level edit leaves the IDE model and the files disagreeing, and its');
  console.log('  compile then reports phantom unresolved externals. Saving reconciles them,');
  console.log('  so every file-level write should be followed by a save before building.');
} else if (withoutSave.refs === 0) {
  console.log('\n  this run did not reproduce the failure at all - inconclusive.');
} else {
  console.log('\n  a save does NOT fix it, so the disagreement is elsewhere.');
}
