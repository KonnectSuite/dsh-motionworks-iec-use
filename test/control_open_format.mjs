/**
 * CONTROL: does the IDE reformat PROJECT.TRE even when NOTHING was edited?
 *
 * The tree in the project FILES uses one node layout; after the IDE opens a project, the
 * tree comes back in a different layout - the params line split in two, the redundant
 * name line dropped, and so on. Everything from my inserted block onward got that
 * treatment, which shifted each following node by a line and cost Start, Global_Variables
 * and IO_Configuration their name lines.
 *
 * The question that decides what to do about it: is that reformatting NORMAL (the IDE
 * always normalizes on open, and the file layout is simply a packed form), or is my
 * inserted block what triggers it?
 *
 * So: stage a pristine copy, open it, close it, and diff the tree. No create, no assign.
 *
 * Run:  MW_PLUGIN=<installed> node test/control_open_format.mjs
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

const dumpTree = `
import sys
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = CompoundFile(Path(r"${DIR}") / "src.st1").read_stream("PROJECT.TRE").decode("latin1").splitlines()
print("\\n".join(lines))
`;

function tree() {
  return execFileSync(PY, ['-c', dumpTree], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 })
    .split('\n');
}

/** node headers, as (line, header, following-line) */
function headers(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const p = String(lines[i]).split('\t')[0].split(' ');
    if (p.length === 4 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) {
      out.push({ line: i, header: lines[i].trim(), next: (lines[i + 1] ?? '').slice(0, 40) });
    }
  }
  return out;
}

console.log('  step                              lines  nodes  last 4 headers');
console.log('  ' + '─'.repeat(96));

const snapshots = [];
function observe(label) {
  const t = tree();
  const h = headers(t);
  snapshots.push({ label, lines: t.length, headers: h, text: t.join('\n') });
  const tail = h.slice(-4).map((x) => `${x.line}:${x.header}`).join('  ');
  console.log(`  ${label.padEnd(32)} ${String(t.length).padStart(5)}  ${String(h.length).padStart(5)}  ${tail}`);
  return t;
}

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
const before = observe('1. staged, NOTHING edited');

await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const after = observe('2. after OPEN (no edits at all)');

// Give the IDE a moment, then close and see whether closing writes more.
await new Promise((r) => setTimeout(r, 2000));
await run('mw_ide_close');
const closed = observe('3. after CLOSE');

console.log('\n  VERDICT');
const changed = before.length !== after.length;
if (!changed) {
  console.log('  The IDE leaves a PRISTINE tree alone. The reformatting is therefore');
  console.log('  triggered by the inserted block, not by opening as such.');
  const a = headers(before), b = headers(after);
  let same = a.length === b.length;
  if (same) {
    for (let i = 0; i < a.length; i++) if (a[i].header !== b[i].header) { same = false; break; }
  }
  console.log(`  headers identical too: ${same}`);
} else {
  console.log(`  The IDE REFORMATS even an untouched project (${before.length} -> ${after.length} lines).`);
  console.log('  So the file layout is a packed form the IDE normalizes on open, and that is');
  console.log('  expected behaviour - the damage must come from somewhere else.');
}
console.log(`  before=${before.length} afterOpen=${after.length} afterClose=${closed.length}`);
