/**
 * WHEN does the resource NODES.LST get truncated?
 *
 * Facts established:
 *   - straight after mw_code_pou_assign the file is 806 bytes and contains SaveProbe,
 *     TASK Start, PROGRAM TopCutterInitialize, VAR_GLOBALS and IO/CONFIGURATION
 *   - after opening the IDE and building, the file is 499 bytes and has lost the last
 *     six lines - INCLUDING VAR_GLOBALS, which is why Global_Variables never compiles
 *     and every POU's externals fail with "No matching global variable found"
 *
 * So something between the assign and the end of the build rewrites the file. This
 * records the size and content of BOTH NODES.LST copies after every single step, so the
 * step that does it is named rather than inferred.
 *
 * Run:  MW_PLUGIN=<installed> node test/when_truncated.mjs
 */
import { existsSync, rmSync, readFileSync, statSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const RES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const ROOT = `${DIR}\\NODES.LST`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const KEY = ['VAR_GLOBALS', 'IO/CONFIGURATION', 'Start', 'TopCutterInitialize', 'StepProbe'];
const seen = [];

function observe(label) {
  const rows = [];
  for (const [name, p] of [['resource', RES], ['root', ROOT]]) {
    let size = -1; let text = '';
    try { size = statSync(p).size; text = readFileSync(p, 'latin1'); } catch { /* missing */ }
    const flags = KEY.map((k) => (text.includes(k) ? k : `-${k}`)).join(' ');
    rows.push(`${name}=${String(size).padStart(4)}B  ${flags}`);
  }
  const r = rows.join('\n                    ');
  console.log(`  ${label.padEnd(26)} ${r}`);
  seen.push({ label, rows });
}

console.log('  step                       NODES.LST state');
console.log('  ' + '─'.repeat(84));

// 1. fresh stage
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\StepProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
observe('1. after stage');

await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'StepProbe', template: 'TopCutterInitialize', dry_run: false });
observe('2. after create');

await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'StepProbe', dry_run: false });
observe('3. after ASSIGN');

await run('mw_ide_start');
observe('4. after start_ide');

await run('mw_ide_open', { path: MWT });
observe('5. after open');

const b = await run('mw_ide_build');
observe(`6. after BUILD (compiled=${b.is_compiled})`);

const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
console.log(`  Errors pane: ${e.count} lines, ${refs} reference problems`);

try { await mod.__internals.verb('save', {}, 120000); observe('7. after SAVE'); }
catch (err) { console.log(`  save failed: ${err.message.split('\n')[0]}`); }

console.log('\n  VERDICT');
const stages = seen.map((s) => ({ label: s.label, res: s.rows[0] }));
const firstLoss = stages.find((s) => s.res.includes('-VAR_GLOBALS'));
if (!firstLoss) {
  console.log('  VAR_GLOBALS never disappeared in this run.');
} else {
  console.log(`  VAR_GLOBALS is first MISSING at: ${firstLoss.label}`);
  console.log('  that is the step that truncates the file.');
}
