/**
 * Exercises the bridge verbs the coding loop needs, through the plugin's own
 * ensureBridge() - the launcher path already proven to work.
 */
const mod = await import('../index.js');
const { verb } = mod.__internals;

const show = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);

// status must now find an IDE titled "MULTIPROG - <project>", not just
// "MotionWorks IEC 3 Pro - <project>".
show('status', await verb('status', {}, 30000));
show('output_windows', await verb('output_windows', {}, 20000));
show('activate_output Errors', await verb('activate_output', { name: 'Errors' }, 20000));
show('compile_state', await verb('compile_state', {}, 20000));
show('build (Compile(2) = adeCtBuild)', await verb('build', {}, 200000));
show('compile_state after', await verb('compile_state', {}, 20000));
