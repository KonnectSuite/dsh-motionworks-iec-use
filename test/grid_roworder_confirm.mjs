/**
 * CONFIRM the row-order result, and get the destruction check right.
 *
 * The last run said R1 "COMPILED=true" AND "DESTROYED", which cannot both be true. The cause
 * is the check: it compared src.st1 sizes for equality, but a SUCCESSFUL build legitimately
 * rewrites that file - 9216 to 9728 bytes, the compiled artifacts being added. Real
 * destruction is a different order of thing: 9216 to 80,071,680 bytes, which is what the
 * end-insert does.
 *
 * So this measures what actually matters, on a declaration that is genuinely USED:
 *
 *   1. is_compiled
 *   2. the declaration and its use both present in the written text
 *   3. the POU readable afterwards, and its .VB stream NOT emptied
 *   4. the .VGR parseable afterwards, with the record still there and in row order
 *   5. src.st1 growth in a sane range, not three orders of magnitude
 *   6. a SECOND build, to show the result is stable rather than a one-off
 *
 * Run:  MW_PLUGIN=<installed> node test/grid_roworder_confirm.mjs
 */
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs';
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
const HELPER = `${PLUGIN}\\test\\grid_roworder.py`;
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZRowProbe';
const checks = [];
const check = (ok, text) => {
  checks.push(ok);
  console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

const SRC = () => `${DIR}\\POE\\${POU}\\src.st1`;
const size = () => { try { return statSync(SRC()).size; } catch { return -1; } };

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_close');

const before = size();
console.log(`\n  ── insert a row-ordered record and USE the variable`);
console.log(`     ${execFileSync(PY, [HELPER, DIR, POU, VAR], { encoding: 'utf8' }).trim().split('\n').pop().trim()}`);

const r = await run('mw_code_read_st', { pou: POU });
const body = r.body.replace(/\s+$/, '') + `${NL}(* uses the declared variable *)${NL}${VAR} := NOT ${VAR};${NL}`;
await run('mw_code_write_st', { pou: POU, body, dry_run: false });

await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b1 = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
const real = (e.lines ?? []).filter((l) => /not found|No matching|undeclared/i.test(l));
console.log(`\n  ── build 1 (${b1.elapsed_s}s)`);
check(b1.is_compiled === true, `is_compiled=true (got ${b1.is_compiled})`);
check(b1.stalled === false, `not stalled (stalled=${b1.stalled})`);
check(real.length === 0, `no "not found" problems (got ${real.length})`);

const after1 = size();
console.log(`\n  ── integrity`);
check(after1 > before, `src.st1 grew (${before} -> ${after1})`);
check(after1 < before * 10, `growth is sane, not destruction (ratio ${(after1 / before).toFixed(2)})`);

let readBack = null;
try { readBack = await run('mw_code_read_st', { pou: POU }); } catch (err) { readBack = { error: err.message }; }
check(!readBack.error, `POU still readable${readBack.error ? ': ' + readBack.error.slice(0, 80) : ''}`);
check((readBack.body ?? '').includes(VAR), 'the body still carries the use of the variable');
check((readBack.variables ?? []).some((v) => v.name === VAR), 'the declaration still reads back');

const probe = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import variables as V
from pathlib import Path
cf = CompoundFile(Path(r"${DIR}") / "POE" / "${POU}" / "src.st1")
vg = next((n for n in cf.stream_names() if n.upper().endswith("V.VGR")), None)
raw = cf.read_stream(vg)
recs = V.parse_grid_records(raw)
rows = [r["row"] for r in recs]
names = [V.read_grid_record(raw, r["offset"])["name"] for r in recs]
print(json.dumps({"count": len(recs), "rows": rows, "ascending": rows == sorted(rows),
                  "hasNew": "${VAR}" in names, "vb": len(cf.read_stream(next(n for n in cf.stream_names() if n.upper().endswith("V.VB"))))}))
`], { encoding: 'utf8' }).trim();
const grid = JSON.parse(probe);
console.log(`     grid: ${grid.count} records, rows ${grid.rows.join(',')}`);
check(grid.hasNew, 'the new record is still in the grid');
check(grid.ascending, 'the rows are still ascending');
check(grid.vb > 0, `the .VB is not empty (${grid.vb} bytes)`);

console.log(`\n  ── build 2 (stability)`);
const b2 = await run('mw_ide_build');
check(b2.is_compiled === true, `second build also clean (got ${b2.is_compiled})`);

const passed = checks.filter(Boolean).length;
console.log(`\n${'═'.repeat(80)}`);
console.log(`  ${passed} of ${checks.length} checks passed`);
console.log('═'.repeat(80));
if (passed === checks.length) {
  console.log('\n  *** CONFIRMED: A DECLARATION CAN BE DECLARED AND USED WITH NO IDE STEP. ***');
  console.log('  The only thing wrong was the POSITION of the record. Placing it where its row');
  console.log('  belongs - between row 20 and row 25, not after row 25 - is the whole difference.');
}
await run('mw_ide_close');
