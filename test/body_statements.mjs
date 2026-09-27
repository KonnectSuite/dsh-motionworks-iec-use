/**
 * DOES ANY STATEMENT IN A BODY STALL THE BUILD?
 *
 * The previous test changed what this whole investigation is about. Case Q added a global and
 * used it - stalled, expected. Case S used PLCMODE_ON, a SYSTEM GLOBAL that was in the
 * project from the first byte and that nobody touched - and it stalled too. A variable that
 * MotionWorks itself created cannot be missing from a grid.
 *
 * So either the rule is not about declarations at all, or these body edits are broken in some
 * way that a comment does not trigger. The earlier evidence supports the second reading:
 *   - appending a COMMENT to a body          PASSED (rounds 10 and 12)
 *   - appending an ASSIGNMENT to a body      FAILED  (rounds 12, 13, 17, and case Q/S here)
 * and every failing case so far has appended an ASSIGNMENT.
 *
 * This separates the two, using only variables that already exist and are already in every
 * grid, so nothing about declarations can explain a failure:
 *
 *   T  append a self-assignment to an existing local BOOL   xGenerate := xGenerate;
 *   U  append a self-assignment to an existing local INT    iState := iState;
 *   V  append a COMMENT only                                (control, should pass)
 *   W  append a self-assignment to an existing EXTERNAL     TopCutterCamReady := ...;
 *
 * If T and U stall, the limitation is far larger than declarations: this plugin cannot write
 * a statement into a POU body at all, and that is the single most important thing an agent
 * needs to do. If they pass, the stall is specific to variables that are not in a grid - and
 * then PLCMODE_ON needs explaining separately.
 *
 * Run:  MW_PLUGIN=<installed> node test/body_statements.mjs
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
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const POU = 'TopCutterCamSetup';
const results = [];

async function kase(label, statement) {
  console.log(`\n  ── ${label}`);
  try { await run('mw_ide_close'); } catch { /* not running */ }
  for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
  await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
  await run('mw_ide_close');

  const before = await run('mw_code_read_st', { pou: POU });
  const body = before.body.replace(/\s+$/, '') + NL + statement + NL;
  const w = await run('mw_code_write_st', { pou: POU, body, dry_run: false });
  const after = await run('mw_code_read_st', { pou: POU });
  const applied = w.result?.applied === true;
  const roundTrips = after.body === body;
  console.log(`     wrote: ${JSON.stringify(statement.slice(0, 52))}`);
  console.log(`     applied=${applied} roundTrips=${roundTrips} bodyLen=${(after.body ?? '').length}`);

  await run('mw_ide_start');
  await run('mw_ide_open', { path: MWT });
  const b = await run('mw_ide_build');
  const e = await run('mw_ide_errors', { pane: 'Errors', limit: 200 });
  const real = (e.lines ?? []).filter((l) => /not found|No matching|undeclared|unknown|invalid/i.test(l));
  console.log(`     build: is_compiled=${b.is_compiled} stalled=${b.stalled} (${b.elapsed_s}s) real=${real.length}`);
  for (const l of real.slice(0, 4)) console.log(`       ${l}`);
  results.push({ label, applied, compiled: b.is_compiled, stalled: !!b.stalled, real: real.length });
  await run('mw_ide_close');
}

await kase('T. local BOOL self-assignment (xGenerate)', '(* probe *) xGenerate := xGenerate;');
await kase('U. local INT self-assignment (iState)', '(* probe *) iState := iState;');
await kase('V. comment only (control)', '(* probe: comment only, no statement *)');
await kase('W. external BOOL self-assignment (TopCutterCamReady)', '(* probe *) TopCutterCamReady := TopCutterCamReady;');

console.log(`\n${'═'.repeat(100)}`);
console.log('  RESULT');
console.log('═'.repeat(100));
for (const r of results) {
  const ok = r.compiled === true && r.real === 0;
  console.log(`  ${ok ? 'PASS ' : 'FAIL '} ${r.label.slice(0, 48).padEnd(50)} applied=${String(r.applied).padEnd(5)} `
    + `compiled=${String(r.compiled).padEnd(5)} stalled=${String(r.stalled).padEnd(5)} real=${r.real}`);
}
const t = results.find((r) => r.label.startsWith('T'));
const v = results.find((r) => r.label.startsWith('V'));
console.log('');
if (t?.stalled && v?.compiled) {
  console.log('  *** A STATEMENT IN A BODY STALLS; A COMMENT DOES NOT. ***');
  console.log('  That is far larger than the declaration problem: writing a statement is the single');
  console.log('  most important thing an agent does, and it does not work. This becomes the priority.');
} else if (t?.compiled === true && t.real === 0) {
  console.log('  A statement to an EXISTING variable is fine. So the stall is specific to variables');
  console.log('  that are not in a grid - and PLCMODE_ON needs explaining separately, because it is');
  console.log('  a system global that MotionWorks itself created.');
} else {
  console.log('  see the table above.');
}
