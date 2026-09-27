/**
 * FIND THE COMPILE ERROR TEXT.
 *
 * mw_ide_errors can only photograph the Errors pane, which an agent cannot act on.
 * Somewhere the compiler must put the actual messages. Candidates:
 *   C/Configuration/R/Resource/__Resource.ERR   (0 bytes on a clean build - promising)
 *   error.rpt in ProgramData
 *   the Message Window's list control (MSAA/UIA)
 *
 * This builds a project known to contain a compile error and snapshots every
 * candidate before and after, so the one that gains content is identified.
 *
 * Run:  MW_PLUGIN=<installed> node test/find_error_text.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const line = (s) => console.log(`\n${'─'.repeat(74)}\n  ${s}\n${'─'.repeat(74)}`);

/** Every file under the project plus ProgramData, keyed by path -> [size, mtime]. */
function snapshot() {
  const out = new Map();
  const add = (root, filter = () => true) => {
    const walk = (d) => {
      let entries = [];
      try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && filter(p)) {
          try { const s = statSync(p); out.set(p, [s.size, s.mtimeMs]); } catch { /* gone */ }
        }
      }
    };
    walk(root);
  };
  add(DIR);
  add('C:\\ProgramData\\Yaskawa\\MotionWorks IEC 3 Pro\\3_7_5_1_667');
  return out;
}

line('1. build the project that contains BadPou (broken on purpose)');
try { await run('mw_ide_close'); } catch { /* not running */ }
try { await run('mw_ide_start'); } catch (e) { console.log(`  start: ${e.message}`); }
try { await run('mw_ide_open', { path: MWT }); console.log('  open: OK'); }
catch (e) { console.log(`  open failed: ${e.message.split('\n')[0]}`); }

const before = snapshot();
let verdict = null;
try {
  const b = await run('mw_ide_build');
  verdict = b;
  console.log(`  build: is_compiled=${b.is_compiled} (${b.elapsed_s}s)`);
} catch (e) { console.log(`  build threw: ${e.message.split('\n')[0]}`); }

// Give the IDE a moment to flush whatever it writes.
await new Promise((r) => setTimeout(r, 3000));
const after = snapshot();

line('2. what CHANGED (new or grown files)');
const changed = [];
for (const [p, [size, mtime]] of after) {
  const was = before.get(p);
  if (!was) changed.push({ p, note: `NEW (${size} bytes)` });
  else if (was[0] !== size) changed.push({ p, note: `${was[0]} -> ${size} bytes` });
  else if (was[1] !== mtime) changed.push({ p, note: `touched (${size} bytes)` });
}
for (const [p] of before) if (!after.has(p)) changed.push({ p, note: 'DELETED' });
changed.sort((a, b) => a.p.localeCompare(b.p));
for (const c of changed) console.log(`  ${c.p.replace(DIR, '<proj>').replace('C:\\ProgramData\\Yaskawa\\MotionWorks IEC 3 Pro\\3_7_5_1_667', '<pd>')}\n      ${c.note}`);

line('3. contents of anything that now has error-like text');
for (const c of changed) {
  const size = (after.get(c.p) ?? [0])[0];
  if (size === 0 || size > 400000) continue;
  if (!/(ERR|err|log|LST|lst|rpt|txt)$/.test(c.p)) continue;
  let text = '';
  try { text = readFileSync(c.p, 'latin1'); } catch { continue; }
  if (!/error|Error|ERROR|undefined|Undeclared|UndefinedThing|not declared/i.test(text)) continue;
  console.log(`\n  === ${c.p}`);
  console.log(text.split('\n').slice(0, 40).map((l) => `      ${l}`).join('\n'));
}

line('4. the Errors pane, as text, via the IDE output windows');
try {
  const ow = execFileSync(`${process.env.SystemRoot}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ['-NoProfile', '-Command', `
$app = New-Object -ComObject Ade.Application.550
$w = $app.OutputWindows
for ($i=1; $i -le $w.Count; $i++) {
  $x = $w.Item($i)
  $cap = ''; try { $cap = [string]$x.Caption } catch {}
  $props = @()
  foreach ($n in @('Text','Content','Lines','Value','Items','Count')) {
    try { $v = $x.$n; if ($null -ne $v) { $props += "$n=$v" } } catch {}
  }
  "  [$i] $cap  $($props -join ' | ')"
}`],
    { encoding: 'utf8', timeout: 60000 });
  console.log(ow.trim());
} catch (e) { console.log(`  probe failed: ${e.message.split('\n')[0]}`); }
