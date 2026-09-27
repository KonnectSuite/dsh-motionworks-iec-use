/**
 * DOES THE 10-LINE INSTANCE BLOCK FIX THE TREE?
 *
 * The block was emitted as nine lines from the marker with no trailing blank, while a real
 * record on disk runs marker -> params -> ... -> trailing blank, which is ten. Inserting nine
 * left the following node with no separator, so it shifted up one line and its header lost
 * its level field - the recorded damage.
 *
 * Measured on a real project (task SlowTsk):
 *
 *     522 | '19'                 instance MARKER
 *     523 | '46 6 0 0'           instance params   <- the parser calls this .line
 *     ...
 *     530 | '0 0 0 ... 0'
 *     531 | ''                   trailing blank    <- and this .end_line
 *     532 | '20'                 next node
 *
 * A  TREE edit only with the 10-line block   -> does the tree survive OPEN?
 *  B  TREE edit only with the 9-line block    -> the old behaviour, control
 *  C  no assignment at all                    -> control, must stay clean
 *
 * Integrity is what is measured: a 10-line node block whose header line parses, and the
 * Start / Global_Variables / IO_Configuration nodes keeping their level fields.
 *
 * Run:  MW_PLUGIN=<installed> node test/assign_tenline.mjs
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

const POU = 'TskProbe';

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
            bad.append([i, l.strip()[:30], nm[:38]])
full = "\\n".join(lines)
print(json.dumps({"lines": len(lines), "malformed": len(bad), "examples": bad[:3],
  "start": "Start\\t0\\t0" in full,
  "globals": "Global_Variables\\t0\\t0" in full,
  "io": "IOCONFIG.CNF\\t0\\t0" in full,
  "hasPou": "${POU}" in full}))
`], { encoding: 'utf8' }).trim());
}

/** Assign via the engine directly, with the block length the caller chooses. */
function assign(tenLine) {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import tree_writer as TW

src = Path(r"${DIR}") / "src.st1"
text = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
doc = TW.parse_document(text)
plan = TW.plan_assign(doc, "SlowTsk", "${POU}")

if ${tenLine ? 'False' : 'True'}:
    # Reproduce the OLD nine-line block: drop the trailing separator.
    plan.instance_lines = plan.instance_lines[:-1]

rendered = TW.render(doc, plan)
CompoundFile(src).replace_streams({"PROJECT.TRE": rendered.encode("latin1")})
after = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1").splitlines()
print(json.dumps({"blockLines": len(plan.instance_lines), "before": len(text.splitlines()),
                  "after": len(after), "insertAt": plan.insert_at}))
`], { encoding: 'utf8' }).trim());
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
  console.log(`     after create : ${t0.lines}L malformed=${t0.malformed} pouInTree=${t0.hasPou}`);

  try { console.log(`     prepare      : ${JSON.stringify(await prepare())}`); }
  catch (e) { console.log(`     prepare THREW: ${e.message.split('\n')[0].slice(0, 110)}`); }
  const t1 = treeHealth();
  console.log(`     after edit   : ${t1.lines}L malformed=${t1.malformed}`);

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const t2 = treeHealth();
  const ok = t2.malformed === 0 && t2.start && t2.globals && t2.io;
  console.log(`     after OPEN   : ${t2.lines}L malformed=${t2.malformed} `
    + `Start=${t2.start ? 'Y' : 'N'} Globals=${t2.globals ? 'Y' : 'N'} IO=${t2.io ? 'Y' : 'N'}  `
    + `${ok ? 'INTACT' : '*** DAMAGED ***'}`);
  for (const ex of (t2.examples ?? [])) console.log(`        @${ex[0]}: ${ex[1]}  name=${ex[2]}`);

  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build        : is_compiled=${b.is_compiled} stalled=${b.stalled} real=${real.length}`);
  const tasks = await run('mw_code_tasks');
  const assigned = (tasks.tasks?.SlowTsk ?? []).includes(POU);
  console.log(`     assigned     : ${assigned}`);

  results.push({ label, malformed: t2.malformed, ok, compiled: b.is_compiled,
    stalled: !!b.stalled, real: real.length, assigned });
  await run('mw_ide_close');
}

await kase('A. assign with the 10-LINE block', () => assign(true));
await kase('B. assign with the 9-line block (old)', () => assign(false));
await kase('C. no assignment (control)', async () => 'nothing');

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
for (const r of results) {
  console.log(`  ${r.ok ? 'INTACT  ' : 'DAMAGED '} ${r.label.slice(0, 38).padEnd(40)} `
    + `malformed=${r.malformed} compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} `
    + `real=${r.real} assigned=${r.assigned}`);
}
const a = results.find((r) => r.label.startsWith('A'));
console.log('');
if (a?.ok && a.malformed === 0) {
  console.log('  *** THE 10-LINE BLOCK SURVIVES OPEN. *** The separator was the missing line.');
  if (a.assigned) console.log('  And the assignment persisted.');
} else if (a && !a.ok) {
  console.log('  still damaged - the block length is not the whole story.');
} else {
  console.log('  see the table above.');
}
