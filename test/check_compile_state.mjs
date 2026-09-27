/**
 * Is the project actually compiled, or did my 90s poll simply give up?
 *
 * A build that returns is_compiled=false after exactly 90.5s is suspicious: 90s is the
 * client-side poll window, so it may be reporting "I stopped waiting" rather than
 * "the compiler failed". is_modified distinguishes them - a project that is still
 * building, or that was left mid-compile, tells a different story from one the
 * compiler rejected.
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

const st = await verb('compile_state', {}, 60000);
console.log(`  compile_state: ${JSON.stringify(st)}`);

const st2 = await verb('status', {}, 60000);
console.log(`  status       : is_project_open=${st2.is_project_open} active=${st2.active_project}`);

// Ask again after a wait, to see whether the compiler was still working.
await new Promise((r) => setTimeout(r, 15000));
const st3 = await verb('compile_state', {}, 60000);
console.log(`  +15s         : ${JSON.stringify(st3)}`);

console.log('');
if (st.is_compiled === true) {
  console.log('  The project IS compiled - the build SUCCEEDED and my 90s poll gave up early.');
} else if (st.is_compiled === false && st.is_modified === false) {
  console.log('  compiled=false, modified=false: the compiler finished and REJECTED it.');
} else {
  console.log('  compiled=false, modified=true: the build is still outstanding.');
}
