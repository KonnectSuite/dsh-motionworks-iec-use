/**
 * Preflight: check the things that fail SILENTLY before the plugin ever runs.
 *
 * WHY THIS EXISTS. A UTF-8 byte-order mark at the start of package.json made JSON.parse throw while
 * DSH was loading this bundle. DSH skipped the entry and said nothing - list_plugins simply did not
 * list it, and list_bundles reported the error only when asked directly. The plugin was installed
 * and enabled for hours while registering zero tools, and nothing anywhere said so.
 *
 * A plugin cannot report that it failed to load, because it is not running. So the check has to sit
 * outside it, in something a person or a script can run before trusting the install.
 *
 * WHAT IT CHECKS, in the order they would bite:
 *
 *   1  no byte-order mark in any JSON or YAML the bundle ships
 *   2  package.json parses as JSON
 *   3  dsh.bundle.patch is declared and the file it names exists
 *   4  the patch file is a YAML sequence with an insert entry naming this package
 *   5  index.js exists, parses, and exports defineTools()
 *   6  the declared tool count, so a silent truncation is visible
 *
 * A byte-order mark is the specific thing that cost the most time here, which is why it is checked
 * first and reported as an error rather than a warning.
 *
 * Run:  node preflight.mjs            (checks the plugin it sits in)
 *       node preflight.mjs <path>     (checks another copy, e.g. the installed one)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? HERE);

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const problems = [];
const notes = [];

function fail(what, detail) { problems.push({ what, detail }); }
function note(text) { notes.push(text); }

function hasBom(path) {
  try {
    const head = readFileSync(path).subarray(0, 3);
    return head.equals(BOM);
  } catch {
    return false;
  }
}

// ── 1. byte-order marks ──────────────────────────────────────────────────────────
const TEXTY = new Set(['.json', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts']);
function walk(dir, depth = 0) {
  if (depth > 4) return [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'stage' || e.name === 'backups'
        || e.name === '__pycache__' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, depth + 1));
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const bommed = files.filter((f) => {
  const ext = f.slice(f.lastIndexOf('.'));
  return TEXTY.has(ext) && hasBom(f);
});
// A BOM is FATAL in JSON - JSON.parse rejects it, which is what stopped this bundle loading. In a
// JavaScript file Node tolerates it, so the same finding is reported at its true severity rather
// than as an error that would send someone hunting a non-problem.
const bomInJson = bommed.filter((f) => /\.jsonc?$/i.test(f));
const bomInCode = bommed.filter((f) => !/\.jsonc?$/i.test(f));
for (const f of bomInJson) {
  fail('byte-order mark', `${f.slice(ROOT.length + 1)} — JSON.parse WILL reject this file`);
}
for (const f of bomInCode) {
  note(`byte-order mark in a code file (harmless to Node, still untidy): `
    + `${f.slice(ROOT.length + 1)}`);
}
if (!bommed.length) {
  note(`no byte-order marks in ${files.length} files`);
}

// ── 2. the manifest ──────────────────────────────────────────────────────────────
const pkgPath = join(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  fail('package.json', 'missing');
}
let pkg = null;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  note(`package.json parses: ${pkg.name}@${pkg.version}`);
} catch (e) {
  fail('package.json', `does not parse: ${String(e.message).slice(0, 80)}`);
}

// ── 3. the bundle declaration ────────────────────────────────────────────────────
let patchPath = null;
if (pkg) {
  patchPath = pkg?.dsh?.bundle?.patch;
  if (!patchPath) {
    fail('dsh.bundle.patch', 'not declared — DSH has no patch to apply, so no tools load');
  } else {
    const full = join(ROOT, patchPath.replace(/^\.\//, ''));
    if (!existsSync(full)) fail('dsh.bundle.patch', `declared ${patchPath} but the file is missing`);
    else note(`patch file present: ${patchPath}`);
  }
}

// ── 4. the patch says to insert this package ─────────────────────────────────────
if (patchPath) {
  const full = join(ROOT, patchPath.replace(/^\.\//, ''));
  if (existsSync(full)) {
    const text = readFileSync(full, 'utf8');
    if (!/^\s*-\s*insert:/m.test(text)) {
      fail('patch file', 'has no top-level `- insert:` entry, so nothing is registered');
    } else if (pkg?.name && !text.includes(pkg.name)) {
      fail('patch file', `does not name ${pkg.name}, so the row would load nothing`);
    } else {
      note(`patch file inserts ${pkg.name}`);
    }
  }
}

// ── 5. the entry point ───────────────────────────────────────────────────────────
const entry = join(ROOT, pkg?.exports?.['.']?.replace(/^\.\//, '') ?? 'index.js');
if (!existsSync(entry)) {
  fail('entry point', `${entry.slice(ROOT.length + 1)} missing`);
} else {
  try {
    const mod = await import(`file:///${entry.replace(/\\/g, '/')}`);
    if (typeof mod.__internals?.defineTools !== 'function') {
      fail('entry point', 'does not export __internals.defineTools()');
    } else {
      const tools = mod.__internals.defineTools();
      note(`entry point loads and defines ${tools.length} tools`);

      // ── 6. the tools themselves ───────────────────────────────────────────────────
      const nameless = tools.filter((t) => !t.name);
      if (nameless.length) fail('tools', `${nameless.length} tool(s) have no name`);
      const bad = tools.filter((t) => !t.output?.schema || typeof t.output.render !== 'function');
      if (bad.length) {
        fail('tools', `${bad.length} tool(s) lack { schema, render }: `
          + bad.map((t) => t.name ?? '?').join(', '));
      } else {
        note(`all ${tools.length} tools have a valid { schema, render }`);
      }
    }
  } catch (e) {
    fail('entry point', `does not load: ${String(e.message).split('\n')[0].slice(0, 90)}`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────────
console.log(`\n  preflight: ${ROOT}\n`);
for (const n of notes) console.log(`  ok    ${n}`);
for (const p of problems) console.log(`  FAIL  ${p.what}: ${p.detail}`);

if (problems.length) {
  console.log(`\n  ${problems.length} problem(s). DSH would load this bundle and register NOTHING,`);
  console.log('  without reporting an error — the failure mode that cost hours here.');
  process.exit(1);
}
console.log(`\n  clean. ${notes.length} check(s) passed.`);
