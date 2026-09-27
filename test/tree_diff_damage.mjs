/**
 * WHAT EXACTLY DOES THE IDE CHANGE IN THE TREE?
 *
 * The damage is specific: three nodes - Start, Global_Variables, IO_Configuration - lose their
 * NAME line, so the line that follows the header is a PATH. All three sit after the inserted
 * instance block, which is the shape of a line shift, but only three of the many nodes after
 * the insert are affected, which is not.
 *
 * So stop theorising and diff. Three snapshots of the same tree:
 *
 *   P  the pristine staged tree, before any edit
 *   E  after the engine's splice, before the IDE has seen it
 *   O  after the IDE opens the project
 *
 * and, for each, the node blocks around the affected ids (13, 35, 40) plus a net line delta
 * and a count of how many nodes changed shape.
 *
 * Run:  MW_PLUGIN=<installed> node test/tree_diff_damage.mjs
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
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

const POU = 'DiffProbe';
const SNAP = `${PLUGIN}\\test\\_snapshots`;
mkdir(SNAP);

function mkdir(d) { try { execFileSync(PY, ['-c', `from pathlib import Path; Path(r"${d}").mkdir(parents=True, exist_ok=True)`]); } catch { /* exists */ } }

function dumpTree(label, out) {
  execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
lines = (CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1").splitlines()
Path(r"${out}").write_text("\\n".join(lines), encoding="utf-8")
print(json.dumps({"label": "${label}", "lines": len(lines)}))
`], { encoding: 'utf8' });
}

function analyse(label, path) {
  return JSON.parse(execFileSync(PY, ['-c', `
import json
from pathlib import Path
lines = Path(r"${path}").read_text(encoding="utf-8").splitlines()
# node = a header line 'id level kids flags' followed by a name line
nodes = []
for i, l in enumerate(lines):
    f = l.split("\\t")[0].split()
    if len(f) == 4 and f[0].isdigit() and f[1].isdigit():
        name = lines[i+1][:60] if i + 1 < len(lines) else ""
        nodes.append({"at": i, "id": int(f[0]), "level": int(f[1]), "kids": int(f[2]),
                      "name": name, "nameIsPath": "\\\\" in name})
byId = {n["id"]: n for n in nodes}
print(json.dumps({"label": "${label}", "lines": len(lines), "nodes": len(nodes),
  "pathNames": sum(1 for n in nodes if n["nameIsPath"]),
  "badIds": sorted(n["id"] for n in nodes if n["nameIsPath"]),
  "watch": {str(i): byId.get(i) for i in (13, 35, 40, 51, 52)}}))
`], { encoding: 'utf8' }).trim());
}

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${POU}`, { recursive: true, force: true }); } catch { /* absent */ }

mkdir(SNAP);
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');

const pristine = `${SNAP}\\pristine.tre`;
dumpTree('pristine', pristine);

// A POU has to exist before it can be assigned.
await run('mw_code_pou_create', { name: POU, template: 'TopCutterInitialize', dry_run: false });
await run('mw_ide_close');

const spliced = `${SNAP}\\spliced.tre`;
execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import tree_writer as TW
src = Path(r"${DIR}") / "src.st1"
text = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
doc = TW.parse_document(text)
plan = TW.plan_assign(doc, "SlowTsk", "${POU}")
rendered = TW.render(doc, plan)
CompoundFile(src).replace_streams({"PROJECT.TRE": rendered.encode("latin1")})
print("inserted", len(plan.instance_lines), "lines at", plan.insert_at)
`], { encoding: 'utf8' });
dumpTree('spliced', spliced);

await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const opened = `${SNAP}\\opened.tre`;
dumpTree('opened', opened);

console.log('\n  ── three snapshots');
for (const [label, path] of [['pristine', pristine], ['after splice', spliced], ['after OPEN', opened]]) {
  const a = analyse(label, path);
  console.log(`\n  ${a.label}: ${a.lines} lines, ${a.nodes} nodes, ${a.pathNames} nodes whose name is a path`);
  if (a.pathNames) console.log(`     affected ids: ${a.badIds.join(', ')}`);
  for (const [id, n] of Object.entries(a.watch)) {
    if (n) console.log(`     id ${id}: at ${n.at} level ${n.level} kids ${n.kids} name=${JSON.stringify(n.name)}${n.nameIsPath ? '   <== PATH' : ''}`);
  }
}

console.log('\n  ── line-level diff, spliced vs opened');
const d = execFileSync(PY, ['-c', `
import difflib
from pathlib import Path
a = Path(r"${spliced}").read_text(encoding="utf-8").splitlines()
b = Path(r"${opened}").read_text(encoding="utf-8").splitlines()
n = 0
for line in difflib.unified_diff(a, b, "spliced", "opened", lineterm="", n=1):
    print(line[:110])
    n += 1
    if n > 60:
        print("... (truncated)"); break
if n == 0:
    print("IDENTICAL")
`], { encoding: 'utf8' });
console.log(d);

await run('mw_ide_close').catch(() => {});
