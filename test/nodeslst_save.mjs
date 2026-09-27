/**
 * Does an IDE SAVE turn a NODES.LST-only assignment into a real one?
 *
 * Established:
 *   - writing ONLY NODES.LST (leaving the tree untouched) avoids all damage
 *   - the IDE then reads it, compiles the new POU, compiles Global_Variables, and builds
 *     the instance tree - a full clean build, is_compiled=true
 *   - but it also writes NODES.LST back WITHOUT the new entry, so the assignment is gone
 *     afterwards and the tree never gains an instance node
 *
 * A build is not a save. The IDE holds a model; only a save writes it out. So the
 * sequence worth testing is NODES.LST-only, open, SAVE, and then look at whether the IDE
 * itself materialises the instance node in the tree and keeps the registry entry.
 *
 * If it does, the plugin's assignment becomes: write the registry, save, and let
 * MotionWorks generate the tree - which is exactly the surgery that keeps failing when
 * done by hand.
 *
 * Run:  MW_PLUGIN=<installed> node test/nodeslst_save.mjs
 */
import { existsSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
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
const RES_NODES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const ROOT_NODES = `${DIR}\\NODES.LST`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'SaveAssignProbe';

function state(label) {
  const t = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
full = (CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1")
lines = full.splitlines()
bad = 0
for i, l in enumerate(lines):
    head = l.split("\\t")[0].split()
    if len(head) == 4 and head[0].isdigit() and head[1].isdigit():
        nm = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in nm:
            bad += 1
# an instance node is a level-6 node whose parent chain is a task
inst = full.count("${POU}") 
print(json.dumps({"lines": len(lines), "malformed": bad, "mentions": inst}))
`], { encoding: 'utf8' }).trim();
  const ts = JSON.parse(t);
  const nodes = readFileSync(RES_NODES, 'latin1');
  // Is it under a TASK (an instance) or only under Logical POUs (just the POU)?
  const rows = nodes.split(/\r?\n/);
  let taskParent = null;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^TASK\t\d+\t([^\t]+)\t/);
    if (m) taskParent = m[1];
    if (rows[i].includes(POU)) { /* found under taskParent */ }
  }
  const assigned = /^PROGRAM\t\d+\t(POU)\t/m.test(nodes.split(/\r?\n/).join('\n')) && nodes.includes(`PROGRAM\t6\t${POU}\t`);
  console.log(`  ${label.padEnd(30)} tree=${String(ts.lines).padStart(3)}L malformed=${ts.malformed} mentions=${ts.mentions}`
    + `  | NODES=${String(statSync(RES_NODES).size).padStart(4)}B assigned=${assigned ? 'Y' : 'N'}`);
  return { ts, assigned, bytes: statSync(RES_NODES).size };
}

line('1. fresh stage + create the POU');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${POU}`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_close');
await run('mw_code_pou_create', { name: POU, template: 'TopCutterInitialize', dry_run: false });
state('after create');

line('2. write NODES.LST only');
const newLine = `PROGRAM\t6\t${POU}\t${POU}\teCLR\tMP2600iec`;
function insertAfterTask(text, taskName, line_) {
  const rows = text.split(/\r?\n/);
  let at = -1;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^TASK\t\d+\t([^\t]+)\t/);
    if (m && m[1] === taskName) at = i;
    if (at >= 0 && i > at && /^TASK\t/.test(rows[i])) { at = i; break; }
  }
  if (at < 0) throw new Error(`task ${taskName} not found`);
  rows.splice(at, 0, line_);
  return rows.join('\r\n');
}
writeFileSync(RES_NODES, insertAfterTask(readFileSync(RES_NODES, 'latin1'), 'SlowTsk', newLine), 'latin1');
writeFileSync(ROOT_NODES, insertAfterTask(readFileSync(ROOT_NODES, 'latin1'), 'SlowTsk', newLine), 'latin1');
state('after NODES.LST-only write');

line('3. open, then SAVE through the IDE');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
state('after open');
let saveResult = 'not attempted';
try { saveResult = JSON.stringify(await verb('save', {}, 180000)); } catch (e) { saveResult = `FAILED: ${e.message.split('\n')[0]}`; }
console.log(`  save -> ${saveResult}`);
await new Promise((r) => setTimeout(r, 2500));
const afterSave = state('after IDE SAVE');

line('4. build, then check whether it persisted');
const b = await run('mw_ide_build');
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
const afterBuild = state('after build');

line('VERDICT');
if (afterSave.assigned && afterBuild.assigned) {
  console.log('  *** AN IDE SAVE MATERIALISES THE ASSIGNMENT. ***');
  console.log('  Writing NODES.LST and saving makes the IDE create the instance node itself,');
  console.log('  which is the tree surgery that keeps failing when done by hand.');
} else if (afterSave.ts.malformed === 0 && b.is_compiled === true && !afterBuild.assigned) {
  console.log('  clean build, but the assignment is still discarded.');
  console.log('  So the registry alone is enough to BUILD a program once, not to keep it.');
} else {
  console.log('  see the states above.');
}
