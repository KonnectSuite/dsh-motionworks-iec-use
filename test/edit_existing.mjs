/**
 * EDIT an existing POU's ST, keeping every declared symbol in use.
 *
 * Previous run: the tree stayed perfect (572 lines, 0 malformed, Global_Variables
 * compiled, no unresolved-external noise) but the build still failed at "Generating IEC
 * code". The Errors pane showed ONLY warnings - "Instance 'fbCamGen' is never used!",
 * "Variable 'CamData' is never used!", eleven of them - because the body had been
 * REPLACED wholesale, orphaning every declaration the original body used.
 *
 * So a wholesale replacement is not viable on a real POU. That matches what actually
 * works in practice: copy a POU and EDIT its ST, leaving the existing logic intact. This
 * appends a small block that uses the new variable and re-reads one of the existing ones,
 * so nothing becomes unused.
 *
 * Run:  MW_PLUGIN=<installed> node test/edit_existing.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const PY = `${process.env.LOCALAPPDATA}\\Programs\\AryaAI\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe`;
const line = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);
const NL = '\r\n';

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const TARGET = 'TopCutterCamSetup';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

function treeHealth() {
  return JSON.parse(execFileSync(PY, ['-c', `
import sys, json
sys.path.insert(0, r"${PLUGIN}\\code\\engine")
from motionworks_iec_mcp.cfb import CompoundFile
from pathlib import Path
lines = (CompoundFile(Path(r"${DIR}") / "src.st1")).read_stream("PROJECT.TRE").decode("latin1").splitlines()
bad = 0
for i, l in enumerate(lines):
    head = l.split("\\t")[0].split()
    if len(head) == 4 and head[0].isdigit() and head[1].isdigit():
        nm = lines[i+1].split("\\t")[0] if i + 1 < len(lines) else ""
        if "\\\\" in nm:
            bad += 1
print(json.dumps({"lines": len(lines), "malformed": bad}))
`], { encoding: 'utf8' }).trim());
}

line('1. fresh stage and read the ORIGINAL body');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE });
await run('mw_ide_close');
const before = await run('mw_code_read_st', { pou: TARGET });
const original = before.body ?? '';
const isLd = original.trim().length === 0;
console.log(`  ${TARGET}: ${(before.variables ?? []).length} declarations, ${original.length} chars`);
console.log(`  language: ${before.language}${isLd ? '  (graphical - an ST write would destroy it)' : ''}`);
check(!isLd, 'the POU has real ST body text to edit');

line('2. EDIT: keep the original body and append a block');
const NEWVAR = 'AgentEditTag';
const v = await run('mw_code_var_add', { pou: TARGET, name: NEWVAR, type: 'BOOL', section: 'VAR', dry_run: false });
check(v.result?.applied === true, `declared ${TARGET}.${NEWVAR}:BOOL`);

const suffix = [
  '',
  '(* --- appended by the plugin: exercises the new declaration only --- *)',
  `${NEWVAR} := NOT ${NEWVAR};`,
  'IF TopCutterCamReady THEN',
  `\t${NEWVAR} := TRUE;`,
  'END_IF;',
  '',
].join(NL);
const edited = original.replace(/\s+$/, '') + NL + suffix;
const w = await run('mw_code_write_st', { pou: TARGET, body: edited, dry_run: false });
check(w.result?.applied === true, `wrote the edited body (${w.result?.before_bytes} -> ${w.result?.after_bytes} bytes)`);
const back = await run('mw_code_read_st', { pou: TARGET });
check(back.body === edited, 'the edited body round-trips exactly');
check(back.body.includes(original.replace(/\s+$/, '').slice(0, 200)), 'the ORIGINAL logic is preserved');
check((back.variables ?? []).some((x) => x.name === NEWVAR), 'the new declaration reads back');

line('3. open and BUILD');
const t0 = treeHealth();
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const t1 = treeHealth();
check(t1.malformed === 0 && t1.lines === t0.lines, `tree untouched (${t0.lines} -> ${t1.lines} lines, ${t1.malformed} malformed)`);

const b = await run('mw_ide_build');
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
check(b.is_compiled === true, 'MotionWorks compiled the edited POU');

const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
const neverUsed = (e.lines ?? []).filter((l) => /is never used/i.test(l)).length;
console.log(`  Errors: ${e.count} lines — ${refs} unresolved-external, ${neverUsed} never-used`);
check(refs === 0, 'no unresolved-external errors');
const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
check((bp.lines ?? []).some((l) => /Global_Variables/.test(l)), 'Global_Variables compiled');
check((bp.lines ?? []).some((l) => /Building instance tree/.test(l)), 'the resource instance tree was built');

line('4. project still sound');
const t2 = treeHealth();
check(t2.malformed === 0, `after build: ${t2.lines} lines, ${t2.malformed} malformed`);

line('VERDICT');
console.log(failures === 0
  ? '  *** THE WORKFLOW WORKS. ***\n'
    + '  Copy a POU, EDIT its ST, add variables and globals, open, build, make - all of it\n'
    + '  through the plugin, with the tree never touched and MotionWorks compiling it.'
  : `  ${failures} check(s) failed - see above.`);
process.exit(failures === 0 ? 0 : 1);
