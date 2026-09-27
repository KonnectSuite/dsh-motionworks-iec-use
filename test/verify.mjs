/**
 * Verifies the MotionWorks Use plugin without needing DSH to restart.
 *
 * Run with the DSH runtime's Node (the same runtime the harness uses), from the
 * profile junction so this exercises the real loader path:
 *
 *   <dsh-runtime>\node\node.exe <profile>\node_modules\@local\motionworks-iec-use\test\verify.mjs
 *   ... --live      # also drive the real COM bridge against a running IDE
 *
 * Proves:
 *  1. the module loads with NO package imports available (the profile-plugin
 *     resolution limit measured on this machine);
 *  2. every tool registers with a complete, well-formed definition, and every
 *     schema is really JSON Schema — `required` an ARRAY, never the inline
 *     `required: true` of the defineTool spec DSL (this plugin registers
 *     directly, so getting that wrong yields silently unenforced arguments);
 *  3. render() works on a schema-derived value, for every tool;
 *  4. the safety guard refuses paths outside the staging root;
 *  5. with --live, the bridge round-trips against the real running IDE.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const live = process.argv.includes('--live');
const HERE = dirname(fileURLToPath(import.meta.url));

const mod = await import('../index.js');

assert.equal(mod.name, 'motionworks-iec-use', 'plugin name');
assert.deepEqual(mod.inject, ['tools'], 'declares the tools service');
assert.equal(typeof mod.apply, 'function', 'exports apply()');

// ── a stand-in for the real Cordis context ──────────────────────────────────
const registered = [];
let disposeHandler = null;
const ctx = {
  tools: {
    register(definition) { registered.push(definition); return () => {}; },
    presentAs() { return () => {}; },
  },
  on(event, fn) { if (event === 'dispose') disposeHandler = fn; return () => {}; },
};

mod.apply(ctx);
console.log(`loaded: ${mod.name}`);
console.log(`tools registered: ${registered.length}`);
assert.ok(registered.length >= 13, 'registers the IDE and code tool sets');
assert.ok(disposeHandler, 'registers a dispose handler so the bridge is stopped');

// ── schema shape: this is the check that catches the DSL/JSON-Schema slip ───
const problems = [];
function checkSchema(schema, path) {
  if (!schema || typeof schema !== 'object') { problems.push(`${path}: not an object`); return; }
  if ('required' in schema && !Array.isArray(schema.required)) {
    problems.push(`${path}.required is ${JSON.stringify(schema.required)} — must be an ARRAY of names`);
  }
  if (schema.type === 'object' && schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      if ('required' in v) {
        problems.push(`${path}.properties.${k} carries an inline 'required' — properties must not`);
      }
      checkSchema(v, `${path}.properties.${k}`);
    }
  }
  if (schema.items) checkSchema(schema.items, `${path}.items`);
}

/** Build a value that satisfies a schema, so render() can be exercised. */
function stub(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.enum) return schema.enum[0];
  let t = schema.type;
  if (Array.isArray(t)) t = t.find((x) => x !== 'null') ?? 'null';
  switch (t) {
    case 'object': {
      const o = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) o[k] = stub(v);
      return o;
    }
    case 'array': return schema.items ? [stub(schema.items)] : [];
    case 'string': return 'stub';
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    default: return null;
  }
}

const seen = new Set();
for (const t of registered) {
  assert.ok(
    t.name.startsWith('mw_ide_') || t.name.startsWith('mw_code_'),
    `${t.name} is not prefixed mw_ide_/mw_code_`,
  );
  assert.ok(!seen.has(t.name), `duplicate tool ${t.name}`);
  seen.add(t.name);
  assert.ok(t.description.length > 40, `${t.name} has a real description`);
  assert.ok(t.parameters && typeof t.parameters === 'object', `${t.name} parameters`);
  assert.equal(t.parameters.type, 'object', `${t.name} parameters must be an object schema`);
  assert.ok(t.output?.schema, `${t.name} declares an output schema`);
  assert.equal(typeof t.output.render, 'function', `${t.name} has render()`);
  assert.equal(typeof t.execute, 'function', `${t.name} has execute()`);
  checkSchema(t.parameters, `${t.name}.parameters`);
  checkSchema(t.output.schema, `${t.name}.output.schema`);

  // render() must produce ContentBlock[] from a schema-satisfying value.
  const rendered = t.output.render({}, stub(t.output.schema));
  assert.ok(Array.isArray(rendered) && rendered.length > 0, `${t.name} render returned nothing`);
  for (const block of rendered) {
    assert.equal(block.type, 'text', `${t.name} render block type`);
    assert.equal(typeof block.text, 'string', `${t.name} render block text`);
  }
}

if (problems.length) {
  console.error('\nSCHEMA PROBLEMS:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('schemas: valid JSON Schema (required is an array everywhere)');
console.log('tools:');
for (const t of registered) console.log(`  ${t.name}`);

// ── the safety guard must refuse anything outside the staging root ──────────
// Any path outside stage/ will do, so this stays portable: no real project is
// needed, and none is touched.
const outsideStaging = join(HERE, '..', 'definitely-not-staged.mwt');
await assert.rejects(
  async () => registered.find((t) => t.name === 'mw_ide_open').execute({ path: outsideStaging }, {}),
  /REFUSED/,
  'mw_ide_open must refuse a path outside the staging root',
);
console.log('guard: mw_ide_open refuses a path outside stage/ (as intended)');

// mw_ide_stage must also reject a missing source rather than inventing one.
await assert.rejects(
  async () => registered.find((t) => t.name === 'mw_ide_stage').execute({ source: join(HERE, 'nope') }, {}),
  /not found/,
  'mw_ide_stage must fail on a missing source',
);
console.log('guard: mw_ide_stage fails loudly on a missing source');

if (!live) {
  console.log('\nstructural checks passed. Re-run with --live to exercise the COM bridge.');
  process.exit(0);
}

// ── live: drive the real IDE through the plugin's own code path ─────────────
const { verb } = mod.__internals;

const status = await verb('status', {}, 30000);
console.log('\nlive status:', JSON.stringify(status));
assert.ok(status.version, 'reports an automation version');

if (status.is_project_open) {
  const pous = await verb('pous', {}, 30000);
  console.log(`live pous: ${pous.count} -> ${pous.pous.map((p) => p.name).join(', ')}`);
  const vars = await verb('variables', {}, 120000);
  const total = vars.pous.reduce((n, p) => n + p.count, 0);
  console.log(`live variables: ${total} across ${vars.pous.length} POUs`);
} else {
  console.log('no project open in the IDE; skipping pous/variables');
}

const shotPath = join(HERE, 'shots', `verify-${Date.now()}.png`);
const shot = await verb('screenshot', { path: shotPath }, 30000);
const size = statSync(shot.path).size;
assert.ok(size > 1000, 'screenshot produced a non-trivial file');
console.log(`live screenshot: ${shot.path} (${shot.width}x${shot.height}, ${size} bytes)`);

console.log('\nALL CHECKS PASSED');
