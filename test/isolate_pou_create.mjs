/**
 * ISOLATE: does creating a POU from an ST template break the build?
 *
 * The end-to-end run failed with 125 "No matching global variable found" errors after
 * it created a POU, while the same project compiled clean before. The globals
 * themselves are provably unchanged (161 declarations, identical groups in staged vs
 * original), so the suspect is POU creation - specifically pou_writer's
 * _convert_external_variables step, which rewrites external variable records.
 *
 * Controlled: build clean, create ONE POU, build again. Nothing else changes.
 *
 * Run:  MW_PLUGIN=<installed> node test/isolate_pou_create.mjs
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
const line = (s) => console.log(`\n${'─'.repeat(74)}\n  ${s}\n${'─'.repeat(74)}`);

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const TEMPLATE = process.argv[2] ?? 'TopCutterCamSetup';
const NEW = process.argv[3] ?? 'IsolatePou';

line('1. fresh stage, then build with NOTHING changed');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
try { rmSync(`${PLUGIN}\\backups\\archived-pous\\${NEW}`, { recursive: true, force: true }); } catch { /* absent */ }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b1 = await run('mw_ide_build');
console.log(`  baseline build: is_compiled=${b1.is_compiled} (${b1.elapsed_s}s)`);

function countErrors(lines) {
  return (lines ?? []).filter((l) => /No matching global variable|not declared|undefined/i.test(l)).length;
}
const e1 = await run('mw_ide_errors', { pane: 'Errors' });
console.log(`  baseline Errors: ${e1.count} line(s), ${countErrors(e1.lines)} reference problems`);

line(`2. create ONE POU from '${TEMPLATE}' — nothing else`);
await run('mw_ide_close');
const created = await run('mw_code_pou_create', { name: NEW, template: TEMPLATE, dry_run: false });
console.log(`  created '${NEW}' (nodes ${JSON.stringify(created.result?.node_ids)})`);

// Optional extra steps, so the SAME harness can bisect which one breaks the build.
const NL = String.fromCharCode(13) + String.fromCharCode(10);
if (process.env.STEP_VARS === '1') {
  for (const v of [{ name: 'ScanCount', type: 'DINT' }, { name: 'LastScan', type: 'DINT' }]) {
    const r = await run('mw_code_var_add', { pou: NEW, name: v.name, type: v.type, section: 'VAR', dry_run: false });
    console.log(`  added ${NEW}.${v.name}:${v.type} applied=${r.result?.applied}`);
  }
}
if (process.env.STEP_BODY === '1') {
  const body = ['(* isolate probe *)', 'LastScan := ScanCount;', 'ScanCount := ScanCount + 1;', ''].join(NL);
  const r = await run('mw_code_write_st', { pou: NEW, body, dry_run: false });
  console.log(`  wrote body applied=${r.result?.applied}`);
}
if (process.env.STEP_GLOBAL === '1') {
  const r = await run('mw_code_var_add', { name: 'DiagEnabled', type: 'BOOL', section: 'VAR_GLOBAL', initial_value: 'TRUE', dry_run: false });
  console.log(`  added global DiagEnabled applied=${r.result?.applied}`);
}
if (process.env.STEP_ASSIGN === '1') {
  const r = await run('mw_code_pou_assign', { task: 'SlowTsk', pou: NEW, dry_run: false });
  console.log(`  assigned ${NEW} to SlowTsk ok=${!!r.result}`);
}

line('3. build again — same project, one extra POU');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const b2 = await run('mw_ide_build');
console.log(`  build: is_compiled=${b2.is_compiled} (${b2.elapsed_s}s)`);
const e2 = await run('mw_ide_errors', { pane: 'Errors' });
console.log(`  Errors: ${e2.count} line(s), ${countErrors(e2.lines)} reference problems`);
for (const l of (e2.lines ?? []).slice(0, 4)) console.log(`      ${l}`);

line('VERDICT');
console.log(`  before: compiled=${b1.is_compiled}, reference problems=${countErrors(e1.lines)}`);
console.log(`  after : compiled=${b2.is_compiled}, reference problems=${countErrors(e2.lines)}`);
if (b1.is_compiled === true && b2.is_compiled === false) {
  console.log(`\n  CREATING A POU FROM '${TEMPLATE}' BREAKS THE BUILD.`);
  console.log('  The clone carries the template\'s EXTERNAL variable records, and');
  console.log('  pou_writer converts them - so the conversion is the suspect.');
} else if (b2.is_compiled === true) {
  console.log('\n  creation is CLEAN for this template.');
} else {
  console.log('\n  the baseline was already failing, so this run proves nothing - rerun.');
}
