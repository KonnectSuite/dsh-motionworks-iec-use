/**
 * Can a build succeed if the tree is RESTORED after the open damaged it?
 *
 * Established:
 *   - a dedicated control run confirms the IDE leaves a PRISTINE tree alone
 *     (573 lines / 57 nodes before open, after open, and after close)
 *   - with a generated instance block present, OPEN rewrites the tree from that block
 *     onward into a different node layout, which shifts every following node by a line
 *     and costs Start, Global_Variables and IO_Configuration their name lines
 *   - the build then skips the Global_Variables unit and reports 125 unresolved-external
 *     errors, and the project never recovers
 *
 * The IDE's in-memory model is built by PARSING the project, and the parse happens from
 * the file as it was BEFORE it re-serialised. So restoring the pre-open bytes and then
 * building tests whether the damage is only to the file on disk, or whether the model is
 * wrong too.
 *
 * Run:  MW_PLUGIN=<installed> node test/restore_after_open.mjs
 */
import { existsSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const TREE = `${DIR}\\src.st1`;
const RES_NODES = `${DIR}\\C\\Configuration\\R\\Resource\\NODES.LST`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const treeLines = () => execFileSync(PY, ['-c', `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
print(len((CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1").splitlines()))
`], { encoding: 'utf8' }).trim();

line('1. fresh stage, create + assign');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\RestoreProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'RestoreProbe', template: 'TopCutterInitialize', dry_run: false });
await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'RestoreProbe', dry_run: false });
console.log(`  tree before open: ${treeLines()} lines`);

line('2. snapshot the good bytes, then open (which damages them)');
const treeBackup = `${TREE}.good`;
const nodesBackup = `${RES_NODES}.good`;
copyFileSync(TREE, treeBackup);
copyFileSync(RES_NODES, nodesBackup);

await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
console.log(`  tree after open : ${treeLines()} lines   (damage expected)`);

line('3. RESTORE the pre-open bytes, then build');
writeFileSync(TREE, readFileSync(treeBackup));
writeFileSync(RES_NODES, readFileSync(nodesBackup));
console.log(`  tree restored   : ${treeLines()} lines`);

const b = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const build = await run('mw_ide_errors', { pane: 'Build', limit: 60 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
console.log(`  Errors: ${e.count} lines, ${refs} reference problems`);
console.log(`  tree after build: ${treeLines()} lines`);
console.log('  units compiled:');
for (const l of (build.lines ?? [])) console.log(`      ${l}`);

line('VERDICT');
if (b.is_compiled === true) {
  console.log('  *** RESTORING AFTER THE OPEN MAKES THE BUILD SUCCEED ***');
  console.log('  The damage is to the FILE only; the IDE parsed the good bytes, so its model');
  console.log('  is right and restoring the disk copy before building is enough.');
} else {
  console.log('  restoring the file is NOT enough - the IDE model itself is wrong, so the');
  console.log('  node layout it parsed is not the one it accepts.');
}
