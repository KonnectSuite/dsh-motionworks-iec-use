/**
 * EVERY TOOL, EXERCISED - AND A CHECK THAT STOPS THIS DRIFTING AGAIN.
 *
 * Ten of the thirty-six tools are referenced by no test in this suite:
 *
 *   mw_ide_save  mw_ide_trial  mw_ide_state  mw_ide_dialog  mw_ide_screenshot
 *   mw_code_types  mw_code_library  mw_code_manual
 *   mw_code_task_create  mw_code_task_delete
 *
 * Two of them were added in round 45 and tested only by hand, which is how a tool ships without a
 * regression test. The rest have been used in probes and never in the suite.
 *
 * So this does two jobs. It exercises each of those ten and asserts on what they return, and then
 * it CHECKS THE WHOLE SET: every tool the plugin registers must be named by at least one test file,
 * so adding a tool without covering it fails the suite rather than going unnoticed.
 *
 * That second part is the point. A coverage rule that is only ever checked by hand is a rule that
 * is only ever true on the day it was written.
 *
 * Run:  MW_PLUGIN=<installed> node test/tool_coverage.mjs
 */
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = process.env.MW_PLUGIN ?? join(HERE, '..');
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(40)} ${String(detail ?? '').slice(0, 74)}`);
};

// ── the ten that had no test ─────────────────────────────────────────────────────
console.log('\n  ══ reading tools ══');

try {
  const t = await run('mw_code_types');
  const n = (t.types ?? t.data_types ?? []).length;
  check('mw_code_types', n > 50, `${n} data types`);
} catch (e) { check('mw_code_types', false, String(e.message).slice(0, 70)); }

try {
  const l = await run('mw_code_library');
  const n = (l.libraries ?? l.blocks ?? []).length;
  check('mw_code_library', n > 0, `${n} library entries`);
} catch (e) { check('mw_code_library', false, String(e.message).slice(0, 70)); }

try {
  const m = await run('mw_code_manual', { term: 'CamGenerator', limit: 1 });
  check('mw_code_manual', (m.found ?? 0) > 0 && (m.results ?? []).length > 0,
    `${m.found} manual(s), hits ${(m.results ?? []).map((r) => r.hits).join('/')}`);
} catch (e) { check('mw_code_manual', false, String(e.message).slice(0, 70)); }

try {
  const m = await run('mw_code_manual', {});
  check('mw_code_manual (list mode)', (m.manuals ?? []).length > 0,
    `${(m.manuals ?? []).length} manuals, ${(m.help_topics ?? []).length} help topics`);
} catch (e) { check('mw_code_manual (list mode)', false, String(e.message).slice(0, 70)); }

console.log('\n  ══ the IDE-side tools ══');
try {
  const s = await run('mw_ide_state');
  check('mw_ide_state', typeof s.ide_running === 'boolean',
    `ide_running=${s.ide_running} dialogs=${s.dialog_count ?? 0}`);
} catch (e) { check('mw_ide_state', false, String(e.message).slice(0, 70)); }

try {
  const t = await run('mw_ide_trial');
  check('mw_ide_trial', t !== undefined, JSON.stringify(t).slice(0, 60));
} catch (e) { check('mw_ide_trial', false, String(e.message).slice(0, 70)); }

try {
  const d = await run('mw_ide_dialog');
  check('mw_ide_dialog', d !== undefined, JSON.stringify(d).slice(0, 60));
} catch (e) { check('mw_ide_dialog', false, String(e.message).slice(0, 70)); }

try {
  const shot = await run('mw_ide_screenshot');
  const bytes = existsSync(shot.path) ? readFileSync(shot.path).length : 0;
  // The IDE may not be running yet in this section - that is fine, the dedicated check lives with
  // the task lifecycle below, where a project is guaranteed open.
  check('mw_ide_screenshot (no IDE yet is ok)', true,
    bytes > 1000 ? `${shot.width}x${shot.height}` : 'deferred to the staged section');
} catch (e) {
  check('mw_ide_screenshot (no IDE yet is ok)', true, 'deferred to the staged section');
}

// ── the task lifecycle, which had no test ────────────────────────────────────────
console.log('\n  ══ the task lifecycle ══');
if (!SOURCE) {
  check('task lifecycle', false, 'no pristine source for staging');
} else {
  const STAGE = mod.__internals.STAGE_ROOT;
  const DIR = `${STAGE}\\TopCutter`;
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (let i = 0; i < 10; i++) {
    try { rmSync(DIR, { recursive: true, force: true }); rmSync(`${DIR}.mwt`, { force: true }); break; }
    catch { await new Promise((r) => setTimeout(r, 1500)); }
  }
  await run('mw_ide_stage', { source: SOURCE });
  await run('mw_ide_close');
  await run('mw_ide_start');
  await run('mw_ide_open', { path: `${DIR}.mwt` });

  const names = async () => Object.keys((await run('mw_code_tasks')).tasks ?? {});
  const start = await names();

  const dry = await run('mw_code_task_create', { name: 'ZzCov', kind: 'CYCLIC' });
  check('mw_code_task_create dry_run', dry.dry_run === true && !(await names()).includes('ZzCov'),
    'nothing changed');

  const made = await run('mw_code_task_create', { name: 'ZzCov', kind: 'CYCLIC', dry_run: false });
  const after = await names();
  check('mw_code_task_create', made.created === true && after.includes('ZzCov'),
    `${start.length} -> ${after.length} tasks`);

  let dup = null;
  try { await run('mw_code_task_create', { name: 'ZzCov', dry_run: false }); }
  catch (e) { dup = String(e.message).split('\n')[0]; }
  check('a duplicate task is refused', dup !== null, (dup ?? 'NOT REFUSED').slice(0, 60));

  try {
    await run('mw_code_task_delete', { name: 'ZzCov', dry_run: false });
    const back = await names();
    check('mw_code_task_delete', !back.includes('ZzCov'),
      JSON.stringify(back) === JSON.stringify(start) ? 'back to the starting set' : back.join(', '));
  } catch (e) { check('mw_code_task_delete', false, String(e.message).slice(0, 70)); }

  const b = await run('mw_ide_build');
  check('the project still compiles', b.is_compiled === true, `is_compiled=${b.is_compiled}`);

  const saved = await run('mw_ide_save');
  check('mw_ide_save', saved.saved === true, `saved in ${saved.elapsed_s}s`);

  // The screenshot needs the IDE open, so it belongs here rather than with the other read-only
  // IDE tools - running it before staging is what made it fail the first time.
  try {
    const shot = await run('mw_ide_screenshot');
    const bytes = existsSync(shot.path) ? readFileSync(shot.path).length : 0;
    check('mw_ide_screenshot', bytes > 1000, `${shot.width}x${shot.height}, ${bytes}B`);
  } catch (e) { check('mw_ide_screenshot', false, String(e.message).slice(0, 70)); }
}

// ── the coverage rule ────────────────────────────────────────────────────────────
console.log('\n  ══ coverage: is every tool named by a test? ══');
// This file counts. It is the test for the ten tools that had none, so excluding it would make the
// rule unsatisfiable for exactly the tools it was written for. What the rule asserts is that no
// tool is INVISIBLE to the suite - not that every tool has a dedicated file.
const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs'));
const sources = new Map(files.map((f) => [f, readFileSync(join(HERE, f), 'utf8')]));
const uncovered = [];
for (const name of tools.keys()) {
  const found = [...sources.entries()]
    .filter(([, text]) => text.includes(name))
    .map(([f]) => f);
  if (found.length === 0) uncovered.push(name);
}
check('every registered tool is named by some test', uncovered.length === 0,
  uncovered.length ? `uncovered: ${uncovered.join(', ')}` : `all ${tools.size} covered`);

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(88)}`);
console.log('  SUMMARY');
console.log('═'.repeat(88));
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - bad} of ${results.length} pass`);
