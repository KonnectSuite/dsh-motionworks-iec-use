import assert from 'node:assert/strict';
import { apply, __internals } from '../index.js';
const check = __internals.compareVariables;
const row = (name, type = 'INT', section = 'VAR') => ({name, type, section,
  group:'Default', address:null, initial_value:null, description:null});
const baseline = [row('TopCutterCamTableID', 'UINT', 'VAR_EXTERNAL'), row('iState')];
const added = row('EIP_FromCLX_TC_EyeToKnifeDistMil', 'INT', 'VAR_EXTERNAL');
const plan = [...baseline, added];
assert.equal(check(plan, [...plan].reverse()).accepted, true);
// Exact reported failure: intended name replaces group, INT overwrites first name,
// row count unchanged. The intended addition never occurred.
const damaged = baseline.map(v => ({...v, group:added.name}));
damaged[0].name = 'INT';
const failure = check(plan, damaged);
assert.equal(failure.accepted, false);
assert.deepEqual(failure.missing, ['TopCutterCamTableID', added.name]);
assert.deepEqual(failure.unexpected, ['INT']);
assert.deepEqual(failure.changed[0].fields, ['group']);
assert.equal(failure.saved_count, 2);
assert.equal(failure.expected_count, 3);
for (const field of ['type','section','group','address','initial_value','description']) {
  const changed = plan.map(v => ({...v}));
  changed[0][field] = 'wrong';
  assert.equal(check(plan, changed).accepted, false, field);
  assert.ok(check(plan, changed).changed[0].fields.includes(field));
}
assert.equal(check(plan, [...plan, {...added, name:added.name.toLowerCase()}]).accepted, false);
assert.equal(check(plan, plan.map(v => ({...v, name:v.name.toLowerCase()}))).accepted, false);
assert.equal(check(baseline, baseline).accepted, true); // repaired existing rows
assert.equal(check([baseline[1]], [baseline[1]]).accepted, true); // intentional removal
assert.equal(check([], []).accepted, true);
assert.throws(() => check([{name:'Partial'}], []), /every declaration field/);
assert.throws(() => check(plan, undefined), /must be an array/);
const tools = new Map();
apply({get:()=>undefined, tools:{register:t=>tools.set(t.name,t)},on(){}});
const tool = tools.get('mw_code_verify_variables');
assert.ok(tool);
assert.ok(Array.isArray(tool.output.render({}, failure)));
assert.equal(tool.parameters.properties.expected_variables.items.required.length, 7);
console.log('Variable audit: reported corruption, metadata, missing/extra/duplicate rows, exact repair and schema coverage passed; no IDE input');
