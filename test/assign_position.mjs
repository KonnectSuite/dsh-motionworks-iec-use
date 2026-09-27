/**
 * DOES THE INSTANCE GO BEFORE OR AFTER THE TASK'S EXISTING CHILDREN?
 *
 * The diff localised everything to the one generated node: the IDE keeps its marker ('19') and
 * the GUID this plugin wrote, and rebuilds the field layout around them - pulling CYCLIC and -1
 * out of the path line and onto the name line, adding a line, and zeroing the id line. Every
 * other byte of the tree is identical. So the node is PARSED and then not understood.
 *
 * plan_assign inserts at task.end_line, which is the end of the task's whole subtree, so the new
 * instance lands AFTER the existing children. Nothing has tested the other order. If the IDE
 * expects a task's instances in a particular sequence - or expects a new one adjacent to its
 * task rather than at the tail - the symptom would look exactly like this: neighbours fine, the
 * new node reinterpreted.
 *
 *   P1  insert BEFORE the task's existing children  (right after the task's own block)
 *   P2  insert AFTER  the task's existing children  (what the code does today)
 *   P3  no assignment                                (control, must stay clean)
 *
 * Run:  MW_PLUGIN=<installed> node test/assign_position.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'PosProbe';

function health() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = (CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1").splitlines()
bad = []
for i, l in enumerate(lines):
    f = l.split("\\t")[0].split()
    if len(f) == 4 and f[0].isdigit() and f[1].isdigit():
        nm = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in nm:
            bad.append(int(f[0]))
print(json.dumps({"lines": len(lines), "badIds": bad}))
`], { encoding: 'utf8' }).trim());
}

/** Assign, optionally placing the new node before the task's existing children. */
function assign(before) {
  const flag = before ? 'True' : 'False';
  return execFileSync(PY, ['-c', `
import sys, re
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import tree_writer as TW
src = Path(r"${DIR}") / "src.st1"
text = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
doc = TW.parse_document(text)
plan = TW.plan_assign(doc, "SlowTsk", "${POU}")
if ${flag}:
    # The task's own block is 9 lines from its marker; the first child starts right after it.
    task = TW.find_task(doc, "SlowTsk")
    first_child = min((k.line for k, c in doc.walk_with_ancestors() if c and c[-1] is task), default=None)
    if first_child is not None:
        plan.insert_at = first_child - 1        # the marker line of the first existing child
CompoundFile(src).replace_streams({"PROJECT.TRE": TW.render(doc, plan).encode("latin1")})
print(f"insert_at={plan.insert_at} block={len(plan.instance_lines)} lines")
`], { encoding: 'utf8' }).trim();
}

const results = [];

async function kase(label, prepare) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${POU}`, { recursive: true, force: true }); } catch { /* absent */ }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');
  try { console.log(`     ${await prepare()}`); }
  catch (e) { console.log(`     prepare THREW: ${e.message.split('\n')[0].slice(0, 120)}`); }
  const t1 = health();
  console.log(`     after edit: ${t1.lines}L badIds=${JSON.stringify(t1.badIds)}`);

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const t2 = health();
  const ok = t2.badIds.length === 0;
  console.log(`     after OPEN: ${t2.lines}L badIds=${JSON.stringify(t2.badIds)}  ${ok ? 'INTACT' : '*** DAMAGED ***'}`);
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} real=${real.length}`);
  results.push({ label, bad: t2.badIds.length, ok, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length });
  await run('mw_ide_close');
}

await kase('P1. insert BEFORE the task\'s existing children', async () => {
  await run('mw_code_pou_create', { name: POU, template: 'TopCutterInitialize', dry_run: false });
  await run('mw_ide_close');
  return assign(true);
});

await kase('P2. insert AFTER the task\'s existing children (today)', async () => {
  await run('mw_code_pou_create', { name: POU, template: 'TopCutterInitialize', dry_run: false });
  await run('mw_ide_close');
  return assign(false);
});

await kase('P3. no assignment (control)', async () => 'nothing');

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
for (const r of results) {
  console.log(`  ${r.ok ? 'INTACT ' : 'DAMAGED'} ${r.label.slice(0, 50).padEnd(52)} `
    + `badIds=${r.bad} compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real}`);
}
const p1 = results.find((r) => r.label.startsWith('P1'));
console.log('');
if (p1?.ok) {
  console.log('  *** POSITION WAS IT. *** Inserting before the existing children survives the open.');
} else {
  console.log('  position does not matter either - both orders are rebuilt by the IDE, so the');
  console.log('  node itself is what it cannot read.');
}
