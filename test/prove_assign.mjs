/**
 * PROOF that assignment is what makes code real.
 *
 * ErrorProbe contains `UndeclaredThing := UndeclaredThing + 1;` and was forced past
 * the linter with run_lint:false. While it was UNASSIGNED the build reported
 * "compiled cleanly". If that is because an unassigned POU is never compiled, then
 * assigning it must make the same build FAIL - which also proves the new assign path
 * writes a tree the IDE accepts.
 *
 * Run:  MW_PLUGIN=<installed> node test/prove_assign.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const MWT = `${mod.__internals.STAGE_ROOT}\\TopCutter.mwt`;
const line = (s) => console.log(`\n${'═'.repeat(76)}\n  ${s}\n${'═'.repeat(76)}`);

line('0. the current task map');
let tasks;
try {
  tasks = await run('mw_code_tasks');
  for (const [t, ps] of Object.entries(tasks.tasks)) console.log(`  ${t}: ${ps.join(', ') || '(none)'}`);
  console.log(`  UNASSIGNED: ${tasks.unassigned.join(', ') || '(none)'}`);
} catch (e) { console.log(`  ${e.message}`); }

line('1. assign ErrorProbe (which contains an undeclared variable) to a task');
try { await run('mw_ide_close'); } catch { /* not running */ }
try {
  const r = await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'ErrorProbe', dry_run: false });
  console.log(`  applied: ${JSON.stringify(r.result).slice(0, 200)}`);
} catch (e) { console.log(`  assign threw: ${e.message.split('\n')[0]}`); }

line('2. reopen and build — this SHOULD now fail');
try { await run('mw_ide_start'); } catch (e) { console.log(`  start: ${e.message}`); }
try {
  await run('mw_ide_open', { path: MWT });
  console.log('  open: OK');
} catch (e) { console.log(`  open: FAILED — ${e.message.split('\n')[0]}`); }

try {
  const b = await run('mw_ide_build');
  console.log(`  build: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
  console.log('');
  if (b.is_compiled === false) {
    console.log('  RESULT: the build now FAILS. Confirms an unassigned POU is not compiled,');
    console.log('          so a clean build was never evidence that it was correct.');
  } else {
    console.log('  RESULT: still compiles — so either the assignment did not take effect, or');
    console.log('          the compiler tolerates the undeclared variable. Worth investigating.');
  }
} catch (e) { console.log(`  build threw: ${e.message.split('\n')[0]}`); }

line('3. task map after');
try {
  const t2 = await run('mw_code_tasks');
  for (const [t, ps] of Object.entries(t2.tasks)) console.log(`  ${t}: ${ps.join(', ') || '(none)'}`);
  console.log(`  UNASSIGNED: ${t2.unassigned.join(', ') || '(none)'}`);
} catch (e) { console.log(`  ${e.message}`); }
