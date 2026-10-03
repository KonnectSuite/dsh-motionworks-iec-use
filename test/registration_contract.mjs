/**
 * Registration contract: `apply()` must REGISTER every tool it defines.
 *
 * WHY THIS EXISTS. Every other test in this suite drives the tools directly
 * (`defineTools()[i].execute(...)`), which is not how DSH reaches them. DSH calls
 * `ctx.tools.register(...)` once per tool, and `register` runs
 * `assertSupportedJsonSchema(output.schema)` BEFORE inserting anything. The loop in
 * `apply()` has no try/catch, so ONE violating schema throws out of `apply()` and
 * every later tool is lost.
 *
 * That is not hypothetical. 14 tools declared `required` names that were never
 * declared in `properties`. `apply()` threw on the first of them
 * (`mw_ide_pou_convert`) and registered 0 of 61 tools. The bundle installed cleanly,
 * `preflight` counted 61 definitions, every Node test passed, and the running chat
 * exposed the skill with no tools at all. `packaged_runtime.mjs` did not catch it
 * because it calls `defineTools()` too.
 *
 * So this test registers the way DSH does. It is the one check that would have
 * failed.
 *
 * Static and dependency-free: no Cordis context, no IDE, no staged project.
 *
 * Run:  node test/registration_contract.mjs
 */
import assert from 'node:assert/strict';
import { apply, __internals } from '../index.js';
import { checkToolContract, checkSchema } from '../tool-contract.mjs';

const defined = __internals.defineTools();
assert.ok(defined.length > 0, 'defineTools() returned nothing; this check would be vacuous');

// ── 1. every schema must be inside the subset register() enforces ────────────────
const { output, parameters, shape } = checkToolContract(defined);

if (shape.length) {
  console.error(`registration contract: ${shape.length} tool(s) lack { schema, render }:`);
  for (const f of shape) console.error(`  ${f.tool}: ${f.violation}`);
  process.exit(1);
}
if (output.length) {
  console.error(`registration contract: ${output.length} OUTPUT schema violation(s). `
    + 'register() throws JsonSchemaError on each of these, so apply() aborts here:');
  for (const f of output) console.error(`  ${f.tool}: ${f.violation}`);
  process.exit(1);
}
if (parameters.length) {
  console.error(`registration contract: ${parameters.length} PARAMETER schema violation(s) `
    + '(outside the documented authoring subset, and asserted by DSH defineTool):');
  for (const f of parameters) console.error(`  ${f.tool}: ${f.violation}`);
  process.exit(1);
}

// ── 2. apply() must survive a register() that enforces the real guards ───────────
const registered = [];
let failed = null;
const ctx = {
  get: () => undefined,
  on() {},
  logger: { warn() {} },
  tools: {
    register(definition) {
      // the guards from ToolRuntime.register, in its order
      if (definition.output === undefined || typeof definition.output !== 'object'
          || typeof definition.output.render !== 'function') {
        throw new TypeError(`tool "${definition.name}" must declare output { schema, render, presentationMeta? }`);
      }
      const violations = checkSchema(definition.output.schema, 'schema');
      if (violations.length) {
        throw new Error(`JsonSchemaError: unsupported JSON schema: ${violations.join('; ')}`);
      }
      registered.push(definition);
    },
  },
};

try {
  apply(ctx);
} catch (error) {
  failed = `${error.name}: ${String(error.message).slice(0, 200)}`;
}

if (failed) {
  console.error('registration contract: apply() threw, so DSH registers only the tools before it:');
  console.error(`  ${failed}`);
  console.error(`  registered ${registered.length} of ${defined.length} defined tool(s)`);
  process.exit(1);
}

assert.equal(registered.length, defined.length,
  `apply() defined ${defined.length} tool(s) but registered ${registered.length}`);

// ── 3. names must be unique, and none may be the reserved transport name ─────────
const names = registered.map((t) => t.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
assert.equal(dupes.length, 0, `duplicate tool name(s): ${[...new Set(dupes)].join(', ')}`);
assert.ok(!names.includes('run_code'), 'run_code is reserved for the PTC transport and cannot be registered');
// Large bodies/inventories must not be re-emitted into the agent's context.
for(const name of ['mw_ide_code_change','mw_ide_variable_change']){
  const tool=registered.find(t=>t.name===name);
  const value={pou:'Main',action_performed:true,verification:{accepted:false,errors:['Mismatch']},
    body:'RETURN;\r\n'.repeat(2322),baseline:Array(159).fill({name:'Keep'}),expected_variables:Array(160).fill({name:'Keep'}),
    native_result:{saved:true,is_modified:false,variables:Array(160).fill({name:'Keep'})},evidence_path:'retained.json',next_step:'STOP'};
  const compact=tool.output.render({},value)[0].text;
  assert.ok(compact.length<1000,`${name} compact output is too large`);
  assert.equal(JSON.parse(compact).verification.accepted,false);
  assert.equal(JSON.parse(compact).evidence_path,'retained.json');
  assert.deepEqual(JSON.parse(tool.output.render({detailed_result:true},value)[0].text),value);
}

console.log(`registration contract: ${registered.length} tool(s) registered, `
  + `${names.length} unique name(s), 0 schema violation(s)`);
