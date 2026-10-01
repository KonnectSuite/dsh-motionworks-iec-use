/** Explicit, isolated IDE smoke test. Never touches controllers or the supplied source.
 * node test/live_acceptance.mjs --workspace <existing writable folder> --source <mwt>
 * --approve-disposable-ide-close permits closing ONLY the copy created by this run.
 */
import assert from 'node:assert/strict';
throw new Error('RETIRED offline-write runner: use docs/IDE_FIRST_WORKFLOW.md for observed native IDE smoke tests. No IDE action was performed.');
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { apply, __internals } from '../index.js';

const argv = process.argv.slice(2);
const option = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };
const sourceOption = option('--source'), workspaceOption = option('--workspace');
if (!sourceOption || !workspaceOption || !argv.includes('--approve-disposable-ide-close')) {
  console.error('Provide --workspace, --source and --approve-disposable-ide-close. No default production project or implicit close.');
  process.exit(2);
}
const source = resolve(sourceOption), sourceDir = source.replace(/\.mwt$/i, '');
assert(/\.mwt$/i.test(source) && existsSync(sourceDir), 'Source must have a sibling expanded directory');
assert(existsSync(resolve(workspaceOption)), 'Explicit workspace parent must exist');
const workspace = join(resolve(workspaceOption), 'motionworks-smoke-' + randomUUID());
mkdirSync(workspace);
const reportPath = join(workspace, 'acceptance.json');
const report = { workspace, source, started_at: new Date().toISOString(), cases: [],
  controller_downloaded: false, source_unchanged: null, verdict: 'running' };
