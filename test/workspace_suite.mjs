import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { __internals as i } from '../index.js';

const root = resolve(import.meta.dirname, '..');
const commands = [
  [process.execPath, ['preflight.mjs']],
  [process.execPath, ['test/render_contract.mjs']],
  [process.execPath, ['test/ide_first.mjs']],
  [process.execPath, ['test/verification_flow.mjs']],
  [process.execPath, ['test/guidance_contract.mjs']],
  [process.execPath, ['test/variable_audit.mjs']],
  [process.execPath, ['test/edit_session.mjs']],
  [process.execPath, ['test/skill_delivery.mjs', root]],
  [process.execPath, ['test/workspace_session.mjs']],
  [process.execPath, ['test/workspace_boundary.mjs']],
  [process.execPath, ['test/packaged_runtime.mjs']],
  [process.execPath, ['test/close_consent.mjs']],
  [i.pythonExe(), ['-B', 'test/workspace_engine.py']],
  [i.pythonExe(), ['-B', 'test/reliability_test.py']],
  [i.pythonExe(), ['-B', 'test/workflow_test.py']],
  [i.pythonExe(), ['-B', 'test/pou_deletion_test.py']],
  [i.pythonExe(), ['-B', 'test/knowledge_test.py']],
  [process.execPath, ['test/knowledge_tools.mjs']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/workspace_bridge.ps1']],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
