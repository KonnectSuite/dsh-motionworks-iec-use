/**
 * Is a STALE per-POU compiler table what stalls a declaration?
 *
 * Every earlier round treated the .VB text and the .VGR grid as the whole story. They are
 * not - the resource directory also holds per-POU tables that name the POU's variables in
 * readable form:
 *
 *   ICI00035V.DBD   546 bytes   every variable name, in order:
 *                               TopCutterCamTableID, TopCutterCamReady, ..., xGenerate,
 *                               xSelect, iState, TopCutterEyeToKnifeDistance
 *   ICI00035.DIT    939 bytes   a text interface: "T: PROGRAM TopCutterCamSetup", "QVE: 13",
 *                               then per variable "@V 1 6 0 / <name> / VAR_EXTERNAL / @TYP:7"
 *
 * whose header decodes as 3 x uint32, a count of 0x0a = 10, then per entry two uint32 and a
 * one-byte length with an ASCII name (0x13 = 19 for TopCutterCamTableID).
 *
 * Round 13 established that adding a declaration and USING it STALLS the build with the POU
 * intact. If the compiler trusts these tables rather than rebuilding them, an entry missing
 * from them is exactly such a stall - and they are ORDINARY FILES, not streams inside a
 * container, so they can be rewritten or removed with no binary surgery at all.
 *
 *   M  declaration + the POU's ICI files REMOVED, then USED   -> does it rebuild them?
 *   N  declaration + the ICI files left alone, then USED      -> the known stall, control
 *   P  declaration + ICI files removed, NOT used              -> control
 *
 * Run:  MW_PLUGIN=<installed> node test/ici_cache.mjs
 */
import { existsSync, rmSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const RES = `${DIR}\\C\\Configuration\\R\\Resource`;
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const results = [];

/** The ICI files that belong to this POU: its .DIT names it, its V.DBD lists its variables. */
function iciFilesForPou() {
  const all = readdirSync(RES).filter((f) => /^ICI\d+/i.test(f));
  const mine = [];
  for (const f of all) {
    if (/\.DIT$/i.test(f)) {
      try {
        const txt = readFileSync(`${RES}\\${f}`, 'latin1');
        if (txt.includes(`PROGRAM ${POU}`) || txt.includes(`FUNCTION_BLOCK ${POU}`)) {
          const base = f.replace(/\.DIT$/i, '');
          mine.push(...all.filter((g) => g.toUpperCase().startsWith(base.toUpperCase())));
        }
      } catch (err) { console.log(`     (unreadable ${f}: ${err.code})`); }
    }
  }
  return [...new Set(mine)];
}

async function kase(label, removeIci, useIt) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');

  const add = await run('mw_code_var_add', {
    pou: POU, name: 'ZZIciProbe', type: 'BOOL', section: 'VAR',
    initial_value: 'FALSE', dry_run: false,
  });
  console.log(`     declared: applied=${add.result?.applied}`);

  if (removeIci) {
    const mine = iciFilesForPou();
    const backup = `${DIR}\\.ici-backup`;
    mkdirSync(backup, { recursive: true });
    for (const f of mine) {
      copyFileSync(`${RES}\\${f}`, `${backup}\\${f}`);
      rmSync(`${RES}\\${f}`, { force: true });
    }
    console.log(`     removed ${mine.length} ICI file(s): ${mine.slice(0, 8).join(', ')}${mine.length > 8 ? ' ...' : ''}`);
  } else {
    console.log(`     ICI files left in place (${iciFilesForPou().length} for this POU)`);
  }

  if (useIt) {
    const r = await run('mw_code_read_st', { pou: POU });
    const body = r.body.replace(/\s+$/, '') + `${NL}(* uses it *)${NL}ZZIciProbe := NOT ZZIciProbe;${NL}`;
    await run('mw_code_write_st', { pou: POU, body, dry_run: false });
    console.log('     body uses it');
  }

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching global/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 3)) console.log(`       ${l}`);

  const after = iciFilesForPou();
  const vdbd = after.find((f) => /V\.DBD$/i.test(f));
  let hasNew = false;
  if (vdbd) {
    try {
      hasNew = readFileSync(`${RES}\\${vdbd}`, 'latin1').includes('ZZIciProbe');
    } catch (err) { console.log(`     (V.DBD read failed: ${err.code})`); }
  }
  console.log(`     ICI after: ${after.length} file(s); new variable present in ${vdbd ?? 'no V.DBD'}: ${hasNew}`);

  results.push({ label, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length, ici: after.length, hasNew });
  await run('mw_ide_close');
}

await kase('M. declaration + ICI removed, then USED', true, true);
await kase('N. declaration + ICI left alone, then USED (control)', false, true);
await kase('P. declaration + ICI removed, NOT used', true, false);

console.log(`\n${'═'.repeat(96)}`);
console.log('  RESULT');
console.log('═'.repeat(96));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 44).padEnd(46)} compiled=${String(r.compiled).padEnd(5)} `
    + `stalled=${String(r.stalled).padEnd(5)} real=${r.real} ici=${r.ici} newVarInTable=${r.hasNew}`);
}
const m = results.find((r) => r.label.startsWith('M'));
console.log('');
if (m?.compiled === true && m.real === 0) {
  console.log('  *** THE PER-POU TABLES WERE THE BLOCKER. ***');
  console.log('  A declaration is USABLE once the stale tables are removed and the IDE rebuilds them.');
} else if (m?.compiled === true) {
  console.log('  the build completed but reported problems - look at the lines above.');
} else {
  console.log('  removing the tables does not help - the .VGR grid still governs.');
  console.log('  Compare the ici / newVarInTable columns: if the IDE regenerated them WITH the new');
  console.log('  variable, the tables are an output and something else causes the stall.');
}
