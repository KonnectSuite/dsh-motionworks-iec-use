/**
 * THE TOOLS NOBODY HAS TESTED.
 *
 * The capability matrix covers thirteen WRITE workflows. Reading the tool list against it shows
 * several tools that have never been exercised at all, and two of them matter more than the
 * rest because they are a SECOND SOURCE OF TRUTH:
 *
 *   mw_ide_variables   the IDE's own live variable model, read over COM. If it agrees with what
 *                      this plugin wrote to the files, an agent has independent confirmation
 *                      that a declaration really landed - rather than the plugin vouching for
 *                      its own output.
 *   mw_ide_pous        the IDE's own POU list, same argument.
 *   mw_ide_make        Make (Compile 1), distinct from Build (Compile 2). The matrix only ever
 *                      calls build.
 *   mw_ide_errors      its pane argument has only been exercised with 'Errors'.
 *   mw_code_pou_unassign  a write into the project tree, like assign - and unlike assign it has
 *                      never been run against a real project at all.
 *
 * So this exercises each one and records what it actually does:
 *
 *   A  mw_ide_pous / mw_ide_variables on a freshly opened project
 *   B  add a POU-local declaration, then ask the IDE whether IT can see it
 *   C  mw_ide_make, and the compile state after it
 *   D  mw_ide_errors on each pane
 *   E  mw_code_pou_unassign against an assignment that exists
 *
 * Run:  MW_PLUGIN=<installed> node test/tool_sweep.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const VAR = 'ZZSweepProbe';
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${String(detail).slice(0, 96)}`);
};

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');

console.log('\n  ══ A. the IDE\'s own view of a freshly opened project ══');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

try {
  const p = await run('mw_ide_pous');
  const names = Array.isArray(p) ? p : (p.pous ?? p.items ?? []);
  record('mw_ide_pous', names.length > 0, `${names.length} POUs from the live model`);
  console.log(`       sample: ${JSON.stringify(names.slice?.(0, 3) ?? names).slice(0, 110)}`);
} catch (e) { record('mw_ide_pous', false, String(e.message).slice(0, 90)); }

try {
  const v = await run('mw_ide_variables');
  const count = Array.isArray(v) ? v.length : Object.keys(v ?? {}).length;
  record('mw_ide_variables', count > 0, `${count} entries from the live model`);
  console.log(`       sample: ${JSON.stringify(v).slice(0, 160)}`);
} catch (e) { record('mw_ide_variables', false, String(e.message).slice(0, 90)); }

try {
  const one = await run('mw_ide_variables', { pou: POU });
  const count = Array.isArray(one) ? one.length : Object.keys(one ?? {}).length;
  record('mw_ide_variables(pou)', count > 0, `${count} entries for ${POU}`);
  console.log(`       sample: ${JSON.stringify(one).slice(0, 200)}`);
} catch (e) { record('mw_ide_variables(pou)', false, String(e.message).slice(0, 90)); }

console.log('\n  ══ B. does the IDE SEE a declaration this plugin wrote? ══');
await run('mw_ide_close');
const add = await run('mw_code_var_add', {
  pou: POU, name: VAR, type: 'BOOL', section: 'VAR', initial_value: 'FALSE', dry_run: false,
});
console.log(`     wrote it: applied=${add.result?.applied}`);
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
try {
  const one = await run('mw_ide_variables', { pou: POU });
  const text = JSON.stringify(one);
  record('the IDE sees the new declaration', text.includes(VAR), text.includes(VAR) ? 'present' : 'ABSENT');
} catch (e) { record('the IDE sees the new declaration', false, String(e.message).slice(0, 90)); }

console.log('\n  ══ C. Make, which the matrix never calls ══');
try {
  const m = await run('mw_ide_make');
  record('mw_ide_make', true, JSON.stringify(m).slice(0, 90));
  const cs = await run('mw_ide_compile_state');
  record('compile state after make', true, JSON.stringify(cs).slice(0, 70));
} catch (e) { record('mw_ide_make', false, String(e.message).slice(0, 90)); }

console.log('\n  ══ D. the Errors tool on each pane ══');
for (const pane of ['Errors', 'Warnings', 'Infos', 'Build']) {
  try {
    const e = await run('mw_ide_errors', { pane, limit: 50 });
    record(`mw_ide_errors(${pane})`, typeof e.count === 'number',
      `count=${e.count} lines=${(e.lines ?? []).length}`);
  } catch (err) { record(`mw_ide_errors(${pane})`, false, String(err.message).slice(0, 80)); }
}

console.log('\n  ══ E. unassign, which has never been run at all ══');
const tasks = await run('mw_code_tasks');
const assigned = Object.entries(tasks.tasks ?? {}).find(([, ps]) => ps.length > 0);
console.log(`     a real assignment exists: ${assigned ? `${assigned[0]} <- ${assigned[1][0]}` : 'none'}`);
try {
  const u = await run('mw_code_pou_unassign', {
    task: assigned?.[0], pou: assigned?.[1]?.[0], dry_run: false,
  });
  record('mw_code_pou_unassign', u?.result?.applied === true || u?.applied === true,
    JSON.stringify(u).slice(0, 90));
} catch (e) {
  record('mw_code_pou_unassign', false, String(e.message).replace(/\s+/g, ' ').slice(0, 110));
}

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(90)}`);
console.log('  SUMMARY');
console.log('═'.repeat(90));
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - bad} of ${results.length} behave as intended`);
