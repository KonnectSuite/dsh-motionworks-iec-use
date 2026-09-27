/**
 * Does mw_code_pou_assign damage the project TREE?
 *
 * Every assign - from ANY template - turns a clean build into 125 errors naming the
 * EXISTING POUs (TopCutterCamSetup, TopCutterCutControl, ...), never the new one. That
 * is not a property of the clone; it points at the assignment itself, which is new code
 * written for this plugin and has only ever been checked by reading the task map back,
 * never by diffing the bytes it writes.
 *
 * This captures every file the assign touches, before and after, and reports exactly
 * what changed - byte counts, line counts, and the raw text of the task region.
 *
 * Run:  MW_PLUGIN=<installed> node test/tree_diff_assign.mjs
 */
import { existsSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

/** Every file under the project, path -> {size, mtimeMs, hash-ish}. */
function snapshot() {
  const out = new Map();
  const walk = (d) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try { const s = statSync(p); out.set(p, s.size); } catch { /* gone */ }
      }
    }
  };
  walk(DIR);
  return out;
}

line('1. fresh stage');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\AssignProbe`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });

line('2. create the POU (no assign yet)');
await run('mw_ide_close');
await run('mw_code_pou_create', { name: 'AssignProbe', template: 'TopCutterInitialize', dry_run: false });
const before = snapshot();
console.log(`  snapshotted ${before.size} files`);

line('3. ASSIGN it, and see exactly which files change');
const assigned = await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'AssignProbe', dry_run: false });
const after = snapshot();

const changed = [];
for (const [p, size] of after) {
  const was = before.get(p);
  if (was === undefined) changed.push({ p, note: `NEW (${size} bytes)` });
  else if (was !== size) changed.push({ p, note: `${was} -> ${size} bytes` });
}
for (const [p] of before) if (!after.has(p)) changed.push({ p, note: 'DELETED' });
changed.sort((a, b) => a.p.localeCompare(b.p));

console.log(`  files touched by the assign: ${changed.length}`);
for (const c of changed) console.log(`    ${relative(DIR, c.p)}\n        ${c.note}`);

line('4. the raw text of what changed (registries are text, so show them)');
for (const c of changed) {
  if (c.note.startsWith('NEW')) continue;
  if (!/(NODES\.LST|PROJECT\.INF|LIST\.POU|CHGUNITS|\.LOG)$/i.test(c.p)) continue;
  const t = readFileSync(c.p, 'latin1');
  console.log(`  --- ${relative(DIR, c.p)} (${t.length} chars, ${t.split('\n').length} lines)`);
  const rows = t.split('\n').map((l) => l.replace(/\t/g, ' | '));
  const tail = rows.slice(-14);
  console.log(tail.map((l) => `      ${l}`).join('\n'));
}

line('5. the TREE: compare the task/program region');
// The tree lives in src.st1; dump its text via the engine and diff the two revisions.
const { execFileSync } = await import('node:child_process');
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const dumpTree = `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
t = CompoundFile(Path(r"${DIR}") / "src.st1").read_stream("PROJECT.TRE").decode("latin1")
print(t)
`;
const tree = execFileSync(PY, ['-c', dumpTree], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
const treeLines = tree.split('\n');
console.log(`  PROJECT.TRE now: ${treeLines.length} lines, ${tree.length} chars`);
console.log('  --- lines mentioning SlowTsk or AssignProbe ---');
treeLines.forEach((l, i) => {
  if (/SlowTsk|AssignProbe|ServoTaskSlow/.test(l)) {
    console.log(`      ${String(i).padStart(4)} | ${l.slice(0, 100)}`);
  }
});
