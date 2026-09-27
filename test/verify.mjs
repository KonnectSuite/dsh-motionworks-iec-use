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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// ── schema shape ────────────────────────────────────────────────────────────
//
// This reproduces the enforced subset from @deepseek-ai/dsh-tools
// (checkSchemaNode / checkObjectSchemaTail). It matters: the plugin registers
// definitions DIRECTLY, so ctx.tools.register() runs the real validator, and a
// violation there throws inside apply() and the whole plugin reports
// "Failed to start" — which is exactly what a plugin with no unit tests ships.
//
// The earlier version of this file ACCEPTED `type: ['string', 'null']` (it even
// unwrapped type arrays in stub()), so it passed while the real registry
// rejected 9 of 21 tools. Do not loosen these rules.
const CONSTRAINT_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
]);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];

const problems = [];
function checkSchema(node, path, seen = new Set()) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    problems.push(`${path}: must be a schema object`);
    return;
  }
  if (seen.has(node)) { problems.push(`${path}: is circular`); return; }
  seen.add(node);

  for (const key of Object.keys(node)) {
    if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue;
    problems.push(
      `${path}.${key} is not a supported keyword `
      + '(subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)',
    );
  }
  if ('description' in node && typeof node.description !== 'string') problems.push(`${path}.description must be a string`);
  if ('title' in node && typeof node.title !== 'string') problems.push(`${path}.title must be a string`);

  const hasType = Object.hasOwn(node, 'type');
  const hasOneOf = Object.hasOwn(node, 'oneOf');

  if (hasType && hasOneOf) { problems.push(`${path} cannot declare both type and oneOf`); seen.delete(node); return; }

  if (!hasType && !hasOneOf) {
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) problems.push(`${path}.${key} requires type or oneOf`);
    }
    seen.delete(node);
    return;
  }

  if (hasOneOf) {
    const oneOf = node.oneOf;
    if (!Array.isArray(oneOf) || oneOf.length < 2) problems.push(`${path}.oneOf must be an array of at least two schemas`);
    else oneOf.forEach((sub, i) => checkSchema(sub, `${path}.oneOf[${i}]`, seen));
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) problems.push(`${path}.${key} is not supported beside oneOf`);
    }
    seen.delete(node);
    return;
  }

  // ── the rule that caught the real bug ──
  const type = node.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    problems.push(Array.isArray(type)
      ? `${path}.type must be a single type string (type arrays are not supported)`
      : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`);
    seen.delete(node);
    return;
  }

  if (type === 'object') {
    if (Object.hasOwn(node, 'required')) {
      const req = node.required;
      if (!Array.isArray(req) || req.some((r) => typeof r !== 'string')) {
        problems.push(`${path}.required must be an array of strings (never an inline boolean)`);
      }
    }
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      problems.push(`${path}.additionalProperties must be a boolean`);
    }
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      // properties must be a plain record of schemas
      if (Array.isArray(v)) { problems.push(`${path}.properties.${k}: must be a schema object`); continue; }
      checkSchema(v, `${path}.properties.${k}`, seen);
    }
  }
  if (type === 'array' && Object.hasOwn(node, 'items')) checkSchema(node.items, `${path}.items`, seen);
  seen.delete(node);
}

// Prefer the REAL validator when the DSH runtime is locatable, and always run the
// replica above as well. Deriving it from process.execPath works wherever the
// harness is installed, because verify.mjs is run with the runtime's own node.
let realValidator = null;
const runtimeRoots = [
  process.env.DSH_TOOLS_ENTRY,
  join(dirname(dirname(process.execPath)), 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
].filter(Boolean);
for (const c of runtimeRoots) {
  try {
    const m = await import(pathToFileURL(c).href);
    if (typeof m.assertSupportedJsonSchema === 'function') { realValidator = m.assertSupportedJsonSchema; break; }
  } catch { /* not resolvable here; the replica still runs */ }
}

// ── guard the guard ─────────────────────────────────────────────────────────
// The defect that shipped was a type array. If this checker ever stops rejecting
// one, the test above is worthless — so assert that it does.
{
  const before = problems.length;
  checkSchema({ type: 'object', properties: { x: { type: ['string', 'null'] } } }, 'selftest');
  const caught = problems.some((p) => p.includes('type arrays are not supported'));
  problems.length = before;   // discard the probe
  if (!caught) {
    console.error('SELF-TEST FAILED: the checker no longer rejects type arrays — the shipped defect would pass again.');
    process.exit(1);
  }
  console.log('self-test: the checker rejects type arrays (the defect that shipped)');
}

/** Build a value that satisfies a schema, so render() can be exercised. */
function stub(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.enum) return schema.enum[0];
  if (Array.isArray(schema.oneOf)) return stub(schema.oneOf[0]);   // first branch
  const t = schema.type;                                           // never an array (checked above)
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

  // The real registry runs this exact call inside ctx.tools.register().
  if (realValidator) {
    try {
      realValidator(t.output.schema);
    } catch (e) {
      problems.push(`${t.name}.output.schema rejected by the real validator: ${e.message}`);
    }
  }

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
console.log(`schemas: valid JSON Schema (required is an array, type is a single string)`);
console.log(`schema checks: enforced-subset replica${realValidator ? ' + the REAL dsh-tools validator' : ' (real validator not locatable here)'}`);
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
