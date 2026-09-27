/**
 * What do the UNEXPOSED bridge verbs actually return?
 *
 * These exist in the bridge but have no tool: compile_state, patch, worksheet,
 * datatypes, command_id, command, feature_state, output_windows, activate_output.
 * Before exposing any of them, find out whether they carry something an agent needs -
 * `ExecuteCommand` was already established to be a stub, so `command` may be a dead
 * end, but `compile_state` and `feature_state` look useful.
 *
 * Run:  MW_PLUGIN=<installed> node test/probe_verbs.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

const CASES = [
  ['compile_state', {}],
  ['output_windows', {}],
  ['feature_state', {}],
  ['command_id', { name: 'BuildMake' }],
  ['command', { id: 36567 }],
  ['activate_output', { name: 'Errors' }],
  ['patch', null],          // these COMPILE - handled separately below
  ['worksheet', null],
  ['datatypes', null],
];

for (const [name, args] of CASES) {
  console.log(`\n${'─'.repeat(72)}\n  ${name}\n${'─'.repeat(72)}`);
  if (args === null) { console.log('  (a compile variant - skipped here, changes build state)'); continue; }
  try {
    const r = await verb(name, args, 90000);
    const s = JSON.stringify(r);
    console.log(`  ${s.length > 900 ? `${s.slice(0, 900)}…` : s}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message.split('\n')[0]}`);
  }
}
