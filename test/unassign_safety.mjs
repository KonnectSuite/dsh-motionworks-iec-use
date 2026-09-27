/**
 * IS UNASSIGN SAFE? Control versus removal, on a freshly restarted IDE.
 *
 * Round 30 showed that REMOVING a tree node renders cleanly - 573 -> 563 lines for one instance,
 * no malformed nodes - which raised the possibility that removal is safe even though insertion
 * is not, since removal deletes a block rather than constructing one. That would restore
 * mw_code_pou_unassign as a working capability.
 *
 * A first attempt at the open-and-build check failed, but a fresh restart immediately afterwards
 * opened a project successfully, so the failure was not the stale COM state. The difference
 * between the two runs is the unassigned tree, which makes the tree itself the suspect.
 *
 *   C1  nothing changed        -> then open   (the control, on the same restarted IDE)
 *   C2  one instance removed   -> then open
 *
 * Both start from the same staged project and the same IDE, so the only variable is the tree.
 *
 * Run:  MW_PLUGIN=<installed> node test/unassign_safety.mjs
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
        if "\\\\" in nm: bad.append(int(f[0]))
print(json.dumps({"lines": len(lines), "badIds": bad}))
`], { encoding: 'utf8' }).trim());
}

const results = [];
const IDE_ERRORS = [];

async function openProject(label) {
  await run('mw_ide_start');
  try {
    await run('mw_ide_open', { path: MWT });
    return { opened: true };
  } catch (e) {
    const msg = String(e.message).split('\n')[0];
    IDE_ERRORS.push(msg);
    return { opened: false, error: msg.slice(0, 120) };
  }
}

async function kase(label, mutate) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');

  if (mutate) {
    const out = execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from pathlib import Path
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.tree import parse_document
from motionworks_iec_mcp import tree_writer as TW
src = Path(r"${DIR}") / "src.st1"
doc = parse_document(CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1"))
plan = TW.plan_unassign(doc, "BG", "TopCutterFFCamSetup")
CompoundFile(src).replace_streams({"PROJECT.TRE": TW.render(doc, plan).encode("latin1")})
print("removed one instance")
`], { encoding: 'utf8' });
    console.log(`     mutated: ${out.trim()}`);
  } else {
    console.log('     mutated: nothing (control)');
  }
  const t1 = health();
  console.log(`     tree after edit: ${t1.lines}L badIds=${JSON.stringify(t1.badIds)}`);

  const r = await openProject(label);
  console.log(`     OPEN: ${r.opened ? 'ok' : 'FAILED - ' + r.error}`);
  if (r.opened) {
    const t2 = health();
    const b = await run('mw_ide_build');
    console.log(`     after open: ${t2.lines}L badIds=${JSON.stringify(t2.badIds)}`);
    console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled}`);
    results.push({ label, opened: true, bad: t2.badIds.length, compiled: b.is_compiled });
  } else {
    results.push({ label, opened: false, bad: -1, compiled: null });
  }
  await run('mw_ide_close').catch(() => {});
}

await kase('C1. nothing changed (control)', false);
await kase('C2. one instance removed', true);

console.log(`\n${'═'.repeat(80)}`);
console.log('  RESULT');
console.log('═'.repeat(80));
for (const r of results) {
  console.log(`  ${r.label.padEnd(30)} opened=${r.opened} ${r.opened ? `badIds=${r.bad} compiled=${r.compiled}` : ''}`);
}
const c1 = results.find((r) => r.label.startsWith('C1'));
const c2 = results.find((r) => r.label.startsWith('C2'));
console.log('');
if (c1?.opened && c2 && !c2.opened) {
  console.log('  *** REMOVING A NODE ALSO BREAKS THE PROJECT. *** C1 opened, C2 did not, on the same');
  console.log('  restarted IDE with the same staged project - so the tree is the variable, not the');
  console.log('  environment. mw_code_pou_unassign must stay refused alongside assign.');
} else if (c1?.opened && c2?.opened) {
  console.log('  both opened - removal is safe and unassign could be enabled.');
} else {
  console.log('  inconclusive - see the rows above.');
}
