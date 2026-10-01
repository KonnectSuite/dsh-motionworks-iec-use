import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

const workspace = mkdtempSync(join(tmpdir(), 'mw-knowledge-tools-'));
const definitions = [];
const ctx = {
  get: () => undefined, tools: { register: d => definitions.push(d) },
  on() {}, logger: { warn() {} },
};
apply(ctx);
const context = { agent: { id: 'knowledge-test', session: { header: { cwd: workspace } } } };
async function call(name, args = {}) {
  const tool = definitions.find(d => d.name === name);
  assert.ok(tool, `${name} is registered`);
  const response = await tool.execute(args, context);
  assert.notEqual(response.ok, false, JSON.stringify(response));
  return response.result;
}
try {
  assert.equal(definitions.length, 51);
  assert.ok((await call('mw_code_reference')).sources.length >= 6);
  assert.ok((await call('mw_code_reference', { query: 'VAR_EXTERNAL' })).topics.length);
  assert.equal((await call('mw_code_reference', { block: 'MC_Power' })).signature.outputs.Status, 'BOOL');
  assert.equal((await call('mw_code_diagnose', { message: 'Error in native code generation' })).matched, true);
  assert.equal((await call('mw_code_diagnose', { message: 'Unrecognized diagnostic 99887' })).matched, false);
  assert.equal((await call('mw_code_pattern')).patterns.length, 4);
  assert.ok((await call('mw_code_pattern', { name: 'request-edge' })).body);
  assert.ok(definitions.find(d => d.name === 'mw_code_reference_sync').parameters.properties.source_ids.items.enum.includes('toolbox'));
  const review = definitions.find(d => d.name === 'mw_code_check_program');
  await assert.rejects(() => review.execute({ project: join(tmpdir(), 'outside-project') }, context), /workspace|stage|REFUSED/i);
  assert.ok(!readdirSync(workspace).some(n => n.endsWith('.pdf')), 'curated queries do not download manuals');
  console.log(`10 knowledge tool integration checks passed; ${definitions.length} tools registered.`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
