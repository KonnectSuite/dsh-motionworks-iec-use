/**
 * ROUND TRIP: create a POU then delete it, and the project must come back to
 * exactly what it was.
 *
 * This is the sharpest possible test of the record surgery. Create and delete each
 * edit PROJECT.TRE, LIST.POU and the POU directory; if either leaves a byte behind,
 * the project that results is not the project that started.
 *
 * Motivated by measurement: `mw_code_pou_delete` was applied and the project then
 * refused to open ("Internal error in 'OpenProject'"), while the POU-set before and
 * after looked right. So the damage is in the tree or the registries, and a
 * file-level diff against the ORIGINAL is what shows it.
 *
 * Run:  MW_PLUGIN=<installed> node test/vet_roundtrip.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;

const SOURCE = process.argv[2]
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Arya WorkSpace\\Arya WorkSpace\\MP2600iec Program\\_baseline_20260927\\TopCutter.mwt';
const NEW = process.argv[3] ?? 'RoundTripPou';

const line = (s) => console.log(`\n${'═'.repeat(76)}\n  ${s}\n${'═'.repeat(76)}`);

/** Rel path -> sha256 of every file under a project directory. */
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        out.set(relative(root, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
      }
    }
  };
  walk(root);
  return out;
}

line('1. stage a fresh copy from the original');
try { rmSync(join(STAGE, 'TopCutter'), { recursive: true, force: true }); } catch { /* first run */ }
try { rmSync(join(STAGE, 'TopCutter.mwt'), { force: true }); } catch { /* first run */ }
// Deleting a POU archives its directory, and the engine refuses when that archive
// already exists — so a repeated run of this test would fail on the leftover from
// the last one. Clearing it keeps the run repeatable. (Worth knowing as a real
// limitation: delete the same POU NAME twice and the second delete is refused
// until the archive is moved aside.)
try { rmSync(join(mod.__internals.HERE ?? PLUGIN, 'backups', 'archived-pous', NEW), { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
const DIR = join(STAGE, 'TopCutter');
console.log(`  staged: ${DIR}`);

line('2. snapshot the pristine project');
const before = snapshot(DIR);
console.log(`  files: ${before.size}`);

line(`3. create '${NEW}'`);
await run('mw_ide_close');
const created = await run('mw_code_pou_create', { name: NEW, template: 'TopCutterInitialize', dry_run: false });
console.log(`  created, node_ids=${JSON.stringify(created.result.node_ids)}, node_total=${created.result.node_total}`);
const afterCreate = snapshot(DIR);
console.log(`  files now: ${afterCreate.size} (added ${afterCreate.size - before.size})`);

line(`4. delete '${NEW}'`);
const deleted = await run('mw_code_pou_delete', { name: NEW, dry_run: false });
console.log(`  archived to ${deleted.result.archived_to ?? '(ok)'}`);
const afterDelete = snapshot(DIR);
console.log(`  files now: ${afterDelete.size}`);

line('5. compare against the pristine snapshot');
const added = [...afterDelete.keys()].filter((k) => !before.has(k));
const removed = [...before.keys()].filter((k) => !afterDelete.has(k));
const changed = [...before.keys()].filter((k) => afterDelete.has(k) && afterDelete.get(k) !== before.get(k));

console.log(`  ADDED   (should be none): ${added.length}`);
for (const k of added.slice(0, 20)) console.log(`      + ${k}`);
console.log(`  REMOVED (should be none): ${removed.length}`);
for (const k of removed.slice(0, 20)) console.log(`      - ${k}`);
console.log(`  CHANGED (should be none): ${changed.length}`);
for (const k of changed.slice(0, 20)) console.log(`      ~ ${k}`);

const clean = added.length === 0 && removed.length === 0 && changed.length === 0;
line(clean
  ? 'ROUND TRIP CLEAN — create + delete restored the project byte for byte'
  : 'ROUND TRIP LEFT THE PROJECT DIFFERENT — the files above are the evidence');
process.exit(clean ? 0 : 1);
