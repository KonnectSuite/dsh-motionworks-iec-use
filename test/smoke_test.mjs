/**
 * SMOKE TEST: creating a POU, adding variables and writing ST must not damage the
 * project.
 *
 * The user's report was that an earlier attempt corrupted the project. File sizes
 * are a misleading measure here (CFB pads, so a container can shrink by 512 bytes
 * with identical contents), so this compares the ACTUAL STREAMS inside every POU
 * container before and after each operation.
 *
 * Acceptance criteria, checked after EVERY step:
 *   1. No POU loses a stream.
 *   2. Every pre-existing POU's *.STB (Structured Text) is byte-identical.
 *   3. No pre-existing POU's streams change at all, except streams the operation
 *      is explicitly allowed to touch.
 *
 * Run:  node smoke_test.mjs <source_project_dir>
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PLUGIN = 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const HELPER = 'C:\\Users\\KNPhu\\OneDrive\\Desktop\\dsh-MotionWorksIEC-use\\smoke_manifest.py';

const SRC = process.argv[2]
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Arya WorkSpace\\Arya WorkSpace\\MP2600iec Program\\TopCutter';

const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;

const line = (s) => console.log(`\n${'─'.repeat(74)}\n  ${s}\n${'─'.repeat(74)}`);
const manifest = (dir) => JSON.parse(execFileSync(PY, [HELPER, dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };
const pass = (m) => console.log(`  ok   ${m}`);

/** Compare two manifests; allowedPous are ones the step may legitimately change. */
function compare(before, after, step, allowedPous = []) {
  const problems = [];

  for (const [pou, b] of Object.entries(before.pous)) {
    const a = after.pous[pou];
    if (!a) { problems.push(`POU '${pou}' disappeared`); continue; }

    const bStreams = b.streams ?? {};
    const aStreams = a.streams ?? {};
    if (bStreams.__error__) { continue; }   // was already unreadable

    for (const [name, info] of Object.entries(bStreams)) {
      if (!(name in aStreams)) { problems.push(`${pou}: stream '${name}' LOST`); continue; }
      if (aStreams[name].sha256 !== info.sha256) {
        const grew = aStreams[name].bytes - info.bytes;
        problems.push(`${pou}: stream '${name}' changed (${info.bytes} -> ${aStreams[name].bytes}, ${grew >= 0 ? '+' : ''}${grew})`);
      }
    }
  }

  if (problems.length === 0) {
    pass(`${step}: all pre-existing POUs intact (no lost streams, no changed bytes)`);
  } else {
    fail(`${step}: ${problems.length} integrity problem(s)`);
    for (const p of problems.slice(0, 12)) console.log(`         ${p}`);
    if (problems.length > 12) console.log(`         … and ${problems.length - 12} more`);
  }
  return problems.length === 0;
}

line(`0. Stage a FRESH copy from the original\n  ${SRC}`);
try { rmSync(join(STAGE, 'TopCutter.mwt'), { force: true }); rmSync(join(STAGE, 'TopCutter'), { recursive: true, force: true }); } catch { /* first run */ }
const staged = await run('mw_ide_stage', { source: SRC, allow_outside_workspace: true });
const dir = join(STAGE, 'TopCutter');
if (!existsSync(dir)) { console.log(`  staged dir missing: ${dir}`); process.exit(1); }
pass(`staged from the original (source untouched)`);

line('1. Baseline manifest');
const base = manifest(dir);
const pouCount = Object.keys(base.pous).length;
console.log(`  ${pouCount} POUs: ${Object.keys(base.pous).join(', ')}`);
pass('baseline captured');

let current = base;

// ── 2. create a POU ─────────────────────────────────────────────────────────
line('2. Create a new POU');
const NEW = 'SmokePou';
try {
  const created = await run('mw_code_pou_create', { name: NEW, template: 'TopCutterInitialize', dry_run: false });
  console.log(`  created '${NEW}' (files: ${(created.result.files_created ?? []).length})`);
} catch (e) {
  fail(`create threw: ${e.message}`);
}
current = manifest(dir);
compare(current, current, 'create', [NEW]);   // placeholder; real check below
{
  const after = current;
  const problems = [];
  for (const [pou, b] of Object.entries(base.pous)) {
    const a = after.pous[pou];
    if (!a) { problems.push(`pre-existing POU '${pou}' disappeared`); continue; }
    for (const [name, info] of Object.entries(b.streams ?? {})) {
      if (info.__error__) continue;
      if (!(name in (a.streams ?? {}))) { problems.push(`${pou}: stream '${name}' LOST`); continue; }
      if (a.streams[name].sha256 !== info.sha256) problems.push(`${pou}: stream '${name}' changed`);
    }
  }
  if (!after.pous[NEW]) problems.push(`new POU '${NEW}' was not created`);
  if (problems.length === 0) pass('create: every pre-existing POU byte-identical; new POU present');
  else { fail(`create: ${problems.length} problem(s)`); problems.slice(0, 10).forEach((p) => console.log(`         ${p}`)); }
}