const hashTree = root => {
  const files = {};
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      assert(!e.isSymbolicLink(), 'Smoke fixture must not contain links');
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), name);
      else if (e.isFile()) files[name] = createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex');
    }
  };
  walk(root); return files;
};
const before = hashTree(sourceDir);
const wrapperBefore = readFileSync(source);
const input = join(workspace, basename(source));
cpSync(source, input);
cpSync(sourceDir, input.replace(/\.mwt$/i, ''), { recursive: true });
const tools = new Map();
apply({ get: () => undefined, tools: { register: t => tools.set(t.name, t) }, on() {} });
const ctx = { agent: { id: 'smoke-' + randomUUID(), session: { header: { cwd: workspace } } } };
const run = async (name, args = {}) => {
  console.log('RUN', name, args.pou ?? '');
  const started = Date.now();
  try {
    const value = await tools.get(name).execute(args, ctx);
    report.cases.push({ tool: name, args, elapsed_ms: Date.now() - started, value });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return value;
  } catch (error) {
    report.cases.push({ tool: name, args, error: error.message });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    throw error;
  }
};
let project;
const close = async () => run('mw_ide_close', { user_approved: true, expected_project: project + '.mwt' });
const open = async () => {
  await run('mw_ide_start', { project });
  await run('mw_ide_open', { path: project + '.mwt' });
};
try {
  // Existing IDE users are not silently interrupted. The initial offline edit gate
  // refuses if an IDE is running; the runner never closes an unknown project.
  await run('mw_project_find');
  const staged = await run('mw_ide_stage', { source: input });
  project = staged.staged_directory;
  const ready = await run('mw_workflow_check', { project });
  assert(ready.ready_for_ide_open, JSON.stringify(ready.blockers));
  await run('mw_code_wrapper_binding', { project: project + '.mwt' });
  await run('mw_code_rebind_wrapper', { mwt: project + '.mwt', directory: project });
  for (const name of ['mw_code_types', 'mw_code_library', 'mw_code_tasks', 'mw_code_unsupported', 'mw_code_check_program', 'mw_code_eip_map'])
    await run(name, { project });
  await run('mw_code_sync_back', { project });
  await run('mw_code_reference', { block: 'MC_Power' });
  await run('mw_code_pattern', { name: 'request-edge' });
  await run('mw_code_diagnose', { message: 'File error!: (POE\\Main\\MainV.vbc)' });
  await run('mw_code_manual');
  await run('mw_code_source_manifest', { project });
  const pous = await run('mw_code_pous', { project });
  const target = pous.pous.find(p => p.name === 'TopCutterCutControl') ?? pous.pous.find(p => p.has_st_body);
  assert(target, 'Fixture needs a native ST POU');
  const code = await run('mw_code_read_st', { project, pou: target.name });
  const locals = code.variables ?? [];
  const donor = locals.find(v => v.type === 'BOOL' && v.section === 'VAR');
  const ext = locals.find(v => v.type === 'BOOL' && v.section === 'VAR_EXTERNAL');
  assert(donor && ext, 'Fixture needs native BOOL local and external donors');
  const globals = await run('mw_code_globals', { project });
  const gd = globals.variables.find(v => v.type === 'BOOL' && !v.address);
  assert(gd, 'Fixture needs a native global BOOL donor');
  const args = { project, pou: target.name, variables: [
    { name: 'SmokeLocal', type: 'BOOL', donor: donor.name, initial_value: 'FALSE', description: 'Smoke local & description' },
    { name: 'SmokeSecond', type: 'BOOL', donor: donor.name, initial_value: 'FALSE' },
  ] };
  const previewBefore = await run('mw_code_source_manifest', { project });
  await run('mw_code_var_add_many', args);
  assert.equal((await run('mw_code_source_manifest', { project })).source_digest, previewBefore.source_digest, 'Preview changed native streams');
  await run('mw_code_var_add_many', { ...args, dry_run: false });
  await run('mw_code_var_edit', { project, pou: target.name, name: 'SmokeSecond', new_name: 'SmokeRenamed', description: 'Edited description', dry_run: false });
  await run('mw_code_var_add', { project, name: 'SmokeGlobal', type: 'BOOL', section: 'VAR_GLOBAL', donor: gd.name, initial_value: 'FALSE', description: 'Smoke global', dry_run: false });
  await run('mw_code_var_add', { project, pou: target.name, name: 'SmokeGlobal', type: 'BOOL', section: 'VAR_EXTERNAL', donor: ext.name, dry_run: false });
  const body = code.body + '\r\nSmokeLocal := SmokeGlobal;\r\n';
  await run('mw_code_write_st', { project, pou: target.name, body });
  await run('mw_code_write_st', { project, pou: target.name, body, dry_run: false });
  await run('mw_code_export_pou', { project, pou: target.name, path: join(workspace, 'smoke-export.st') });
  assert.equal((await run('mw_code_read_st', { project, pou: target.name })).body, body);
  await open();
  await run('mw_ide_status');
  await run('mw_ide_pous');
  await run('mw_ide_variables', { pou: target.name });
  await run('mw_ide_compile_state');
  await run('mw_ide_trial', { attempt: false });
  const acceptance = await run('mw_ide_verify', { project, close_reopen: true, user_approved: true });
  assert.equal(acceptance.verdict, 'ide_acceptance_and_persistence_verified', acceptance.error ?? acceptance.next_step);
  await run('mw_code_tasks', { project });
  await run('mw_code_task_model');
  await close();
  // Removal is deliberately verified through the same native compile loop.
  await run('mw_code_write_st', { project, pou: target.name, body: code.body, dry_run: false });
  for (const name of ['SmokeLocal', 'SmokeRenamed', 'SmokeGlobal'])
    await run('mw_code_var_delete', { project, pou: target.name, name, dry_run: false });
  await run('mw_code_var_delete', { project, name: 'SmokeGlobal', dry_run: false });
  // The live cutter contains historical extra NodeProperties records. Its
  // homing POU has the supported four-node layout; do not strip metadata to
  // force a complex template through the writer.
  const cloneTemplate = pous.pous.find(p => p.name === 'ServoHoming') ?? target;
  await run('mw_code_pou_create', { project, name: 'SmokeClone', template: cloneTemplate.name, dry_run: false });
  if (cloneTemplate.has_st_body)
    await run('mw_code_write_st', { project, pou: 'SmokeClone', body: '(* Disposable clone persistence check. *)\r\n', dry_run: false });
  // A native LD donor stays LD; never force graphical bytes through the ST
  // writer. Its cloned body is compiled offline only, never downloaded.
  await open();
  await run('mw_code_pou_assign', { task: 'SlowTsk', pou: 'SmokeClone', dry_run: false });
  const cloned = await run('mw_ide_verify', { project, close_reopen: true, user_approved: true });
  assert.equal(cloned.verdict, 'ide_acceptance_and_persistence_verified', cloned.error ?? cloned.next_step);
  await close();
  await run('mw_code_pou_delete', { project, name: 'SmokeClone', dry_run: false });
  await open();
  const removed = await run('mw_ide_verify', { project, close_reopen: true, user_approved: true });
  assert.equal(removed.verdict, 'ide_acceptance_and_persistence_verified', removed.error ?? removed.next_step);
  await close();
  report.verdict = 'passed';
} catch (error) {
  report.verdict = 'failed_or_blocked'; report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  report.source_unchanged = JSON.stringify(hashTree(sourceDir)) === JSON.stringify(before)
    && readFileSync(source).equals(wrapperBefore);
  if (!report.source_unchanged) {
    report.verdict = 'failed_or_blocked';
    report.error = 'Original fixture changed during the test; investigate before proceeding.';
    process.exitCode = 1;
  }
  report.finished_at = new Date().toISOString();
  const exercised = new Set(report.cases.map(c => c.tool));
  for (const record of report.cases)
    if (record.tool === 'mw_ide_verify')
      for (const step of record.value?.steps ?? []) exercised.add(step.tool);
  report.coverage = [...tools.keys()].map(tool => ({ tool, exercised: exercised.has(tool),
    note: exercised.has(tool) ? 'Inspect individual case result; execution is not necessarily acceptance.' : 'Not exercised in this run; not claimed verified.' }));
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('REPORT', reportPath, 'VERDICT', report.verdict, 'SOURCE_UNCHANGED', report.source_unchanged);
  await __internals.stopBridge();
}
