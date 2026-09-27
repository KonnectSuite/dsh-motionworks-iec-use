/**
 * Does the project survive a full assign -> open -> BUILD round trip now?
 *
 * Both protections are in place: src.st1 is snapshotted before the compile, and so are
 * both NODES.LST copies, each restored only if the build FAILED and rewrote them.
 *
 * The check that matters is node integrity. A tree node is a 10-line block
 * (count, header, name, path, blank, state, blank, guid, state, blank). When a line is
 * lost the header stops declaring a level and the PATH ends up where the NAME belongs -
 * which is exactly what a damaged copy looked like:
 *
 *     583 | 13 0 0 0    C\Configuration\R\Resource\Start     <- level 0, path as name
 *
 * So this counts malformed blocks, and the presence of the four nodes that a failed
 * build used to destroy (Start, TopCutterInitialize, Global_Variables, IO_Configuration),
 * after every step.
 *
 * Run:  MW_PLUGIN=<installed> node test/tree_survives_build.mjs
 */
import { existsSync, rmSync, readFileSync, statSync } from 'node:fs';
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
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

/** Malformed node blocks + the four nodes a failed build used to delete. */
function treeHealth() {
  const script = `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = CompoundFile(Path(r"${DIR}") / "src.st1").read_stream("PROJECT.TRE").decode("latin1").splitlines()
bad = []
for i, l in enumerate(lines):
    head = l.split("\\t")[0].split()
    if len(head) == 4 and head[0].isdigit() and head[1].isdigit():
        name = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in name:
            bad.append([i, l.strip(), name[:44]])
full = "\\n".join(lines)
print(json.dumps({
    "lines": len(lines),
    "malformed": len(bad),
    "examples": bad[:4],
    "Start": "Start\\t0\\t0" in full,
    "TopCutterInitialize": "TopCutterInitialize\\t0\\t0" in full,
    "Global_Variables": "Global_Variables\\t0\\t0" in full,
    "IO_Configuration": "IO_Configuration\\t0\\t0" in full,
}))
`;
  return JSON.parse(execFileSync(PY, ['-c', script], { encoding: 'utf8' }).trim());
}

function nodesHealth() {
  try {
    const t = readFileSync(RES_NODES, 'latin1');
    return { bytes: statSync(RES_NODES).size, globals: t.includes('VAR_GLOBALS'), start: t.includes('Start') };
  } catch { return { bytes: -1, globals: false, start: false }; }
}

const rows = [];
function observe(label) {
  const t = treeHealth();
  const n = nodesHealth();
  rows.push({ label, t, n });
  console.log(`  ${label.padEnd(30)} tree=${String(t.lines).padStart(3)}L malformed=${t.malformed}  `
    + `Start=${t.Start ? 'Y' : 'N'} Init=${t.TopCutterInitialize ? 'Y' : 'N'} `
    + `Globals=${t.Global_Variables ? 'Y' : 'N'} IO=${t.IO_Configuration ? 'Y' : 'N'}  | `
    + `NODES=${String(n.bytes).padStart(4)}B VAR_GLOBALS=${n.globals ? 'Y' : 'N'}`);
  for (const e of (t.examples ?? [])) console.log(`        malformed@${e[0]}: ${e[1]}  name=${e[2]}`);
}

console.log('  step                           TREE INTEGRITY                                              | REGISTRY');
console.log('  ' + '─'.repeat(118));

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\SurviveProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
observe('1. after stage');

await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'SurviveProbe', template: 'TopCutterInitialize', dry_run: false });
observe('2. after create');

await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'SurviveProbe', dry_run: false });
observe('3. after ASSIGN');

await run('mw_ide_start');
observe('4. after start_ide');

await run('mw_ide_open', { path: MWT });
observe('5. after open');

const b = await run('mw_ide_build');
observe(`6. after BUILD (compiled=${b.is_compiled})`);

const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
console.log(`  Errors: ${e.count} lines, `
  + `${(e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length} reference problems`);

console.log('\n  VERDICT');
const last = rows[rows.length - 1];
const pristine = rows[0];
if (last.t.malformed === 0 && last.t.Start && last.t.TopCutterInitialize
    && last.t.Global_Variables && last.t.IO_Configuration && last.n.globals) {
  console.log('  PROTECTED: after a failing build the tree has 0 malformed nodes, all four');
  console.log('  critical nodes survive, and NODES.LST keeps VAR_GLOBALS.');
  console.log('  The project is no longer damaged by a build that fails.');
} else {
  console.log('  STILL DAMAGED - something is rewriting the project that the protection misses.');
  console.log(`  malformed ${pristine.t.malformed} -> ${last.t.malformed}, `
    + `lines ${pristine.t.lines} -> ${last.t.lines}, NODES ${pristine.n.bytes} -> ${last.n.bytes}`);
}
