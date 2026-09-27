/**
 * VET THE DELETIONS through real open + build cycles.
 *
 * Deleting is the operation with the most ways to leave a project inconsistent:
 * a POU's directory, its LIST.POU entry, its records in PROJECT.TRE and its task
 * assignments all have to go together, and the corruption that was found in CREATE
 * (missing blank separators in the tree records) came from exactly this kind of
 * record surgery. So each delete is judged only by whether MotionWorks can still
 * open and compile the project afterwards.
 *
 * Run:  MW_PLUGIN=<installed> node test/vet_deletes.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const MWT = `${mod.__internals.STAGE_ROOT}\\TopCutter.mwt`;

const line = (s) => console.log(`\n${'═'.repeat(76)}\n  ${s}\n${'═'.repeat(76)}`);
const results = [];

async function cycle(label, writeFn) {
  line(label);
  const rec = { label, write: null, opens: null, compiled: null };
  try { await run('mw_ide_close'); } catch (e) { console.log(`  close : ${e.message}`); }
  try { rec.write = await writeFn(); console.log(`  write : ${rec.write}`); }
  catch (e) { rec.write = `THREW: ${e.message.split('\n')[0]}`; console.log(`  write : THREW ${e.message.split('\n')[0]}`); }
  try { await run('mw_ide_start'); } catch (e) { console.log(`  start : ${e.message}`); }
  try { await run('mw_ide_open', { path: MWT }); rec.opens = true; console.log('  open  : OK'); }
  catch (e) { rec.opens = false; console.log(`  open  : FAILED — ${e.message.split('\n')[0]}`); }
  if (rec.opens) {
    try {
      const b = await run('mw_ide_build');
      rec.compiled = b.is_compiled;
      console.log(`  build : is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
    } catch (e) { rec.compiled = `THREW: ${e.message.split('\n')[0]}`; console.log(`  build : THREW ${e.message.split('\n')[0]}`); }
  } else { rec.compiled = 'not attempted'; }
  results.push(rec);
  return rec;
}

line('State before we start');
try {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const p = await run('mw_ide_pous');
  console.log(`  POUs: ${p.pous.length} -> ${p.pous.map((x) => x.name).join(', ')}`);
} catch (e) { console.log(`  ${e.message.split('\n')[0]}`); }

// ── A. variable delete, forced (the body must not use it afterwards) ────────
await cycle('A. mw_code_var_delete force — remove Running after unpicking the body', async () => {
  const body = [
    '(* Written by the MotionWorks Use plugin. *)',
    'TickCount := TickCount + 1;',
    '',
  ].join('\r\n');
  await run('mw_code_write_st', { pou: 'AgentProof', body, dry_run: false });
  const r = await run('mw_code_var_delete', { pou: 'AgentProof', name: 'Running', force: true, dry_run: false });
  return `body rewritten without Running; var_delete applied=${r.result?.applied ?? r.result}`;
});

// ── B. read back what remains ───────────────────────────────────────────────
line('B. read the declarations back after the delete');
try {
  const rd = await run('mw_code_read_st', { pou: 'AgentProof' });
  console.log(`  declarations: ${(rd.variables ?? []).map((v) => `${v.name}:${v.type}`).join(', ') || '(none)'}`);
} catch (e) { console.log(`  ${e.message.split('\n')[0]}`); }

// ── C. delete the whole POU ─────────────────────────────────────────────────
await cycle('C. mw_code_pou_delete — remove AgentProof entirely', async () => {
  const r = await run('mw_code_pou_delete', { name: 'AgentProof', dry_run: false });
  return `archived to ${r.result?.archived_to ?? JSON.stringify(r.result).slice(0, 80)}`;
});

// ── D. confirm the POU set is back to the original seven ────────────────────
line('D. confirm the project is back to its original POU set');
try {
  const p = await run('mw_ide_pous');
  console.log(`  POUs: ${p.pous.length} -> ${p.pous.map((x) => x.name).join(', ')}`);
} catch (e) { console.log(`  ${e.message.split('\n')[0]}`); }

line('SUMMARY');
for (const r of results) {
  const ok = r.opens === true && r.compiled === true;
  console.log(`  ${ok ? 'PASS ' : 'CHECK'}  ${r.label}`);
  console.log(`         write=${String(r.write).slice(0, 88)}`);
  console.log(`         opens=${r.opens}  compiled=${r.compiled}`);
}
