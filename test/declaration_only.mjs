/**
 * ISOLATION: add a DECLARATION and change nothing else.
 *
 * test/body_only.mjs proved a body write is clean on its own (baseline, identical rewrite
 * and a comment edit all compiled, each reaching "Building instance tree"). Every test
 * that added a variable ALSO edited the body, so this separates them the other way: add
 * one declaration - .VB text plus the now-correct .VGR record - and touch nothing else.
 *
 * This decides what the plugin should do about declarations. If it fails, mw_code_var_add
 * is producing a project that stalls the build, which is the worst possible outcome for a
 * tool an agent is meant to trust, and it should refuse instead of writing. If it passes,
 * the earlier failures were some interaction with the body write and the path is fine.
 *
 * Run:  MW_PLUGIN=<installed> node test/declaration_only.mjs
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
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';

async function buildAndReport(label) {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
  const inst = (bp.lines ?? []).some((l) => /Building instance tree/.test(l));
  const stale = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`  ${label.padEnd(34)} is_compiled=${String(b.is_compiled).padEnd(5)} (${b.elapsed_s}s)  `
    + `Errors=${e.count} realProblems=${stale.length} instanceTree=${inst}`);
  for (const l of stale.slice(0, 3)) console.log(`      ${l}`);
  await run('mw_ide_close');
  return { compiled: b.is_compiled, real: stale.length, inst };
}

/** Does the POU's declaration stream and grid agree, and is the grid still parseable? */
function grids() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json, struct
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import variables as V
from motionworks_iec_mcp.project import Project
from pathlib import Path
pou = Project(root=Path(r"${DIR}")).pou("${POU}")
cf = CompoundFile(pou.source_path)
names = cf.stream_names()
vg = next(n for n in names if n.upper().endswith("V.VGR"))
vb = next(n for n in names if n.upper().endswith("V.VB"))
raw = cf.read_stream(vg)
recs = V.parse_grid_records(raw)
names_decoded = []
for r in recs:
    try:
        names_decoded.append(V.read_grid_record(raw, r["offset"])["name"])
    except Exception as e:
        names_decoded.append("ERR")
print(json.dumps({
  "count": struct.unpack_from("<I", raw, 8)[0],
  "parsed": len(recs),
  "names": names_decoded,
  "text_has": "ZZDeclOnly" in cf.read_stream(vb).decode("latin1"),
}))
`], { encoding: 'utf8' }).trim());
}

line('1. fresh stage, build the UNCHANGED baseline');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
const baseline = await buildAndReport('baseline (nothing changed)');
const g0 = grids();
console.log(`  grid: count=${g0.count} parsed=${g0.parsed}`);

line('2. add ONE declaration (.VB + correct .VGR record), touch nothing else');
const out = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp import writer as W
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import variables as V
from motionworks_iec_mcp import project as P
from pathlib import Path
import struct
root = Path(r"${DIR}")
plan = W.plan_variable_add(root, "${POU}", "ZZDeclOnly", "BOOL", section="VAR")
W.apply_declaration(plan, root, dry_run=False)
pou = P.Project(root=root).pou("${POU}")
cf = CompoundFile(pou.source_path)
vg = next(n for n in cf.stream_names() if n.upper().endswith("V.VGR"))
grid = cf.read_stream(vg)
new_grid, handle = V.append_grid_variable(grid, "ZZDeclOnly", "BOOL")
cf.replace_streams({vg: new_grid})
cf2 = CompoundFile(pou.source_path)
raw = cf2.read_stream(vg)
recs = V.parse_grid_records(raw)
last = V.read_grid_record(raw, recs[-1]["offset"])
print(json.dumps({"handle": handle, "count": struct.unpack_from("<I", raw, 8)[0],
                  "parsed": len(recs), "last": last}))
`], { encoding: 'utf8' });
console.log(`  ${out.trim()}`);
const g1 = grids();
console.log(`  grid now: count=${g1.count} parsed=${g1.parsed} textHasVar=${g1.text_has}`);
console.log(`  names: ${JSON.stringify(g1.names.slice(-3))} …`);

line('3. build');
const after = await buildAndReport('after the declaration');

line('VERDICT');
console.log(`  baseline          : compiled=${baseline.compiled} realProblems=${baseline.real}`);
console.log(`  + one declaration : compiled=${after.compiled} realProblems=${after.real} instanceTree=${after.inst}`);
if (!baseline.compiled) {
  console.log('\n  baseline failed - inconclusive, rerun.');
} else if (after.compiled) {
  console.log('\n  *** DECLARATIONS WORK. *** The earlier failures were an interaction with');
  console.log('  the body write, and the grid record was the missing piece all along.');
} else {
  console.log('\n  *** A DECLARATION ALONE BREAKS THE BUILD. *** Both stores are correct and');
  console.log('  it still fails, so mw_code_var_add must REFUSE until that is solved - an');
  console.log('  agent must never be handed a project that will not compile.');
}
