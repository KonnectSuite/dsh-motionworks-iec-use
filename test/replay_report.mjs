/** Verify real recorded tool values render as harness content blocks; no IDE calls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply } from '../index.js';

assert(process.argv[2], 'Provide the explicit acceptance.json evidence path');
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const definitions = new Map();
apply({ get: () => undefined, tools: { register: tool => definitions.set(tool.name, tool) }, on() {} });
const records = [...(report.cases ?? [])];
for (const record of report.cases ?? [])
  if (record.tool === 'mw_ide_verify') records.push(...(record.value?.steps ?? []));
let rendered = 0, errors = 0;
for (const record of records) {
  if (record.error || record.value === undefined) { errors++; continue; }
  const tool = definitions.get(record.tool);
  assert(tool, `Recorded tool ${record.tool} is no longer registered`);
  const blocks = await tool.output.render(record.args ?? {}, record.value);
  assert(Array.isArray(blocks), `${record.tool} returned primitive content`);
  for (const block of blocks) {
    assert(block && typeof block.type === 'string', `${record.tool} has invalid content`);
    if (block.type === 'text') assert.equal(typeof block.text, 'string', record.tool);
  }
  rendered++;
}
assert(rendered > 0, 'No real tool results were rendered');
console.log(`${rendered} recorded results render as content blocks; ${errors} error records not claimed as verified output`);
console.log('This checks rendering, not DSH JSON-schema validation or machine behavior.');
