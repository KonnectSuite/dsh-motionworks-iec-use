import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createDirectAttachment, findDirectAttachment, listDirectAttachments } from '../direct-attach.js';
import { __internals } from '../index.js';

const workspace = mkdtempSync(join(tmpdir(), 'mw-direct-attach-'));
try {
  const mwt = join(workspace, 'Demo.mwt');
  const directory = mwt.slice(0, -4);
  mkdirSync(directory);
  writeFileSync(mwt, 'wrapper');
  writeFileSync(join(directory, 'PROJECT.TRE'), 'tree');
  const record = createDirectAttachment(workspace, mwt);
  const previousWorkspace = process.env.MOTIONWORKS_MCP_WORKSPACE;
  process.env.MOTIONWORKS_MCP_WORKSPACE = workspace;
  try {
    assert.equal(__internals.assertProven(mwt), mwt);
    assert.equal(__internals.projectOf({ project: mwt }), directory);
    const attachTool = __internals.defineTools().find((tool) => tool.name === 'mw_ide_attach');
    assert(attachTool);
    await assert.rejects(attachTool.execute({ project: mwt, baseline_saved: false }), /approval/);
  } finally {
    if (previousWorkspace === undefined) delete process.env.MOTIONWORKS_MCP_WORKSPACE;
    else process.env.MOTIONWORKS_MCP_WORKSPACE = previousWorkspace;
  }
  assert.equal(record.mode, 'direct');
  assert.equal(findDirectAttachment(workspace, mwt)?.mwt, mwt);
  assert.equal(findDirectAttachment(workspace, directory)?.directory, directory);
  assert.equal(readFileSync(join(record.backup, 'Demo', 'PROJECT.TRE'), 'utf8'), 'tree');
  assert.equal(createDirectAttachment(workspace, mwt).backup, record.backup);
  const sessionOne = createDirectAttachment(workspace, mwt, 'session-one');
  assert.equal(createDirectAttachment(workspace, mwt, 'session-one').backup, sessionOne.backup);
  const sessionTwo = createDirectAttachment(workspace, mwt, 'session-two');
  assert.notEqual(sessionTwo.backup, sessionOne.backup);
  assert.deepEqual(listDirectAttachments(workspace), [directory]);
  const probe = spawnSync(__internals.pythonExe(), ['-B', '-c',
    'from motionworks_iec_mcp.staging import assert_direct_attached, assert_staged, StagingRefused; import sys; assert_direct_attached(sys.argv[1]);\ntry: assert_staged(sys.argv[1])\nexcept StagingRefused: pass\nelse: raise AssertionError("offline writer guard was bypassed")', mwt],
  { env: { ...process.env, MOTIONWORKS_MCP_WORKSPACE: workspace,
    PYTHONPATH: join(resolve(import.meta.dirname, '..'), 'code', 'engine') }, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const request = join(workspace, 'read-request.json');
  const response = join(workspace, 'read-response.json');
  writeFileSync(request, JSON.stringify({ project: directory }));
  const code = join(resolve(import.meta.dirname, '..'), 'code', 'mw_code.py');
  const env = { ...process.env, MOTIONWORKS_MCP_WORKSPACE: workspace };
  const read = spawnSync(__internals.pythonExe(), ['-B', code, 'source_manifest', request, response], { env, encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(readFileSync(response, 'utf8')).ok, true);
  writeFileSync(request, JSON.stringify({ project: directory, pou: 'Main', body: '', dry_run: false }));
  const blocked = spawnSync(__internals.pythonExe(), ['-B', code, 'write_st', request, response], { env, encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.match(JSON.parse(readFileSync(response, 'utf8')).error, /outside the staging root/);
  writeFileSync(record.backup_manifest, 'tampered');
  writeFileSync(sessionOne.backup_manifest, 'tampered');
  writeFileSync(sessionTwo.backup_manifest, 'tampered');
  assert.equal(findDirectAttachment(workspace, mwt), null);
  assert.throws(() => createDirectAttachment(workspace, mwt), /existing direct attachment.*invalid/);
  assert.throws(() => createDirectAttachment(workspace, join(dirname(workspace), 'Outside.mwt')), /REFUSED/);
  console.log('Direct attach: exact workspace identity, verified full backup, tamper refusal');
} finally {
  const target = resolve(workspace);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw Error('Invalid cleanup target');
  rmSync(target, { recursive: true, force: true });
}
