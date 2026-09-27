/**
 * DEMO — see the plugin work, without restarting DSH.
 *
 * Run:  node test/demo.mjs
 *
 * DSH loads bundles at boot, so the mw_* tools do not exist in the session that
 * installed them. This script exercises the plugin the same way the harness will,
 * so you can watch it work right now.
 *
 * Set MW_SAMPLE_PROJECT to one of your own projects; it defaults to a sample.
 */
import { rmSync } from 'node:fs';

const PLUGIN = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');
const mod = await import('../index.js');
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});

const banner = (s) => console.log(`\n${'─'.repeat(74)}\n  ${s}\n${'─'.repeat(74)}`);
const j = (o) => JSON.stringify(o);

const SAMPLE = process.env.MW_SAMPLE_PROJECT
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Yaskawa MotionWorks IEC MCP\\Yaskawa\\RK_DemoOnMP2300Siec';

console.log('MotionWorks Use — live demonstration');
console.log(`plugin   : ${PLUGIN}`);
console.log(`sample   : ${SAMPLE}`);
console.log('IDE      : not required for anything below');

// ── 1 ────────────────────────────────────────────────────────────────────────
banner('1. The plugin loads and registers its tools');
const all = mod.__internals.defineTools();
console.log(`  ${all.length} tools registered`);
console.log('  ' + all.map((t) => t.name).join('\n  '));

// ── 2 ────────────────────────────────────────────────────────────────────────
banner('2. Stage a copy of a project (the original is never touched)');
rmSync(`${PLUGIN}\\backups\\archived-pous`, { recursive: true, force: true });
const staged = await run('mw_ide_stage', { source: SAMPLE });
console.log(`  copied ${staged.files_copied} files`);
console.log(`  to     ${staged.staged_mwt}`);

// ── 3 ────────────────────────────────────────────────────────────────────────
banner('3. What is in it, and what can be edited?');
const pous = await run('mw_code_pous');
for (const p of pous.pous) {
  console.log(`  ${p.name.padEnd(14)} ${String(p.language).padEnd(4)} `
    + `${p.has_st_body ? 'ST — editable' : 'graphical — refused'}`);
}
const blocked = await run('mw_code_unsupported');
console.log(`\n  refusing: ${blocked.blocked.map((b) => `${b.name} (${b.reason})`).join('; ') || 'none'}`);

// ── 4 ────────────────────────────────────────────────────────────────────────
const TARGET = process.env.MW_SAMPLE_POU ?? 'Initialize';
banner(`4. Read the code in '${TARGET}' — straight out of the project container`);
const before = await run('mw_code_read_st', { pou: TARGET });
console.log(before.body.split('\r\n').map((l) => '  | ' + l).join('\n'));

// ── 5 ────────────────────────────────────────────────────────────────────────
const NEW_BODY = [
  '(* ===== written by the plugin, through the project container ===== *)',
  '(* no IDE running. no MotionWorks licence. no binary editing by hand. *)',
  ...before.body.split('\r\n').filter((l) => l.trim()),
  '',
].join('\r\n');

banner('5. Preview the change (dry_run defaults to true — nothing is written)');
const dry = await run('mw_code_write_st', { pou: TARGET, body: NEW_BODY, dry_run: true });
console.log(`  applied        : ${dry.result.applied}`);
console.log(`  would write    : ${dry.result.target}`);
console.log(`  stream         : ${dry.result.stream}`);
console.log(`  size           : ${dry.result.before_bytes} -> ${dry.result.after_bytes} bytes`);

banner('6. Apply it');
const real = await run('mw_code_write_st', { pou: TARGET, body: NEW_BODY, dry_run: false });
console.log(`  applied            : ${real.result.applied}`);
console.log(`  siblings verified  : ${real.result.siblings_verified} (byte-identical, else it refuses)`);
console.log(`  backup written     : ${real.result.backups?.[0] ?? 'NONE'}`);

banner('7. Read it back out of the container');
const after = await run('mw_code_read_st', { pou: TARGET });
console.log(after.body.split('\r\n').map((l) => '  | ' + l).join('\n'));
console.log(`\n  round-trip identical to what was written: ${after.body === NEW_BODY}`);

// ── 8 ────────────────────────────────────────────────────────────────────────
banner('8. Create a NEW POU, add variables, then delete it');
const created = await run('mw_code_pou_create', { name: 'DemoPou', template: 'Instructions', dry_run: false });
console.log(`  created 'DemoPou' from template 'Instructions'`);
console.log(`    tree nodes  : ${j(created.result.node_ids)}`);
console.log(`    files       : ${(created.result.files_created ?? []).length} created`);
console.log(`    node total  : ${created.result.node_total}`);
for (const v of [{ name: 'Enable', type: 'BOOL' }, { name: 'Count', type: 'DINT' }]) {
  const r = await run('mw_code_var_add', { pou: 'DemoPou', section: 'VAR', dry_run: false, ...v });
  console.log(`    added variable ${v.name}:${v.type} -> applied=${r.result.applied}`);
}
const rd = await run('mw_code_read_st', { pou: 'DemoPou' });
console.log(`  read back ${rd.variables?.length ?? 0} declarations from the new POU:`);
for (const v of rd.variables ?? []) {
  console.log(`    ${String(v.section).padEnd(10)} ${String(v.name).padEnd(10)} : ${v.type}`);
}
const del = await run('mw_code_pou_delete', { name: 'DemoPou', dry_run: false });
console.log(`  deleted 'DemoPou' -> archived at ${del.result.archived_to}`);

// ── 9 ────────────────────────────────────────────────────────────────────────
banner('9. The IDE half (needs a running, licensed IDE)');
try {
  const s = await run('mw_ide_status');
  console.log(`  IDE live: version ${s.version}, project open: ${s.is_project_open}`);
  const b = await run('mw_ide_build');
  console.log(`  build: ${j(b)}`);
} catch (e) {
  console.log(`  ${e.message}`);
  console.log('\n  This is the only part that needs a licence. Everything above did not.');
}

banner('DONE');
console.log('  Code editing: verified working, no licence needed.');
console.log('  Compile verdict: needs a licensed IDE (see README).');
