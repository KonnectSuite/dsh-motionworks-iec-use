/**
 * Does read_output give the compiler messages as TEXT?
 *
 * Run:  MW_PLUGIN=<installed> node test/test_read_output.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

for (const pane of ['Errors', 'Warnings', 'Build', 'Info']) {
  console.log(`\n${'─'.repeat(72)}\n  pane: ${pane}\n${'─'.repeat(72)}`);
  try {
    const r = await verb('read_output', { pane, limit: 25 }, 60000);
    console.log(`  count: ${r.count}`);
    if (r.note) console.log(`  note : ${r.note}`);
    for (const l of (r.lines ?? []).slice(0, 14)) console.log(`    ${l}`);
    if ((r.lines ?? []).length > 14) console.log(`    … and ${r.lines.length - 14} more`);
  } catch (e) {
    console.log(`  FAILED: ${e.message.split('\n')[0]}`);
  }
}
