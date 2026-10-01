import assert from 'node:assert/strict';
import { verifyAcceptance } from '../verification.js';

const digest = { program_digest: 'program', source_digest: 'native', persistence_digest: 'persistent' };
async function run({ reopen = true, override = () => undefined } = {}) {
  const calls = [], report = { verdict: 'unverified', steps: [] }, occurrences = new Map();
  const step = async (name, args = {}) => {
    const nth = (occurrences.get(name) ?? 0) + 1;
    occurrences.set(name, nth);
    calls.push([name, args, report.phase]);
    const changed = override(name, nth, args);
    if (changed instanceof Error) throw changed;
    const defaults = {
      mw_code_validate: { result: { ok: true } },
      mw_code_source_manifest: { ...digest },
      mw_ide_build: { fresh_compile: true, settled: true, is_compiled: true },
      mw_ide_make: { settled: true, is_compiled: true },
      mw_ide_errors: { errors: [] },
      mw_ide_compile_state: { is_modified: false },
      mw_ide_save: { saved: true, is_modified: false },
      mw_ide_close: { closed: true, window_remaining: false },
      mw_ide_open: { is_project_open: true, matches_request: true, in_stage: true },
    };
    const value = changed ?? defaults[name] ?? {};
    report.steps.push({ tool: name, value });
    return value;
  };
  let error;
  try { await verifyAcceptance({ project: 'C:/test/Stage', activeProject: 'C:/test/Stage.mwt', closeReopen: reopen, step, report }); }
  catch (e) { error = e; }
  return { calls, report, error };
}
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`ok ${name}`); };
await check('complete reopen flow performs fresh Build and Make twice in order', async () => {
  const r = await run();
  assert.equal(r.error, undefined);
  assert.equal(r.report.verdict, 'ide_acceptance_and_persistence_verified');
  const names = r.calls.map(c => c[0]);
  assert.equal(names.filter(n => n === 'mw_ide_build').length, 2);
  assert.equal(names.filter(n => n === 'mw_ide_make').length, 2);
  assert.ok(names.lastIndexOf('mw_ide_build') > names.indexOf('mw_ide_open'));
  assert.deepEqual(r.calls.find(c => c[0] === 'mw_ide_close')[1], { user_approved: true, expected_project: 'C:/test/Stage.mwt' });
  assert.equal(r.report.reopened_compile_source_integrity.program_streams_unchanged, true);
});
await check('no consent route never closes and reports persistence not tested', async () => {
  const r = await run({ reopen: false });
  assert.equal(r.report.verdict, 'ide_compile_verified_persistence_not_tested');
  assert.equal(r.calls.some(c => c[0] === 'mw_ide_close'), false);
});
for (const [name, override, expected] of [
  ['missing validation verdict', (n) => n === 'mw_code_validate' ? {} : undefined, /validation/],
  ['unsaved editor changes', (n) => n === 'mw_ide_compile_state' ? { is_modified: true } : undefined, /Save All/],
  ['unknown editor state', (n) => n === 'mw_ide_compile_state' ? {} : undefined, /Save All/],
  ['save returned false', (n) => n === 'mw_ide_save' ? { saved: false } : undefined, /Save did not/],
  ['close returned false', (n) => n === 'mw_ide_close' ? { closed: false } : undefined, /close did not/],
  ['wrong reopen project', (n) => n === 'mw_ide_open' ? { is_project_open: true, matches_request: false, in_stage: true } : undefined, /requested staged/],
  ['failed validation', (n) => n === 'mw_code_validate' ? { result: { ok: false } } : undefined, /validation/],
  ['missing source digest', (n) => n === 'mw_code_source_manifest' ? {} : undefined, /manifest/],
  ['cached Build', (n) => n === 'mw_ide_build' ? { settled: true, is_compiled: true } : undefined, /fresh Build/],
  ['unsettled Make', (n) => n === 'mw_ide_make' ? { is_compiled: true } : undefined, /Make/],
  ['save failure', (n) => n === 'mw_ide_save' ? new Error('save failed') : undefined, /save failed/],
  ['changed initial program', (n, k) => n === 'mw_code_source_manifest' && k === 2 ? { ...digest, program_digest: 'changed' } : undefined, /program/],
  ['changed persistence', (n, k) => n === 'mw_code_source_manifest' && k === 3 ? { ...digest, persistence_digest: 'changed' } : undefined, /Reopen changed/],
  ['reopened validation missing', (n, k) => n === 'mw_code_validate' && k === 2 ? {} : undefined, /validation/],
  ['reopened Build failure', (n, k) => n === 'mw_ide_build' && k === 2 ? { settled: true, is_compiled: false } : undefined, /reopened/],
  ['reopened Make failure', (n, k) => n === 'mw_ide_make' && k === 2 ? { settled: false } : undefined, /reopened/],
  ['changed reopened program', (n, k) => n === 'mw_code_source_manifest' && k === 4 ? { ...digest, program_digest: 'changed' } : undefined, /Reopened Build/],
  ['diagnostic retrieval failure', (n) => n === 'mw_ide_errors' ? new Error('pane unavailable') : undefined, /pane unavailable/],
]) await check(name + ' cannot pass', async () => {
  const r = await run({ override });
  assert.match(r.error?.message ?? '', expected);
  assert.equal(r.report.verdict, 'unverified');
});
await check('only navigation metadata normalization is tolerated', async () => {
  const r = await run({ override: (n, k) => n === 'mw_code_source_manifest' && k >= 3 ? { ...digest, source_digest: 'views-normalized' } : undefined });
  assert.equal(r.error, undefined);
  assert.equal(r.report.persistence.normalized_view_metadata, true);
});
console.log(`${count} injected acceptance-flow regressions passed (no IDE or controller invoked)`);
