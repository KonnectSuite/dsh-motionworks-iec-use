/**
 * Group the current 125 compiler errors, so their scope is visible.
 *
 * They all read "No matching global variable found for '<POU>:<name>'", and they name
 * TopCutterCamSetup - which compiled cleanly minutes earlier. Grouping by POU and by
 * variable shows whether this is one POU, one variable, or the whole project.
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const { verb } = mod.__internals;

const r = await verb('read_output', { pane: 'Errors', limit: 400 }, 90000);
const lines = r.lines ?? [];
console.log(`  Errors pane: ${r.count} line(s)\n`);

const byPou = new Map();
const byVar = new Map();
const other = [];
for (const l of lines) {
  const m = l.match(/No matching global variable found for '([^:]+):([^']+)'/);
  if (!m) { other.push(l); continue; }
  byPou.set(m[1], (byPou.get(m[1]) ?? 0) + 1);
  byVar.set(m[2], (byVar.get(m[2]) ?? 0) + 1);
}

console.log('  by POU:');
for (const [k, v] of [...byPou].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
console.log('\n  by variable:');
for (const [k, v] of [...byVar].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
if (other.length) {
  console.log('\n  other lines:');
  for (const l of other.slice(0, 10)) console.log(`    ${l}`);
}

// What does the project actually declare as global?
const g = await verb('compile_state', {}, 60000);
console.log(`\n  compile_state: ${JSON.stringify(g)}`);
