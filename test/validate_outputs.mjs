/**
 * Validate every tool's ACTUAL OUTPUT against its own declared schema.
 *
 * This is the test that was missing, and its absence is why mw_code_pous shipped
 * broken: the code engine adds "ok" to every response, the tool schema declared
 * additionalProperties:false, and DSH validates tool output against that schema.
 * A Node test that calls execute() and looks at the value never notices. Failure
 * only appears when the harness runs the tool - so the tool passed every test I had
 * and failed the first time it was called for real.
 *
 * Uses the REAL validateJsonSchemaValue from @deepseek-ai/dsh-tools, located via
 * process.execPath, so this is the same check the harness performs.
 *
 * Run:  node test/validate_outputs.mjs
 */
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Which plugin to test. Defaults to this checkout, but the INSTALLED copy is what
 * DSH actually loads and it keeps its OWN staging root - so a test run against the
 * source plugin silently reads a different stage/ and reports "no POU named ..."
 * for a POU that plainly exists. Set MW_PLUGIN to compare like with like:
 *
 *   MW_PLUGIN=<profile>\node_modules\dsh-motionworks-iec-use node test/validate_outputs.mjs
 */
const PLUGIN = process.env.MW_PLUGIN
  ?? 'C:\\Users\\KNPhu\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\motionworks-iec-use';
const mod = await import(`file:///${PLUGIN.replace(/\\/g, '/')}/index.js`);
console.log(`plugin: ${PLUGIN}`);

// â”€â”€ the real validator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let validate = null;
const runtimeEntry = join(dirname(dirname(process.execPath)), 'node_modules',
  '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
try {
  const dsh = await import(pathToFileURL(runtimeEntry).href);
  validate = dsh.validateJsonSchemaValue;
  console.log(`validator: REAL (${validate ? 'validateJsonSchemaValue' : 'not exported'})`);
} catch (e) {
  console.log(`validator: UNAVAILABLE (${e.message}) â€” cannot run this check`);
  process.exit(2);
}
if (typeof validate !== 'function') { console.log('validateJsonSchemaValue missing'); process.exit(2); }

const tools = mod.__internals.defineTools();

/**
 * Safe arguments per tool: reads run as-is, writes run as dry_run so nothing
 * changes. Tools needing a live IDE are exercised too - a clean error is a pass
 * for THIS check, which is about output shape, not IDE availability.
 */
const ARGS = {
  mw_ide_status: {}, mw_ide_start: null, mw_ide_close: null, mw_ide_trial: {},
  mw_ide_screenshot: null, mw_ide_pous: null, mw_ide_variables: {},
  mw_ide_make: null, mw_ide_build: null, mw_ide_errors: { pane: 'Errors' },
  mw_ide_open: { path: '(skipped)' }, mw_ide_dialog: { button: 'OK' },
  mw_ide_state: {}, mw_ide_compile_state: {},
  mw_code_tasks: {},
  mw_code_pous: {}, mw_code_globals: {}, mw_code_unsupported: {}, mw_code_read_st: { pou: 'AgentProof' },
  mw_code_write_st: { pou: 'AgentProof', body: '(* probe *)\r\n', dry_run: true },
  mw_code_var_add: { pou: 'AgentProof', name: 'ProbeX', type: 'BOOL', dry_run: true },
  mw_code_var_edit: { pou: 'AgentProof', name: 'Running', description: 'probe', dry_run: true },
  mw_code_var_delete: { pou: 'AgentProof', name: 'Running', dry_run: true },
  mw_code_pou_create: { name: 'ProbePou', template: 'TopCutterInitialize', dry_run: true },
  mw_code_pou_delete: { name: 'AgentProof', dry_run: true },
};

console.log('');
console.log(`${'tool'.padEnd(24)} ${'outcome'.padEnd(9)} detail`);
console.log('-'.repeat(96));

let checked = 0, bad = 0, skipped = 0;
const failures = [];

for (const tool of tools) {
  const args = ARGS[tool.name];
  if (args === null || args === undefined) {
    console.log(`${tool.name.padEnd(24)} ${'SKIP'.padEnd(9)} dangerous or not applicable`);
    skipped++;
    continue;
  }
  let value;
  try {
    value = await tool.execute(args, {});
  } catch (e) {
    // A thrown error is DSH's error path, not an output-validation path.
    console.log(`${tool.name.padEnd(24)} ${'error'.padEnd(9)} ${String(e.message).split('\n')[0].slice(0, 60)}`);
    continue;
  }

  checked++;
  const schema = tool.output?.schema;
  if (!schema) {
    console.log(`${tool.name.padEnd(24)} ${'FAIL'.padEnd(9)} no output schema`);
    failures.push(`${tool.name}: no schema`);
    bad++;
    continue;
  }
  const verdict = validate(schema, value);
  if (verdict === true || (verdict && verdict.valid !== false && verdict.ok !== false)) {
    console.log(`${tool.name.padEnd(24)} ${'ok'.padEnd(9)} ${JSON.stringify(value).slice(0, 56)}`);
  } else {
    const detail = typeof verdict === 'string' ? verdict
      : JSON.stringify(verdict?.errors ?? verdict).slice(0, 200);
    console.log(`${tool.name.padEnd(24)} ${'FAIL'.padEnd(9)} ${detail}`);
    failures.push(`${tool.name}: ${detail}`);
    bad++;
  }
}

console.log('');
console.log(`checked ${checked}, failed ${bad}, skipped ${skipped}`);
if (failures.length) {
  console.log('');
  console.log('OUTPUT-SCHEMA FAILURES (these throw "returned invalid output" in the harness):');
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(bad === 0 ? 0 : 1);
