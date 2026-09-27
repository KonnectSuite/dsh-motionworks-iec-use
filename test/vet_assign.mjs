/**
 * VET mw_code_pou_assign on a PRISTINE project.
 *
 * The first attempt at this ran on a project that had already been through several
 * other operations, and the tree came out damaged: the `Start` task vanished and the
 * inserted instance block was malformed. That could be the assign itself or an
 * interaction with earlier edits, so test it from clean.
 *
 * Run:  MW_PLUGIN=<installed> node test/vet_assign.mjs
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const MWT = `${STAGE}\\TopCutter.mwt`;
const DIR = `${STAGE}\\TopCutter`;
const line = (s) => console.log(`\n${'â•'.repeat(76)}\n  ${s}\n${'â•'.repeat(76)}`);

const CANDIDATES = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
];
const SOURCE = CANDIDATES.find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine TopCutter source found'); process.exit(2); }
console.log('source: ' + SOURCE);
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;

/** The task map straight from the tree, via the engine. */
function treeTasks() {
  const script = `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.tree import load_tree, task_assignments
from pathlib import Path
roots = load_tree(Path(r"${DIR}"))[0]
print(json.dumps(task_assignments(roots), sort_keys=True))
`;
  return JSON.parse(execFileSync(PY, ['-c', script], { encoding: 'utf8' }).trim());
}

line('1. fresh stage from the pristine baseline');
// The IDE holds the project open, so its files are locked: close it before clearing
// the stage directory or the removal fails with EPERM.
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, `${STAGE}\\TopCutter.mwt`]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\AssignPou`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
const tasksBefore = treeTasks();
console.log(`  tasks before: ${JSON.stringify(tasksBefore)}`);
const expectedTasks = Object.keys(tasksBefore).length;

line('2. create a POU and assign it to a task');
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'AssignPou', template: 'TopCutterInitialize', dry_run: false });
console.log('  created AssignPou');
try {
  const r = await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'AssignPou', dry_run: false });
  console.log(`  assign: ${JSON.stringify(r.result).slice(0, 160)}`);
} catch (e) {
  console.log(`  assign THREW: ${e.message.split('\n')[0]}`);
}

line('3. inspect the tree afterwards');
const tasksAfter = treeTasks();
console.log(`  tasks after : ${JSON.stringify(tasksAfter)}`);
const lostTasks = Object.keys(tasksBefore).filter((t) => !(t in tasksAfter));
const lostPrograms = Object.entries(tasksBefore)
  .flatMap(([t, ps]) => ps.map((p) => `${t}:${p}`))
  .filter((pair) => {
    const [t, p] = pair.split(':');
    return !(tasksAfter[t] ?? []).includes(p);
  });
console.log(`  tasks lost      : ${lostTasks.length ? lostTasks.join(', ') : '(none)'}`);
console.log(`  assignments lost: ${lostPrograms.length ? lostPrograms.join(', ') : '(none)'}`);
const gained = (tasksAfter.SlowTsk ?? []).includes('AssignPou');
console.log(`  AssignPou now on SlowTsk: ${gained}`);

line('4. can the project still open and compile?');
try { await run('mw_ide_start'); } catch (e) { console.log(`  start: ${e.message}`); }
let opens = false;
try { await run('mw_ide_open', { path: MWT }); opens = true; console.log('  open : OK'); }
catch (e) { console.log(`  open : FAILED â€” ${e.message.split('\n')[0]}`); }
if (opens) {
  try {
    const b = await run('mw_ide_build');
    console.log(`  build: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
  } catch (e) { console.log(`  build: THREW ${e.message.split('\n')[0]}`); }
}

line('VERDICT');
const clean = lostTasks.length === 0 && lostPrograms.length === 0 && gained && opens;
console.log(clean
  ? `  CLEAN â€” ${expectedTasks} tasks preserved, AssignPou added, project opens.`
  : '  NOT CLEAN â€” see the losses above; assign is damaging the task structure.');
