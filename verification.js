// Dependency-injected acceptance flow; the caller owns workspace/identity guards
// and atomic report persistence. No disk editors or controller operations here.
export async function verifyAcceptance({ project, activeProject, closeReopen, step, report }) {
  const validate = async () => {
    const value = await step('mw_code_validate', { project });
    if (value.result?.ok !== true) throw new Error('Offline validation failed or its verdict is missing.');
  };
  const compile = async phase => {
    report.phase = phase;
    const build = await step('mw_ide_build');
    await step('mw_ide_errors', { pane: 'Errors' });
    await step('mw_ide_errors', { pane: 'Warnings' });
    if (build.fresh_compile !== true || build.is_compiled !== true || build.settled !== true) {
      throw new Error(`${phase}: fresh Build completion was not proven; cached flags are insufficient.`);
    }
    const make = await step('mw_ide_make');
    await step('mw_ide_errors', { pane: 'Errors' });
    await step('mw_ide_errors', { pane: 'Warnings' });
    if (make.settled !== true || make.is_compiled !== true) throw new Error(`${phase}: Make completion was not proven.`);
    const save = await step('mw_ide_save');
    if (save.saved !== true || save.is_modified !== false) throw new Error(`${phase}: Save did not prove a clean persisted project; use native Save All and read back.`);
  };
  const manifest = () => step('mw_code_source_manifest', { project });
  const requireDigests = value => {
    for (const key of ['program_digest', 'source_digest', 'persistence_digest']) {
      if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Missing manifest ${key}; acceptance is unverified.`);
    }
  };
  const state = await step('mw_ide_compile_state');
  if (state.is_modified !== false) throw new Error('Save All and read back intended edits first; modified/unknown IDE state cannot certify disk sources.');
  await validate();
  const before = await manifest();
  requireDigests(before);
  await compile('initial');
  const saved = await manifest();
  requireDigests(saved);
  report.compile_source_integrity = {
    program_streams_unchanged: before.program_digest === saved.program_digest,
    native_bookkeeping_changed: before.source_digest !== saved.source_digest,
  };
  if (!report.compile_source_integrity.program_streams_unchanged) throw new Error('Build/save changed program or declaration streams; inspect manifests.');
  if (closeReopen) {
    const closed = await step('mw_ide_close', { user_approved: true, expected_project: activeProject });
    if (closed.closed !== true || closed.window_remaining === true) throw new Error('Approved close did not complete; do not launch another IDE.');
    await step('mw_ide_start');
    const opened = await step('mw_ide_open', { path: project + '.mwt' });
    if (opened.is_project_open !== true || opened.matches_request !== true || opened.in_stage !== true) throw new Error('Reopen did not prove the requested staged project.');
    const after = await manifest();
    requireDigests(after);
    report.persistence = {
      identical_native_streams: saved.source_digest === after.source_digest,
      identical_source_streams: saved.persistence_digest === after.persistence_digest,
      normalized_view_metadata: saved.source_digest !== after.source_digest && saved.persistence_digest === after.persistence_digest,
      before: saved.source_digest, after: after.source_digest,
    };
    if (!report.persistence.identical_source_streams) throw new Error('Reopen changed native source streams; inspect manifest differences.');
    await validate();
    await compile('reopened');
    const rebuilt = await manifest();
    requireDigests(rebuilt);
    report.reopened_compile_source_integrity = { program_streams_unchanged: after.program_digest === rebuilt.program_digest };
    if (!report.reopened_compile_source_integrity.program_streams_unchanged) throw new Error('Reopened Build/save changed program or declaration streams.');
  }
  report.verdict = closeReopen ? 'ide_acceptance_and_persistence_verified' : 'ide_compile_verified_persistence_not_tested';
  report.next_step = 'Compiler acceptance only. Review retained warnings; controller download, performance and machine behavior remain untested.';
  return report;
}
