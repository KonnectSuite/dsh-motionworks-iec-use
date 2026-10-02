import assert from 'node:assert/strict';
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mwtFixture } from './mwt_fixture.mjs';

// Keep helpers absent from the virtual archive, as with files added by a hotfix.
// No IDE is started: only native read/staging fixtures execute in temporary folders.
const root = mkdtempSync(join(tmpdir(), 'mw-packaged-'));
const repo = resolve(import.meta.dirname, '..');
const virtual = join(root, 'app.asar', 'dsh', 'node_modules', 'motionworks');
const physical = virtual.replace('app.asar', 'app.asar.unpacked');
let mod;
try {
  for (const p of [virtual, physical]) {
    mkdirSync(p, { recursive: true });
    for (const f of (p === virtual ? ['index.js', 'package.json'] : ['index.js', 'verification.js', 'edit-session.js', 'native-variables.js', 'native-structure.js', 'native-code.js', 'graphical-listing.js', 'pou-package.js', 'pou-conversion.js', 'fb-insertion.js', 'package.json'])) copyFileSync(join(repo, f), join(p, f));
  }
  cpSync(join(repo, 'code'), join(physical, 'code'), { recursive: true });
  cpSync(join(repo, 'bridge'), join(physical, 'bridge'), { recursive: true });
  cpSync(join(repo, 'docs'), join(physical, 'docs'), { recursive: true });
  copyFileSync(join(repo, 'SKILL.md'), join(physical, 'SKILL.md'));
  mod = await import(pathToFileURL(join(virtual, 'index.js')).href);
  assert.equal(mod.__internals.HERE, physical);
  assert.ok(!mod.__internals.IPC_DIR.startsWith(root));
  const tools = new Map();
  const skills = [];
  mod.apply({ get: key => key === 'skills' ? {register: s => skills.push(s)} : undefined, tools: { register: t => tools.set(t.name, t) }, on() {} });
  assert.equal(skills.length, 1);
  assert.match(skills[0].content, /VARIABLE_WORKSHEET_WORKFLOW/);
  const variableGuide = await tools.get('mw_ide_edit_guide').execute({operation:'variables'});
  assert.match(variableGuide.variable_guidance, /group-name editor/);
  const graphicalGuide = await tools.get('mw_ide_edit_guide').execute({operation:'graphical'});
  assert.match(graphicalGuide.graphical_guidance, /block type/);
  assert.match(graphicalGuide.graphical_guidance, /Compiler pin ordinals/);
  assert.match(graphicalGuide.graphical_guidance, /source baseline matched exactly/);
  assert.ok(tools.has('mw_code_read_text'));
  const ilGuide = await tools.get('mw_ide_edit_guide').execute({operation:'il'});
  assert.match(ilGuide.text_guidance, /Bridge protocol 4/);
  assert.match(ilGuide.text_guidance, /\.AB/);
  const workspace = join(root, 'workspace');
  mkdirSync(join(workspace, 'Machine'), { recursive: true });
  writeFileSync(join(workspace, 'Machine.mwt'), mwtFixture(join(workspace, 'Machine')));
  const ctx = { agent: { id: 'packaged-session', session: { header: { cwd: workspace } } } };
  const discovered = await tools.get('mw_project_find').execute({}, ctx);
  assert.equal(discovered.workspace, workspace);
  const staged = await tools.get('mw_ide_stage').execute({ source: 'Machine.mwt' }, ctx);
  assert.equal(staged.staged_directory, join(workspace, '.motionworks', 'stage', 'Machine'));
  const binding = await tools.get('mw_code_wrapper_binding').execute({ project: staged.staged_mwt }, ctx);
  assert.equal(binding.stale, 0);
  assert.ok(existsSync(mod.__internals.IPC_DIR));
  assert.ok(!readdirSync(join(physical, 'code')).some(n => /^req-|^res-/.test(n)));
  assert.ok(!existsSync(join(physical, 'bridge', 'req.json')));
  console.log('Packaged ASAR path, physical child helper, private IPC and session workspace checks passed; no IDE invoked');
} finally {
  rmSync(root, { recursive: true, force: true });
  if (mod) rmSync(mod.__internals.IPC_DIR, { recursive: true, force: true });
}
