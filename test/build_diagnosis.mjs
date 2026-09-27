/**
 * Does the build diagnosis actually fire?
 *
 * Three cases, no real damage to any project:
 *
 *   1  a healthy project builds     -> diagnosis is null
 *   2  a POU container blown up     -> diagnosis.kind = 'poe-damaged', naming the POU
 *   3  a POU container truncated    -> diagnosis.kind = 'poe-damaged', naming the POU
 *
 * The damage in cases 2 and 3 is INDUCED by resizing a file in the stage, so nothing real is
 * harmed, and the file is restored afterwards. The point is to check the thresholds fire at the
 * sizes they claim to, not to wait for a compiler to destroy something.
 *
 * Run:  MW_PLUGIN=<installed> node test/build_diagnosis.mjs
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';

const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\profiles\\desktop\\node_modules\\dsh-motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
const tools = new Map(mod.__internals.defineTools().map((t) => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});

const SOURCE = [
  process.env.MW_SOURCE,
  'C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt',
].filter(Boolean).find((p) => existsSync(p));
if (!SOURCE) { console.error('no pristine source'); process.exit(2); }

const STAGE = mod.__internals.STAGE_ROOT;
const DIR = `${STAGE}\\TopCutter`;
const MWT = `${DIR}.mwt`;
const VICTIM = `${DIR}\\POE\\TopCutterInitialize\\src.st1`;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${String(detail ?? '').slice(0, 44)}`);
};

try { await run('mw_ide_close'); } catch { /* not running */ }
for (let i = 0; i < 10; i++) {
  try {
    for (const p of [DIR, MWT]) rmSync(p, { recursive: true, force: true });
    break;
  } catch { await new Promise((r) => setTimeout(r, 1500)); }
}
await run('mw_ide_stage', { source: SOURCE, allow_outside_workspace: true });
await run('mw_ide_start');
await run('mw_ide_open', { path: MWT });

// ── 1. healthy ───────────────────────────────────────────────────────────────────
const clean = await run('mw_ide_build');
check('a clean build reports no diagnosis', clean.diagnosis == null,
  `is_compiled=${clean.is_compiled} diagnosis=${JSON.stringify(clean.diagnosis)}`);

// ── 2. a container blown up to grid-explosion size ───────────────────────────────
const original = existsSync(VICTIM) ? readFileSync(VICTIM) : null;
const originalSize = original ? original.length : 0;
if (!original) {
  check('a POU container to test with', false, VICTIM);
} else {
  console.log(`\n  (( the POU container is normally ${(originalSize / 1024).toFixed(1)} KB ))`);

  writeFileSync(VICTIM, Buffer.alloc(2_000_000, 0));
  const blown = await run('mw_ide_build');
  check('a blown container is diagnosed',
    blown.diagnosis?.kind === 'poe-damaged'
      && (blown.diagnosis.damaged ?? []).some((x) => x.pou === 'TopCutterInitialize'),
    `kind=${blown.diagnosis?.kind} pou=${blown.diagnosis?.damaged?.[0]?.pou}`);

  // ── 3. a container truncated to nothing ────────────────────────────────────────
  writeFileSync(VICTIM, Buffer.alloc(0));
  const cut = await run('mw_ide_build');
  check('a truncated container is diagnosed',
    cut.diagnosis?.kind === 'poe-damaged'
      && (cut.diagnosis.damaged ?? []).some((x) => x.kind === 'truncated'),
    `kind=${cut.diagnosis?.kind} detail=${cut.diagnosis?.damaged?.[0]?.kind}`);

  writeFileSync(VICTIM, original);
  check('the container is restored', statSync(VICTIM).size === originalSize,
    `${(statSync(VICTIM).size / 1024).toFixed(1)} KB`);

  const after = await run('mw_ide_build');
  check('and the diagnosis clears', after.diagnosis == null || after.diagnosis.kind !== 'poe-damaged',
    `kind=${after.diagnosis?.kind ?? 'null'}`);

  // the remedy text must actually say something useful
  const text = String(blown.diagnosis?.explain ?? '');
  check('the explanation names the cause and a next step',
    text.includes('TYPE ERROR') && String(blown.diagnosis?.next ?? '').length > 10,
    `${text.length} chars`);
}

await run('mw_ide_close').catch(() => {});

console.log(`\n${'═'.repeat(88)}`);
const bad = results.filter((r) => !r.ok).length;
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
console.log(`\n  ${results.length - bad} of ${results.length} pass`);
