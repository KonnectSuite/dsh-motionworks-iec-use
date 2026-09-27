/**
 * VET EVERY WRITE OPERATION through a real open + build cycle.
 *
 * The corruption found in POU creation was invisible to stream comparison: the
 * damage was in the project tree, and the only reliable detector is whether
 * MotionWorks can OPEN the project and COMPILE it afterwards. So every operation
 * here is judged by exactly that, not by "the call returned ok".
 *
 * For each operation:
 *   1. close the IDE (writes require it)
 *   2. apply the operation
 *   3. start the IDE
 *   4. open the project
 *   5. build and read is_compiled
 *   6. report
 *
 * Run:  node test/vet_operations.mjs
 */
// Default to this checkout, but the INSTALLED copy is what DSH loads and it keeps
// its own staging root. Set MW_PLUGIN so the vetting exercises the same tree the
// tools actually act on.
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const MWT = `${STAGE}\\TopCutter.mwt`;

const line = (s) => console.log(`\n${'═'.repeat(76)}\n  ${s}\n${'═'.repeat(76)}`);
const results = [];

/** Close, write, reopen, build. Returns { applied, opens, compiled, detail }. */
async function cycle(label, writeFn) {
  line(label);
  const rec = { label, applied: null, opens: null, compiled: null, detail: '' };

  try {
    await run('mw_ide_close');
  } catch (e) { console.log(`  close: ${e.message}`); }

  try {
    const r = await writeFn();
    rec.applied = r;
    console.log(`  write : ${r}`);
  } catch (e) {
    rec.applied = `THREW: ${e.message}`;
    console.log(`  write : THREW ${e.message}`);
  }

  try {
    await run('mw_ide_start');
  } catch (e) { console.log(`  start : ${e.message}`); }

  try {
    await run('mw_ide_open', { path: MWT });
    rec.opens = true;
    console.log('  open  : OK');
  } catch (e) {
    rec.opens = false;
    rec.detail = e.message;
    console.log(`  open  : FAILED — ${e.message.split('\n')[0]}`);
  }

  if (rec.opens) {
    try {
      const b = await run('mw_ide_build');
      rec.compiled = b.is_compiled;
      console.log(`  build : is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
    } catch (e) {
      rec.compiled = `THREW: ${e.message}`;
      console.log(`  build : THREW ${e.message}`);
    }
  } else {
    rec.compiled = 'not attempted (project would not open)';
  }

  results.push(rec);
  return rec;
}

line('0. Baseline — is the staged project healthy before we start?');
try {
  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const p = await run('mw_ide_pous');
  const b = await run('mw_ide_build');
  console.log(`  POUs  : ${p.pous.length} -> ${p.pous.map((x) => x.name).join(', ')}`);
  console.log(`  build : is_compiled=${b.is_compiled}`);
} catch (e) {
  console.log(`  baseline unhealthy: ${e.message}`);
}

// ── 1. variable edit ────────────────────────────────────────────────────────
await cycle('1. mw_code_var_edit — change Counter\'s description', async () => {
  const r = await run('mw_code_var_edit', {
    pou: 'AgentProof', name: 'Counter', description: 'vetted by the harness', dry_run: false,
  });
  return `applied=${r.result.applied ?? r.result}`;
});

// ── 2. variable edit — retype ───────────────────────────────────────────────
await cycle('2. mw_code_var_edit — retype Counter DINT -> DINT (no-op type, then rename)', async () => {
  const r = await run('mw_code_var_edit', {
    pou: 'AgentProof', name: 'Counter', new_name: 'TickCount', dry_run: false,
  });
  return `applied=${r.result.applied ?? r.result}`;
});

// The body still says Counter, so this rename SHOULD break the build. That is a
// useful result: it proves the build genuinely type-checks the code.
await cycle('2b. fix the body to match the rename (Counter -> TickCount)', async () => {
  const body = [
    '(* Written by the MotionWorks Use plugin. *)',
    'TickCount := TickCount + 1;',
    '',
    'IF Running THEN',
    '\tTickCount := TickCount + 1;',
    'ELSE',
    '\tTickCount := 0;',
    'END_IF;',
    '',
  ].join('\r\n');
  const r = await run('mw_code_write_st', { pou: 'AgentProof', body, dry_run: false });
  return `applied=${r.result.applied}, siblings_verified=${r.result.siblings_verified}`;
});

// ── 3. variable delete ──────────────────────────────────────────────────────
await cycle('3. mw_code_var_delete — remove Running (body uses it, so REFUSAL expected)', async () => {
  try {
    const r = await run('mw_code_var_delete', { pou: 'AgentProof', name: 'Running', dry_run: false });
    return `applied=${r.result.applied ?? r.result}`;
  } catch (e) {
    return `refused (expected if referenced): ${e.message.split('\n')[0]}`;
  }
});

line('SUMMARY');
for (const r of results) {
  const ok = r.opens === true && r.compiled === true;
  console.log(`  ${ok ? 'PASS' : 'CHECK'}  ${r.label}`);
  console.log(`         write=${String(r.applied).slice(0, 90)}`);
  console.log(`         opens=${r.opens}  compiled=${r.compiled}`);
}
console.log('');
console.log('  PASS means: the project still OPENS and still COMPILES after the operation.');
