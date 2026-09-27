/**
 * Does the IDE reject a node for a program it has never COMPILED?
 *
 * The damage diff showed the IDE parsing the generated node - it kept the marker '19' and the
 * GUID this plugin wrote - and then re-emitting it with different field offsets and a ZEROED
 * id line. A parser that understood the node would have left it alone, as it left every real
 * instance alone. So it did not understand it, and wrote a default instead.
 *
 * One reason it might not understand it: the program has no compiled artifacts. An unassigned
 * POU is never compiled - that is established - so a freshly created POU has no assembly, no
 * ICI tables and no place in the resource's generated file list, and the IDE may be unable to
 * resolve the instance's target.
 *
 * An ALREADY-ASSIGNED POU is a clean test of that, because it does have all of those things.
 * So this assigns TopCutterCamSetup - assigned to BG and compiled - to a SECOND task, SlowTsk:
 *
 *   X  assign an already-assigned, already-COMPILED POU to a second task
 *   Y  assign a freshly created, never-compiled POU          (control, known to fail)
 *   Z  no assignment                                          (control, must stay clean)
 *
 * If X survives open while Y does not, the program's compiled state is the difference and the
 * fix is to build before assigning.
 *
 * Run:  MW_PLUGIN=<installed> node test/assign_compiled.mjs
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

const NEW_POU = 'CmpProbe';

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

function assign(task, pou) {
  return execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp import tree_writer as TW
src = Path(r"${DIR}") / "src.st1"
text = CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
doc = TW.parse_document(text)
plan = TW.plan_assign(doc, "${task}", "${pou}")
CompoundFile(src).replace_streams({"PROJECT.TRE": TW.render(doc, plan).encode("latin1")})
print("assigned ${pou} to ${task}")
`], { encoding: 'utf8' }).trim();
}

const results = [];

async function kase(label, prepare) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${NEW_POU}`, { recursive: true, force: true }); } catch { /* absent */ }
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

await kase('X. assign an already-COMPILED POU (TopCutterCamSetup) to SlowTsk',
  () => assign('SlowTsk', 'TopCutterCamSetup'));

await kase('Y. assign a never-compiled new POU to SlowTsk',
  async () => {
    await run('mw_code_pou_create', { name: NEW_POU, template: 'TopCutterInitialize', dry_run: false });
    await run('mw_ide_close');
    return assign('SlowTsk', NEW_POU);
  });

await kase('Z. no assignment (control)', async () => 'nothing');

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
for (const r of results) {
  console.log(`  ${r.ok ? 'INTACT ' : 'DAMAGED'} ${r.label.slice(0, 52).padEnd(54)} `
    + `badIds=${r.bad} compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real}`);
}
const x = results.find((r) => r.label.startsWith('X'));
const y = results.find((r) => r.label.startsWith('Y'));
console.log('');
if (x?.ok && y && !y.ok) {
  console.log('  *** THE PROGRAM MUST ALREADY BE COMPILED. *** X survived and Y did not, so the');
  console.log('  difference is the program\'s compiled state, and the fix is to build first.');
} else if (x?.ok && y?.ok) {
  console.log('  both survived - compiled state is not the difference either.');
} else if (x && !x.ok) {
  console.log('  even a fully compiled POU is rejected, so it is not about the program at all -');
  console.log('  it is the node itself, which is the field-offset question the snapshots pose.');
} else {
  console.log('  see the table above.');
}
