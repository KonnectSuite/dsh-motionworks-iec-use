/**
 * END-TO-END: do a realistic job the way a user would ask for it.
 *
 * Everything here is a tool the agent actually has. The task:
 *
 *   "Add a diagnostic POU that counts PLC scans, exposes a global enable flag,
 *    and only counts while that flag is set. Then prove it compiles."
 *
 * That exercises stage -> discover -> read globals -> read code -> create -> assign ->
 * declare -> write -> open -> build -> read messages -> delete, in the order a real
 * request would, and it is judged by whether MotionWorks compiles the result.
 *
 * Run:  MW_PLUGIN=<installed> node test/e2e_workflow.mjs
 */
import { existsSync, rmSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;

const step = (n, s) => console.log(`\n${'─'.repeat(74)}\n  ${n}. ${s}\n${'─'.repeat(74)}`);
const SOURCES = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean);
const SOURCE = SOURCES.find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'DiagCounter';
const FLAG = 'DiagEnabled';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

step(0, 'stage a working copy (never the original)');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${POU}`, { recursive: true, force: true }); } catch { /* absent */ }
const staged = await run('mw_ide_stage', { source: SOURCE });
check(staged.files_copied > 500, `staged ${staged.files_copied} files from the original`);

step(1, 'discover what is there');
const pous = await run('mw_code_pous');
console.log(`  POUs: ${pous.pous.map((p) => `${p.name}[${p.language}]`).join(', ')}`);
const editable = pous.pous.filter((p) => p.has_st_body);
check(editable.length > 0, `${editable.length} ST-editable POU(s), ${pous.pous.length - editable.length} graphical (refused)`);
const blocked = await run('mw_code_unsupported');
console.log(`  not editable: ${blocked.blocked.map((b) => b.name).join(', ') || '(none)'}`);
const tasks = await run('mw_code_tasks');
console.log(`  tasks: ${Object.entries(tasks.tasks).map(([t, ps]) => `${t}(${ps.length})`).join(' ')}`);
check(tasks.unassigned.length === 0, `nothing unassigned initially (${tasks.unassigned.join(', ') || 'none'})`);

step(2, 'look at the tags and the code we will sit beside');
const globals = await run('mw_code_globals');
console.log(`  ${globals.count} globals; sample: ${globals.variables.slice(0, 4).map((v) => v.name).join(', ')}`);
check(globals.count > 0, 'globals are visible to the agent');
const template = editable.find((p) => p.language === 'ST');
const before = await run('mw_code_read_st', { pou: template.name });
console.log(`  reading '${template.name}' (${before.body?.length ?? 0} chars, ${(before.variables ?? []).length} declarations)`);
check((before.variables ?? []).length > 0, 'the live declaration list is readable');

step(3, 'write the change (IDE must be closed)');
await run('mw_ide_close');
const created = await run('mw_code_pou_create', { name: POU, template: template.name, dry_run: false });
check(!!created.result?.node_ids, `created POU '${POU}' (nodes ${JSON.stringify(created.result?.node_ids)})`);
const g = await run('mw_code_var_add', {
  name: FLAG, type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'TRUE', dry_run: false,
});
check(g.result?.applied === true, `declared global '${FLAG}'`);
for (const v of [{ name: 'ScanCount', type: 'DINT' }, { name: 'LastScan', type: 'DINT' }]) {
  const r = await run('mw_code_var_add', { pou: POU, name: v.name, type: v.type, section: 'VAR', dry_run: false });
  check(r.result?.applied === true, `declared ${POU}.${v.name}:${v.type}`);
}
const BODY = [
  '(* Diagnostic scan counter, written through the plugin. *)',
  'LastScan := ScanCount;',
  '',
  'IF DiagEnabled THEN',
  '\tScanCount := ScanCount + 1;',
  'END_IF;',
  '',
].join('\r\n');
const wrote = await run('mw_code_write_st', { pou: POU, body: BODY, dry_run: false });
check(wrote.result?.applied === true, `wrote the body (${wrote.result?.before_bytes} -> ${wrote.result?.after_bytes} bytes, ${wrote.result?.siblings_verified} siblings verified)`);
const readBack = await run('mw_code_read_st', { pou: POU });
check(readBack.body === BODY, 'the body round-trips exactly');
const decls = (readBack.variables ?? []).map((v) => `${v.name}:${v.type}`);
check(decls.some((d) => d.startsWith('ScanCount')), `declarations read back: ${decls.join(', ')}`);
const globalNow = await run('mw_code_globals');
check(globalNow.variables.some((v) => v.name === FLAG), `'${FLAG}' is now visible in the global list`);

step(4, 'assign it, or it is inert');
const assigned = await run('mw_code_pou_assign', { task: 'SlowTsk', pou: POU, dry_run: false });
check(!!assigned.result, `assigned '${POU}' to SlowTsk`);
const tasks2 = await run('mw_code_tasks');
check(tasks2.unassigned.length === 0, `still nothing unassigned (${tasks2.unassigned.join(', ') || 'none'})`);
check((tasks2.tasks.SlowTsk ?? []).includes(POU), `SlowTsk now calls: ${(tasks2.tasks.SlowTsk ?? []).join(', ')}`);

step(5, 'open it in MotionWorks and BUILD');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const live = await run('mw_ide_pous');
check(live.pous.some((p) => p.name === POU), `the live model sees ${live.pous.length} POUs incl. '${POU}'`);
const build = await run('mw_ide_build');
console.log(`  build: is_compiled=${build.is_compiled} (${build.elapsed_s}s)`);
check(build.is_compiled === true, 'MotionWorks compiled the agent-authored POU');

step(6, 'read the compiler messages as text');
const errs = await run('mw_ide_errors', { pane: 'Errors' });
console.log(`  Errors pane: ${errs.count} line(s)`);
for (const l of (errs.lines ?? []).slice(0, 6)) console.log(`    ${l}`);
const realErrors = (errs.lines ?? []).filter((l) => /error/i.test(l) && !/Redundant|padding/i.test(l));
check(realErrors.length === 0, `no real error lines (${realErrors.length})`);
const warns = await run('mw_ide_errors', { pane: 'Warnings' });
console.log(`  Warnings pane: ${warns.count} line(s)`);

step(7, 'tidy up: remove the POU and the global');
await run('mw_ide_close');
const del = await run('mw_code_pou_delete', { name: POU, dry_run: false });
check(!!del.result, `deleted '${POU}' (archived)`);
const dg = await run('mw_code_var_delete', { name: FLAG, force: true, dry_run: false });
check(dg.result?.applied === true, `removed global '${FLAG}'`);
const finalPous = await run('mw_code_pous');
check(!finalPous.pous.some((p) => p.name === POU), `POU set back to ${finalPous.pous.length}`);

step(8, 'the project must still open and compile after all of that');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const finalBuild = await run('mw_ide_build');
check(finalBuild.is_compiled === true, 'the project still compiles after the whole workflow');

console.log(`\n${'═'.repeat(74)}`);
console.log(failures === 0
  ? '  END-TO-END PASS - every step of a realistic request worked through the tools,'
    + '\n  and MotionWorks compiled both the change and the reverted project.'
  : `  END-TO-END: ${failures} check(s) failed.`);
console.log('═'.repeat(74));
process.exit(failures === 0 ? 0 : 1);
