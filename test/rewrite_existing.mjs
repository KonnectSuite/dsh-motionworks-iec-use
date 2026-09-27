/**
 * THE CODEX WORKFLOW: rewrite an EXISTING, already-assigned POU. No tree surgery.
 *
 * Everything gathered so far says the same thing from several directions:
 *
 *   - editing PROJECT.TRE to add a program instance makes the IDE rewrite the tree,
 *     destroying the three nodes after the insertion (125 build errors)
 *   - writing only NODES.LST avoids all damage and builds cleanly, but the IDE discards
 *     the assignment, so the program does not persist
 *   - a generated instance block is structurally identical to the canonical ones (marker
 *     19, params "id 6 0 0", name, path, blank, state, blank, guid, state, blank) -
 *     verified against a real two-instance task in the reference project - and it STILL
 *     gets rewritten
 *
 * So adding a NEW program to a task is the one thing the offline-file route cannot do.
 * Which is precisely what "copy an existing POU, edit the ST, add variables" avoids: a
 * POU that is already assigned needs no assignment.
 *
 * This proves that workflow end to end: take TopCutterCamSetup (assigned to BG), rewrite
 * its declarations and its ST body, open, build, and confirm the project is intact and
 * compiles - with no tree write at any point.
 *
 * Run:  MW_PLUGIN=<installed> node test/rewrite_existing.mjs
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

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const TARGET = 'TopCutterCamSetup';   // assigned to BG
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

line('1. fresh stage, then read the POU we will rewrite');
try { await run('mw_ide_close'); } catch { /* not running */ }
for (const p of [DIR, MWT]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* absent */ } }
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
const t0 = treeHealth();
check(t0.malformed === 0, `pristine tree: ${t0.lines} lines, ${t0.malformed} malformed`);

await run('mw_ide_close');
const before = await run('mw_code_read_st', { pou: TARGET });
console.log(`  ${TARGET}: ${(before.variables ?? []).length} declarations, `
  + `${(before.body ?? '').length} chars of ST`);
const tasks0 = await run('mw_code_tasks');
check((tasks0.tasks.BG ?? []).includes(TARGET), `${TARGET} is assigned to BG (no assignment needed)`);

line('2. rewrite its declarations and body (NO tree write anywhere)');
const NEWVAR = 'AgentRewriteTag';
const v = await run('mw_code_var_add', { pou: TARGET, name: NEWVAR, type: 'BOOL', section: 'VAR', dry_run: false });
check(v.result?.applied === true, `declared ${TARGET}.${NEWVAR}:BOOL`);
const BODY = [
  '(* Rewritten in place through the plugin. The POU was already assigned to BG, *)',
  '(* so no program instance had to be added to the project tree.              *)',
  '',
  'AgentRewriteTag := NOT AgentRewriteTag;',
  '',
  'IF AgentRewriteTag THEN',
  '\tTopCutterCamReady := TRUE;',
  'ELSE',
  '\tTopCutterCamReady := FALSE;',
  'END_IF;',
  '',
].join('\r\n');
const w = await run('mw_code_write_st', { pou: TARGET, body: BODY, dry_run: false });
check(w.result?.applied === true, `rewrote the body (${w.result?.before_bytes} -> ${w.result?.after_bytes} bytes)`);
const back = await run('mw_code_read_st', { pou: TARGET });
check(back.body === BODY, 'the body round-trips exactly');
check((back.variables ?? []).some((x) => x.name === NEWVAR), 'the new declaration reads back');

line('3. open and BUILD - no tree edit was made, so nothing should be rewritten');
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });
const t1 = treeHealth();
check(t1.malformed === 0, `after open: ${t1.lines} lines, ${t1.malformed} malformed`);
check(t1.lines === t0.lines, `tree line count unchanged (${t0.lines} -> ${t1.lines})`);

const b = await run('mw_ide_build');
console.log(`  BUILD: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
check(b.is_compiled === true, 'MotionWorks compiled the rewritten POU');

const e = await run('mw_ide_errors', { pane: 'Errors', limit: 300 });
const refs = (e.lines ?? []).filter((l) => /No matching global variable/i.test(l)).length;
check(refs === 0, `no unresolved-external noise (${refs})`);
const bp = await run('mw_ide_errors', { pane: 'Build', limit: 80 });
check((bp.lines ?? []).some((l) => /Global_Variables/.test(l)), 'Global_Variables was compiled (not skipped)');
check((bp.lines ?? []).some((l) => /Building instance tree/.test(l)), 'the resource instance tree was built');
check((bp.lines ?? []).some((l) => new RegExp(TARGET).test(l)), `${TARGET} was compiled`);

line('4. and the project is still sound afterwards');
const t2 = treeHealth();
check(t2.malformed === 0, `after build: ${t2.lines} lines, ${t2.malformed} malformed`);
const tasks1 = await run('mw_code_tasks');
check(JSON.stringify(tasks1.tasks) === JSON.stringify(tasks0.tasks), 'task map unchanged');

line('VERDICT');
console.log(failures === 0
  ? `  *** THE CODEX WORKFLOW WORKS END TO END. ***\n`
    + `  Rewriting an already-assigned POU needs no tree edit, the tree is never rewritten,\n`
    + `  Global_Variables compiles, the instance tree builds, and MotionWorks compiles it.\n`
    + `  Adding a NEW program to a task is the only thing that requires the tree - and that\n`
    + `  is the one step to hand to the user.`
  : `  ${failures} check(s) failed - see above.`);
process.exit(failures === 0 ? 0 : 1);
