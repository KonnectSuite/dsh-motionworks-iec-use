/**
 * Does appending a .VGR record make a new POU variable compile?
 *
 * The compiler resolves a POU's variables from its binary .VGR grid, not from the .VB
 * text. Adding only the text produced:
 *
 *     Variable 'TopCutterCamSetup:AgentEditTag' not found!
 *
 * So the write path now appends a record too (clone a same-typed local record, patch
 * handle/row/name, bump the header count and last-handle).
 *
 * This checks the grid is still PARSEABLE after the append, that the count agrees with
 * the text, and - the only thing that really counts - that MotionWorks compiles it.
 *
 * Run:  MW_PLUGIN=<installed> node test/grid_append_build.mjs
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
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

line('1. fresh stage, then add a variable the RIGHT way (text + grid)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');

const before = await run('mw_code_read_st', { pou: POU });
console.log(`  ${POU}: ${(before.variables ?? []).length} declarations, ST body ${(before.body ?? '').length} chars`);

// Do the write with the engine directly so the grid patch is included.
const out = execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp import writer as W
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import variables as V
from pathlib import Path
root = Path(r"${DIR}")
plan = W.plan_variable_add(root, "${POU}", "AgentGridTag", "BOOL", section="VAR")
res = W.apply_declaration(plan, root, dry_run=False)

# Append the grid record for the variable just declared.
from motionworks_iec_mcp import project as P
pou = P.Project(root=root).pou("${POU}")
cf = CompoundFile(pou.source_path)
names = cf.stream_names()
vg = next(n for n in names if n.upper().endswith("V.VGR"))
vb = next(n for n in names if n.upper().endswith("V.VB"))
import struct
grid = cf.read_stream(vg)
before_count = struct.unpack_from("<I", grid, 8)[0]
new_grid, handle = V.append_grid_variable(grid, "AgentGridTag", "BOOL")
cf.replace_streams({vg: new_grid})
cf2 = CompoundFile(pou.source_path)
after_count = struct.unpack_from("<I", cf2.read_stream(vg), 8)[0]
recs = V.parse_grid_records(cf2.read_stream(vg))
print(json.dumps({"applied": True, "handle": handle, "before": before_count, "after": after_count, "parsed": len(recs)}))
`], { encoding: 'utf8' });
console.log(`  ${out.trim()}`);
const info = JSON.parse(out.trim());
check(info.after === info.before + 1, `grid count ${info.before} -> ${info.after}`);
check(info.parsed === info.after, `the grid still parses: ${info.parsed} records for a count of ${info.after}`);

line('2. touch the body so the variable unit is definitely rebuilt');
const edited = before.body.replace(/\s+$/, '')
  + `${NL}${NL}(* appended by the test *) AgentGridTag := NOT AgentGridTag;${NL}`;
const w = await run('mw_code_write_st', { pou: POU, body: edited, dry_run: false });
check(w.result?.applied === true, 'body written');
const back = await run('mw_code_read_st', { pou: POU });
check((back.variables ?? []).some((x) => x.name === 'AgentGridTag'), 'the declaration reads back');

line('3. open and BUILD');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b = await run('mw_ide_build');
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
check(b.is_compiled === true, 'MotionWorks compiled the POU with the grid-appended variable');

const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const notFound = (e.lines ?? []).filter((l) => /not found/i.test(l));
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
console.log(`  Errors (${e.count}): ${notFound.length} "not found", ${refs} unresolved-external`);
for (const l of notFound.slice(0, 4)) console.log(`      ${l}`);
check(notFound.length === 0, 'no "Variable ... not found" errors');
check(refs === 0, 'no unresolved-external errors');
const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
check((bp.lines ?? []).some((l) => /Building instance tree/.test(l)), 'the resource instance tree was built');

line('VERDICT');
console.log(failures === 0
  ? '  *** THE VARIABLE IS VISIBLE AND THE BUILD SUCCEEDS. ***\n'
    + '  Appending a .VGR record alongside the .VB text is what the compiler needs, and the\n'
    + '  grid survives the edit.'
  : `  ${failures} check(s) failed - see above.`);
process.exit(failures === 0 ? 0 : 1);