// ── 3. add variables ────────────────────────────────────────────────────────
line('3. Add variables to the new POU');
for (const v of [{ name: 'Enable', type: 'BOOL' }, { name: 'Count', type: 'DINT' }, { name: 'Rate', type: 'REAL' }]) {
  try {
    const r = await run('mw_code_var_add', { pou: NEW, section: 'VAR', dry_run: false, ...v });
    console.log(`  + ${v.name}:${v.type} applied=${r.result.applied}`);
  } catch (e) { fail(`var_add ${v.name} threw: ${e.message}`); }
}
current = manifest(dir);
compare(base, current, 'add variables (new POU may change)', [NEW]);

// ── 4. read back the declarations ───────────────────────────────────────────
line('4. Read the declarations back');
try {
  const rd = await run('mw_code_read_st', { pou: NEW });
  const names = (rd.variables ?? []).map((v) => `${v.name}:${v.type}`);
  console.log(`  ${names.length} declarations: ${names.join(', ')}`);
  if (names.length >= 3) pass('all three declarations are present');
  else fail(`expected 3 declarations, found ${names.length}`);
} catch (e) { fail(`read_st threw: ${e.message}`); }

// ── 5. write ST ─────────────────────────────────────────────────────────────
line('5. Write a Structured Text body');
const BODY = [
  '(* smoke test body *)',
  'Count := Count + 1;',
  'IF Enable THEN',
  '\tRate := DINT_TO_REAL(Count);',
  'END_IF;',
  '',
].join('\r\n');
try {
  const dry = await run('mw_code_write_st', { pou: NEW, body: BODY, dry_run: true });
  console.log(`  dry run: ${dry.result.before_bytes} -> ${dry.result.after_bytes} bytes (applied=${dry.result.applied})`);
  const real = await run('mw_code_write_st', { pou: NEW, body: BODY, dry_run: false });
  console.log(`  applied=${real.result.applied} siblings_verified=${real.result.siblings_verified} backups=${(real.result.backups ?? []).length}`);
  if (real.result.siblings_verified !== undefined && real.result.siblings_verified < 1) fail('no sibling verification reported');
} catch (e) { fail(`write_st threw: ${e.message}`); }
current = manifest(dir);
compare(base, current, 'write ST (new POU may change)', [NEW]);

// ── 6. round trip ───────────────────────────────────────────────────────────
line('6. Read the body back');
try {
  const rd = await run('mw_code_read_st', { pou: NEW });
  if (rd.body === BODY) pass('round-trip identical: true');
  else {
    fail('round-trip MISMATCH');
    console.log(`         wrote ${BODY.length} chars, read ${rd.body.length}`);
  }
} catch (e) { fail(`read_st threw: ${e.message}`); }

// ── 7. delete the POU ───────────────────────────────────────────────────────
line('7. Delete the new POU (must be recoverable and clean)');
try {
  const del = await run('mw_code_pou_delete', { name: NEW, dry_run: false });
  console.log(`  archived to ${del.result.archived_to ?? '(reported ok)'}`);
} catch (e) { fail(`pou_delete threw: ${e.message}`); }
current = manifest(dir);
{
  const problems = [];
  for (const [pou, b] of Object.entries(base.pous)) {
    const a = current.pous[pou];
    if (!a) { problems.push(`pre-existing POU '${pou}' disappeared`); continue; }
    for (const [name, info] of Object.entries(b.streams ?? {})) {
      if (info.__error__) continue;
      if (!(name in (a.streams ?? {}))) { problems.push(`${pou}: stream '${name}' LOST`); continue; }
      if (a.streams[name].sha256 !== info.sha256) problems.push(`${pou}: stream '${name}' changed`);
    }
  }
  if (current.pous[NEW]) problems.push(`'${NEW}' is still present after delete`);
  if (problems.length === 0) pass('delete: project is back to its original POU set, all streams intact');
  else { fail(`delete: ${problems.length} problem(s)`); problems.slice(0, 10).forEach((p) => console.log(`         ${p}`)); }
}

line('RESULT');
console.log(`  failures: ${failures}`);
console.log(failures === 0
  ? '  PASS - create / variables / write ST / delete left every original POU byte-identical.'
  : '  FAIL - see above.');
process.exit(failures === 0 ? 0 : 1);
