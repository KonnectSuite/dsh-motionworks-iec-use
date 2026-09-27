/**
 * Build the count-patched project. If it compiles, the .VGR count is the crux.
 *
 * Run:  MW_PLUGIN=<installed> node test/build_count_probe.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

const PROBE = `${PLUGIN}\\stage\\CountProbe.mwt`;

console.log('  closing the IDE, then opening the patched copy');
try { await verb('close_ide', {}, 60000); } catch { /* not running */ }
await verb('start_ide', {}, 120000);
const open = await verb('open', { path: PROBE }, 180000);
console.log(`  opened: ${open.opened} in ${open.elapsed_s}s`);

const st0 = await verb('compile_state', {}, 30000);
console.log(`  before build: ${JSON.stringify(st0)}`);

const b = await verb('build', {}, 400000);
console.log(`  BUILD: is_compiled=${b.is_compiled} accepted=${b.accepted} (${b.elapsed_s}s)`);

const errs = await verb('read_output', { pane: 'Errors', limit: 30 }, 90000);
const refs = (errs.lines ?? []).filter((l) => /No matching global/i.test(l));
console.log(`  Errors pane: ${errs.count} line(s), ${refs.length} reference problem(s)`);
for (const l of (errs.lines ?? []).slice(0, 5)) console.log(`      ${l}`);

console.log('');
if (b.is_compiled === true) {
  console.log('  *** THE .VGR COUNT IS THE CRUX ***');
  console.log('  Patching one uint32 turned 125 reference errors into a clean build, so the');
  console.log('  global write path must keep the grid header count in step with the .VB text.');
} else {
  console.log('  The count alone is NOT enough - the grid RECORDS matter too, and a global');
  console.log('  add has to append a record, not just bump the counter.');
}
