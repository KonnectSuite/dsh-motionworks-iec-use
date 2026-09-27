/**
 * ISOLATE the assignment: is it the TREE edit, the NODES.LST edit, or both?
 *
 * assign writes two things. Earlier work treated the pair as one operation and found the
 * IDE rewrites the tree at OPEN, costing Start, Global_Variables and IO_Configuration their
 * name lines. But the tree render itself was verified correct - 581 lines from 572, zero
 * malformed nodes, Start intact - and separately, NODES.LST alone leaves the tree untouched
 * and builds cleanly (though the IDE then discards the assignment).
 *
 * Round 12's lesson was that a combined failing run does not identify which part failed.
 * That applies here and was never applied. So:

 *   T  tree edit only            - add the instance node, leave NODES.LST alone
 *   N  NODES.LST only            - add the registry line, leave the tree alone
 *   B  both                      - what assign does today
 *
 * Tree integrity is what is being measured: a node block is 10 lines, and losing one makes
 * the header read `13 0 0 0` with a path where the name belongs.
 *
 * Run:  MW_PLUGIN=<installed> node test/assign_isolate.mjs
 */
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const RES_NODES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const ROOT_NODES = `${DIR}\\NODES.LST`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'IsoProbe';

function treeHealth() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = (CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1").splitlines()
bad = []
for i, l in enumerate(lines):
    head = l.split("\\t")[0].split()
    if len(head) == 4 and head[0].isdigit() and head[1].isdigit():
        nm = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in nm:
            bad.append([i, l.strip(), nm[:40]])
full = "\\n".join(lines)
print(json.dumps({
  "lines": len(lines), "malformed": len(bad), "examples": bad[:3],
  "start": "Start\\t0\\t0" in full,
  "globals": "Global_Variables\\t0\\t0" in full,
  "pouInTree": "${POU}" in full,
}))
`], { encoding: 'utf8' }).trim());
}

const nodesHasPou = () => {
  try { return readFileSync(RES_NODES, 'latin1').includes(POU); } catch { return false; }
};

/** Write the tree instance node without touching either NODES.LST. */
function treeOnly() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import tree_writer as TW
src = Path(r"${DIR}") / "src.st1"
cf = CompoundFile(src)
text = cf.read_stream("PROJECT.TRE").decode("latin1")
doc = TW.parse_document(text)
task = TW.find_task(doc, "SlowTsk")
plan = TW.plan_assign(doc, "SlowTsk", "${POU}")
rendered = TW.render(doc, plan)
cf.replace_streams({"PROJECT.TRE": rendered.encode("latin1")})
after = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1").splitlines()
print(json.dumps({"insert_at": plan.insert_at, "before": len(text.splitlines()), "after": len(after)}))
`], { encoding: 'utf8' }).trim());
}

/** Write the registry line only, leaving the tree alone. */
function nodesOnly() {
  const line = `PROGRAM\t6\t${POU}\t${POU}\teCLR\tMP2600iec`;
  const insert = (text) => {
    const rows = text.split(/\r?\n/);
    let at = -1;
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i].match(/^TASK\t\d+\t([^\t]+)\t/);
      if (m && m[1] === 'SlowTsk') at = i;
      if (at >= 0 && i > at && /^TASK\t/.test(rows[i])) { at = i; break; }
    }
    if (at < 0) throw new Error('SlowTsk not found');
    rows.splice(at, 0, line);
    return rows.join('\r\n');
  };
  const res = readFileSync(RES_NODES, 'latin1');
  const root = readFileSync(ROOT_NODES, 'latin1');
  require('node:fs').writeFileSync(RES_NODES, insert(res), 'latin1');
  require('node:fs').writeFileSync(ROOT_NODES, insert(root), 'latin1');
  return { wrote: 'both NODES.LST copies' };
}

const results = [];

async function kase(label, prepare) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${POU}`, { recursive: true, force: true }); } catch { /* absent */ }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');
  await run('mw_code_pou_create', { name: POU, template: 'TopCutterInitialize', dry_run: false });
  const t0 = treeHealth();
  console.log(`     after create : tree=${t0.lines}L malformed=${t0.malformed} pouInTree=${t0.pouInTree}`);

  try { console.log(`     prepare      : ${JSON.stringify(await prepare())}`); }
  catch (e) { console.log(`     prepare THREW: ${e.message.split('\n')[0].slice(0, 110)}`); }
  const t1 = treeHealth();
  console.log(`     after prepare: tree=${t1.lines}L malformed=${t1.malformed} nodesHasPou=${nodesHasPou()}`);

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const t2 = treeHealth();
  console.log(`     after OPEN   : tree=${t2.lines}L malformed=${t2.malformed} `
    + `Start=${t2.start ? 'Y' : 'N'} Globals=${t2.globals ? 'Y' : 'N'}`);
  for (const ex of (t2.examples ?? [])) console.log(`        malformed@${ex[0]}: ${ex[1]}  name=${ex[2]}`);
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build       : is_compiled=${b.is_compiled} stalled=${b.stalled} real=${real.length}`);
  const tasks = await run('mw_code_tasks');
  const assigned = (tasks.tasks?.SlowTsk ?? []).includes(POU);
  console.log(`     assigned    : ${assigned}`);
  results.push({ label, malformedBefore: t1.malformed, malformedAfter: t2.malformed,
    start: t2.start, globals: t2.globals, compiled: b.is_compiled, stalled: !!b.stalled,
    real: real.length, assigned });
  await run('mw_ide_close');
}

await kase('T. TREE edit only', () => treeOnly());
await kase('N. NODES.LST only', () => nodesOnly());
await kase('B. BOTH (what assign does)', async () => {
  const t = treeOnly();
  nodesOnly();
  return t;
});

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
console.log(`  ${'case'.padEnd(26)} ${'malformed'.padEnd(18)} Start Globals compiled assigned`);
for (const r of results) {
  console.log(`  ${r.label.padEnd(26)} ${`${r.malformedBefore} -> ${r.malformedAfter}`.padEnd(18)} `
    + `${r.start ? 'Y' : 'N'}     ${r.globals ? 'Y' : 'N'}       ${String(r.compiled).padEnd(8)} ${r.assigned}`);
}
const t = results.find((r) => r.label.startsWith('T'));
const n = results.find((r) => r.label.startsWith('N'));
console.log('');
if (t && t.malformedAfter === 0) {
  console.log('  The TREE edit alone leaves the tree intact - so the damage seen earlier came from');
  console.log('  the combination, not from the instance node this plugin writes.');
} else if (t) {
  console.log('  The TREE edit alone damages the tree - the instance block is what the IDE rejects.');
}
if (n && n.assigned) {
  console.log('  NODES.LST alone PERSISTED the assignment.');
} else if (n) {
  console.log('  NODES.LST alone did not persist, as before.');
}
