/**
 * The full coding loop, through the plugin's own tools:
 *
 *   read code  ->  close IDE  ->  write code  ->  reopen  ->  build  ->  read errors
 *
 * This is the thing that makes the plugin useful for an engineering IDE.
 */
const mod = await import('../index.js');

const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (name, args = {}) => tools.get(name).execute(args, {});

const NEW_BODY = [
  '(* MotionWorks Use: agent edit *)',
  'Axis1.AxisNum := UINT#1;',
  'Axis2.AxisNum := UINT#2;',
  'AXIS26.AxisNum := UINT#26;',
  '',
].join('\r\n');

// Point this at any MotionWorks project directory you own — a folder containing
// `<Name>.mwt` plus the matching expanded `<Name>/` folder. Nothing here touches
// the original: mw_ide_stage only copies.
const SAMPLE = process.env.MW_SAMPLE_PROJECT;
if (!SAMPLE) {
  console.error(
    'MW_SAMPLE_PROJECT is not set.\n'
    + 'Set it to a MotionWorks project directory you own, e.g.\n'
    + '  $env:MW_SAMPLE_PROJECT = "C:\\path\\to\\MyProject"      # folder form\n'
    + '  $env:MW_SAMPLE_PROJECT = "C:\\path\\to\\MyProject.mwt"  # .mwt form',
  );
  process.exit(2);
}

console.log('── 0. stage a working copy (never the original) ───────────────');
const staged = await run('mw_ide_stage', { source: SAMPLE });
console.log(JSON.stringify(staged));
const STAGED_POU = process.env.MW_SAMPLE_POU ?? 'Initialize';

console.log('\n── 1. what code is there? ─────────────────────────────────────');
const pous = await run('mw_code_pous');
console.log(`${pous.count} POUs`);
for (const p of pous.pous) {
  console.log(`   ${p.name.padEnd(14)} ${String(p.language).padEnd(4)} ${p.has_st_body ? 'ST-editable' : 'not ST'}`);
}

const blocked = await run('mw_code_unsupported');
console.log(`not editable: ${blocked.blocked.map((b) => b.name).join(', ') || '(none)'}`);

const before = await run('mw_code_read_st', { pou: STAGED_POU });
console.log(`\n── 2. read 'Initialize' (${before.language}) ──`);
console.log(before.body);

console.log('── 3. close the IDE (required before any write) ───────────────');
console.log(JSON.stringify(await run('mw_ide_close')));

console.log('\n── 4. preview the write (dry_run) ─────────────────────────────');
const preview = await run('mw_code_write_st', { pou: STAGED_POU, body: NEW_BODY, dry_run: true });
console.log(JSON.stringify({ dry_run: preview.dry_run, result: preview.result }, null, 2));

console.log('\n── 5. apply the write ─────────────────────────────────────────');
const applied = await run('mw_code_write_st', { pou: STAGED_POU, body: NEW_BODY, dry_run: false });
console.log(JSON.stringify(applied.result, null, 2));

console.log('\n── 6. read it back ────────────────────────────────────────────');
const after = await run('mw_code_read_st', { pou: STAGED_POU });
console.log(after.body);
if (after.body !== NEW_BODY) {
  console.error('MISMATCH: the container did not return what was written');
  process.exit(1);
}
console.log('round-trip verified: the container returns exactly what was written');

console.log('\n── 7. start the IDE again and reopen the project ──────────────');
console.log(JSON.stringify(await run('mw_ide_start')));
console.log(JSON.stringify(await run('mw_ide_open', { path: staged.staged_mwt })));

console.log('\n── 8. ask the IDE to compile the agent-written code ───────────');
console.log(JSON.stringify(await run('mw_ide_build'), null, 2));

console.log('\n── 9. read the compile errors the IDE reports ─────────────────');
const errs = await run('mw_ide_errors', { pane: 'Errors' });
console.log(JSON.stringify(errs));

console.log('\nLOOP COMPLETE');
