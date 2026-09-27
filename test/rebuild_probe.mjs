/**
 * CAN THE IDE BE TOLD TO REBUILD PROJECT?
 *
 * This plugin exposes Make (Compile 1) and Build (Compile 2). Both of its own tool
 * descriptions end with "run Build -> Rebuild Project, then Make" - advice it cannot follow,
 * because Rebuild is an IDE COMMAND rather than a compile type, and ExecuteCommand was
 * written off early as a stub.
 *
 * It is worth re-testing rather than trusting that note. The type library lists
 * adeCmdBuildRebuildProject = 36570, and the bridge has `command_id` and `command` verbs that
 * were never exercised. If either works, an agent can rebuild the project instead of telling
 * the user to.
 *
 *   R  command_id 'adeCmdBuildRebuildProject'   -> does it resolve to 36570?
 *   S  command 36570                             -> does it run?
 *   T  rebuild, then Build, and read the verdict -> does the project end up compiled?
 *
 * Run:  MW_PLUGIN=<installed> node test/rebuild_probe.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const { verb } = mod.__internals;
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const NAMES = [
  'adeCmdBuildRebuildProject',
  'adeCmdBuildMake',
  'adeCmdBuildPatchPou',
  'adeCmdBuildCompileWorksheet',
  'adeCmdBuildStopCompile',
];

console.log('\n  ══ R. command_id resolution ══');
const resolved = {};
for (const name of NAMES) {
  try {
    const r = await verb('command_id', { name }, 25000);
    resolved[name] = r?.id ?? r;
    console.log(`     ${name.padEnd(30)} -> ${JSON.stringify(r).slice(0, 90)}`);
  } catch (e) {
    console.log(`     ${name.padEnd(30)} -> FAILED: ${String(e.message).split('\n')[0].slice(0, 80)}`);
  }
}

try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_close');

console.log('\n  ══ S. does the command run? ══');
let ran = false;
for (const name of NAMES) {
  const id = resolved[name];
  if (typeof id !== 'number') continue;
  try {
    const r = await verb('command', { id }, 60000);
    console.log(`     command ${name} (${id}) -> ${JSON.stringify(r).slice(0, 130)}`);
    ran = true;
  } catch (e) {
    console.log(`     command ${name} (${id}) -> FAILED: ${String(e.message).split('\n')[0].slice(0, 110)}`);
  }
}
if (!ran) console.log('     no command id resolved to a number, so nothing was sent');

console.log('\n  ══ T. end state: open, then build ══');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b = await run('mw_ide_build');
const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
console.log(`     is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);

console.log(`\n${'═'.repeat(78)}`);
console.log('  VERDICT');
console.log('═'.repeat(78));
console.log(ran
  ? '  At least one command was accepted - see the responses above for what it did.'
  : '  ExecuteCommand remains unusable, so Rebuild cannot be driven and the advice stands:');
if (!ran) console.log('  the agent must ask the user to run Build -> Rebuild Project.');
await run('mw_ide_close').catch(() => {});
