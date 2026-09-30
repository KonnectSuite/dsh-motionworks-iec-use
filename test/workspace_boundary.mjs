import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply, __internals as i } from '../index.js';
import { mwtFixture } from './mwt_fixture.mjs';

// All mutations are confined to fresh temporary workspaces. No IDE is started.
const root = mkdtempSync(join(tmpdir(), 'mw-boundary-'));
const tools = new Map();
apply({ get: () => undefined, tools: { register: t => tools.set(t.name, t) }, on() {} });
const run = (name, args, ws, id = 'session') => tools.get(name).execute(args, {
  agent: { id, session: { header: { cwd: ws } } },
});
let count = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { count++; console.log(`ok ${name}`); });
function source(ws) {
  mkdirSync(join(ws, 'Machine'), { recursive: true });
  writeFileSync(join(ws, 'Machine.mwt'), mwtFixture(join(ws, 'Machine')));
  writeFileSync(join(ws, 'Machine', 'marker.txt'), ws);
  return join(ws, 'Machine.mwt');
}
try {
  const a = join(root, 'a'), b = join(root, 'b');
  const sourceA = source(a), sourceB = source(b);
  const original = readFileSync(sourceA);
  delete process.env.MOTIONWORKS_MCP_WORKSPACE;
  await check('missing session refuses rather than using process cwd', async () => {
    await assert.rejects(tools.get('mw_project_find').execute({}, {}), /no session workspace/);
  });
  await check('outside discovery and staging are refused', async () => {
    await assert.rejects(run('mw_project_find', { root: b }, a), /REFUSED/);
    await assert.rejects(run('mw_ide_stage', { source: sourceB }, a), /outside the workspace/);
  });
  let stagedA, stagedB;
  await check('overlapping sessions stage into their own workspace', async () => {
    [stagedA, stagedB] = await Promise.all([
      run('mw_ide_stage', { source: 'Machine.mwt' }, a, 'a'),
      run('mw_ide_stage', { source: 'Machine.mwt' }, b, 'b'),
    ]);
    assert.equal(stagedA.staged_directory, join(a, '.motionworks', 'stage', 'Machine'));
    assert.equal(stagedB.staged_directory, join(b, '.motionworks', 'stage', 'Machine'));
    assert.equal(stagedA.bound_to, stagedA.staged_directory);
    assert.equal(stagedB.bound_to, stagedB.staged_directory);
    assert.equal(readFileSync(join(stagedA.staged_directory, 'marker.txt'), 'utf8'), a);
    assert.deepEqual(readFileSync(sourceA), original);
  });
  await check('both sessions can use their own staged project concurrently', async () => {
    const results = await Promise.all([
      run('mw_code_pous', {}, a, 'a'), run('mw_code_pous', {}, b, 'b'),
    ]);
    assert.equal(results[0].project, stagedA.staged_directory);
    assert.equal(results[1].project, stagedB.staged_directory);
  });
  await check('another workspace copy cannot be read, edited, or opened as the active project', async () => {
    for (const [name, args] of [
      ['mw_ide_open', { path: stagedB.staged_mwt }],
      ['mw_code_pous', { project: stagedB.staged_directory }],
      ['mw_code_write_st', { project: stagedB.staged_directory, pou: 'P', body: '', dry_run: false }],
    ]) await assert.rejects(run(name, args, a), /REFUSED/);
  });
  await check('staging an existing stage cannot delete its source', async () => {
    await assert.rejects(run('mw_ide_stage', { source: stagedA.staged_mwt }, a), /existing staged copy/);
    assert.ok(existsSync(stagedA.staged_mwt));
  });
  await check('tampered identity is refused', async () => {
    const file = join(a, '.motionworks', 'stage', 'Machine.identity.json');
    const raw = readFileSync(file, 'utf8');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(raw), workspace: b }));
    await assert.rejects(run('mw_code_pous', {}, a), /no staged copy/);
    writeFileSync(file, raw);
  });
  await check('wrapper pointing elsewhere is refused before any IDE call', async () => {
    copyFileSync(sourceA, stagedA.staged_mwt);
    await assert.rejects(run('mw_ide_open', { path: stagedA.staged_mwt }, a), /wrapper is not bound/);
  });
  await check('junction to another workspace cannot be staged', async () => {
    copyFileSync(sourceA, join(a, 'Linked.mwt'));
    symlinkSync(join(b, 'Machine'), join(a, 'Linked'), 'junction');
    await assert.rejects(run('mw_ide_stage', { source: join(a, 'Linked.mwt') }, a), /both be inside/);
  });
  await check('session IDs require exact matches', async () => {
    const registered = new Map();
    apply({
      get: name => name === 'workspaceRegistry' ? { list: () => [{ path: b, sessionIds: ['prefix-session'] }] } : undefined,
      tools: { register: t => registered.set(t.name, t) }, on() {},
    });
    await assert.rejects(registered.get('mw_project_find').execute({}, { agent: { id: 'session' } }), /no workspace path/);
  });
  console.log(`${count} workspace boundary checks passed`);
} finally {
  // root comes directly from mkdtempSync; no project or user-supplied path is removed.
  rmSync(root, { recursive: true, force: true });
}
