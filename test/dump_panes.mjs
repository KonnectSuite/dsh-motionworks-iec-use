/**
 * Dump the current Errors and Warnings panes.
 * Run:  MW_PLUGIN=<installed> node test/dump_panes.mjs [pane ...]
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

const panes = process.argv.slice(2).filter((a) => !a.endsWith('.mjs'));
for (const pane of (panes.length ? panes : ['Errors', 'Warnings'])) {
  const r = await verb('read_output', { pane, limit: 60 }, 60000);
  console.log(`\n=== ${pane} (${r.count}) ===`);
  for (const l of (r.lines ?? [])) console.log(`   ${l}`);
  if (!r.count) console.log('   (empty)');
}
