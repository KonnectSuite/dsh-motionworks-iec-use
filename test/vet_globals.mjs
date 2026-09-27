/**
 * VET GLOBAL VARIABLES through a real open + build cycle.
 *
 * mw_code_var_add/edit/delete take an optional `pou`; omitting it targets a
 * project-global declaration, which is a different code path (the resource .VGR grid
 * rather than a POU's own declaration stream). Nothing has exercised it yet, and it is
 * the mechanism an agent needs to add a tag that several POUs share.
 *
 * Run:  MW_PLUGIN=<installed> node test/vet_globals.mjs
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
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

const SOURCES = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean);
const SOURCE = SOURCES.find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }
console.log(`source: ${SOURCE}`);

const GLOBAL = 'AgentGlobalTag';

async function cycle(label, fn) {
  line(label);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  let wrote;
  try { wrote = await fn(); console.log(`  write : ${wrote}`); }
  catch (e) { wrote = `THREW: ${e.message.split('\n')[0]}`; console.log(`  write : ${wrote}`); }
  try { await run('mw_ide_start'); } catch (e) { console.log(`  start : ${e.message.split('\n')[0]}`); }
  let opens = false;
  try { await run('mw_ide_open', { path: MWT }); opens = true; console.log('  open  : OK'); }
  catch (e) { console.log(`  open  : FAILED — ${e.message.split('\n')[0]}`); }
  let compiled = 'not attempted';
  if (opens) {
    try { const b = await run('mw_ide_build'); compiled = b.is_compiled; console.log(`  build : is_compiled=${compiled}`); }
    catch (e) { compiled = `THREW: ${e.message.split('\n')[0]}`; console.log(`  build : ${compiled}`); }
  }
  return { label, wrote, opens, compiled };
}

const results = [];

line('1. fresh stage');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });

results.push(await cycle(`2. add a GLOBAL variable '${GLOBAL}' (no pou given)`, async () => {
  const r = await run('mw_code_var_add', { name: GLOBAL, type: 'BOOL', section: 'VAR_GLOBAL', dry_run: false });
  return `applied=${r.result?.applied ?? JSON.stringify(r.result).slice(0, 90)}`;
}));

line('3. is it visible in the LIVE variable model?');
try {
  const vars = await run('mw_ide_variables');
  const all = (vars.pous ?? []).flatMap((p) => (p.variables ?? []).map((v) => `${p.pou}.${v.name}`));
  const hit = all.filter((n) => n.includes(GLOBAL));
  console.log(`  ${all.length} live declarations; matching '${GLOBAL}': ${hit.length ? hit.join(', ') : '(none)'}`);
} catch (e) { console.log(`  ${e.message.split('\n')[0]}`); }

results.push(await cycle(`4. delete the global variable '${GLOBAL}'`, async () => {
  const r = await run('mw_code_var_delete', { name: GLOBAL, force: true, dry_run: false });
  return `applied=${r.result?.applied ?? JSON.stringify(r.result).slice(0, 90)}`;
}));

line('SUMMARY');
for (const r of results) {
  const ok = r.opens === true && r.compiled === true;
  console.log(`  ${ok ? 'PASS ' : 'CHECK'}  ${r.label}`);
  console.log(`         ${String(r.wrote).slice(0, 84)}`);
  console.log(`         opens=${r.opens}  compiled=${r.compiled}`);
}
