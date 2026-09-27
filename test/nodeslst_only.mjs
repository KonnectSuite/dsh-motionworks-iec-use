/**
 * Does the IDE build the TREE node from NODES.LST, or must I write both?
 *
 * mw_code_pou_assign writes two things:
 *   1. NODES.LST (both copies) - verified correct, 802 bytes, every task intact
 *   2. PROJECT.TRE - a 9-line instance block inserted at the task's end_line
 *
 * Only (2) is suspect. A dedicated control proved the IDE leaves a pristine tree alone
 * (573 lines / 57 nodes before open, after open, after close), so the rewrite is provoked
 * by the inserted block specifically - the IDE re-serialises it and shifts every following
 * node by a line, costing Start, Global_Variables and IO_Configuration their name lines.
 *
 * NODES.LST already names every task and program, and the tree is a rendering of the same
 * structure. So the question worth asking: if only NODES.LST is updated and the tree is
 * left completely alone, does the IDE add the instance node itself when it opens?
 *
 * Run:  MW_PLUGIN=<installed> node test/nodeslst_only.mjs
 */
import { existsSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const TREE = `${DIR}\\src.st1`;
const RES_NODES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const ROOT_NODES = `${DIR}\\NODES.LST`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

/** tree integrity + whether the new POU appears in it */
function treeState(needle) {
  const out = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = CompoundFile(Path(r"${DIR}") / "src.st1").read_stream("PROJECT.TRE").decode("latin1").splitlines()
bad = 0
for i, l in enumerate(lines):
    head = l.split("\\t")[0].split()
    if len(head) == 4 and head[0].isdigit() and head[1].isdigit():
        nm = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in nm:
            bad += 1
print(json.dumps({"lines": len(lines), "malformed": bad, "has_new": ${JSON.stringify(needle)} in "\\n".join(lines)}))
`], { encoding: 'utf8' }).trim();
  return JSON.parse(out);
}

const nodesState = () => {
  const t = readFileSync(RES_NODES, 'latin1');
  return { bytes: statSync(RES_NODES).size, hasNew: t.includes('NodesOnlyProbe'), globals: t.includes('VAR_GLOBALS'), start: t.includes('Start') };
};

function observe(label) {
  const t = treeState('NodesOnlyProbe');
  const n = nodesState();
  console.log(`  ${label.padEnd(32)} tree=${String(t.lines).padStart(3)}L malformed=${t.malformed} newInTree=${t.has_new ? 'Y' : 'N'}`
    + `  | NODES=${String(n.bytes).padStart(4)}B new=${n.hasNew ? 'Y' : 'N'} VAR_GLOBALS=${n.globals ? 'Y' : 'N'}`);
  return { t, n };
}

line('1. fresh stage + create the POU (tree must gain the POU nodes; that part is proven)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\NodesOnlyProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'NodesOnlyProbe', template: 'TopCutterInitialize', dry_run: false });
observe('after create');

line('2. write NODES.LST ONLY - do not touch the tree at all');
const treeBefore = readFileSync(TREE);
const resBefore = readFileSync(RES_NODES, 'latin1');
const rootBefore = readFileSync(ROOT_NODES, 'latin1');

// Build the NODES.LST lines the same way the writer does, but skip the tree edit.
const newLine = 'PROGRAM\t6\tNodesOnlyProbe\tNodesOnlyProbe\teCLR\tMP2600iec';
function insertAfterTask(text, taskName, line_) {
  const rows = text.split(/\r?\n/);
  let taskAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^TASK\t\d+\t([^\t]+)\t/);
    if (m && m[1] === taskName) taskAt = i;
    // stop at the next TASK so we insert at the end of this task's program list
    if (taskAt >= 0 && i > taskAt && /^TASK\t/.test(rows[i])) { taskAt = i; break; }
  }
  if (taskAt < 0) throw new Error(`task ${taskName} not found`);
  rows.splice(taskAt, 0, line_);
  return rows.join('\r\n');
}

writeFileSync(RES_NODES, insertAfterTask(resBefore, 'SlowTsk', newLine), 'latin1');
writeFileSync(ROOT_NODES, insertAfterTask(rootBefore, 'SlowTsk', newLine), 'latin1');
console.log(`  NODES.LST written (tree left byte-identical: ${readFileSync(TREE).equals(treeBefore)})`);
observe('after NODES.LST-only write');

line('3. OPEN and see whether the IDE adds the instance node itself');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
observe('after open');

line('4. build');
const b = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)  `
  + `Errors=${e.count} lines, ${refs} reference problems`);
observe('after build');

line('VERDICT');
const last = treeState('NodesOnlyProbe');
if (last.malformed === 0 && b.is_compiled === true) {
  console.log('  *** NODES.LST IS ENOUGH. ***');
  console.log('  Updating only the registry leaves the tree readable and the project builds,');
  console.log('  so the tree edit is what was provoking the IDE rewrite all along.');
} else if (last.malformed === 0) {
  console.log('  tree stayed clean but the build failed - check the Errors pane above.');
} else {
  console.log('  the tree still got damaged, so NODES.LST alone is not the mechanism either.');
}
