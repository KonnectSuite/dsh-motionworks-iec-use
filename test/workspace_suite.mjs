import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { __internals as i } from '../index.js';

const root = resolve(import.meta.dirname, '..');
const commands = [
  [process.execPath, ['preflight.mjs']],
  [process.execPath, ['test/render_contract.mjs']],
  [process.execPath, ['test/registration_contract.mjs']],
  [process.execPath, ['test/ide_first.mjs']],
  [process.execPath, ['test/verification_flow.mjs']],
  [process.execPath, ['test/guidance_contract.mjs']],
  [process.execPath, ['test/variable_audit.mjs']],
  [process.execPath, ['test/edit_session.mjs']],
  [process.execPath, ['test/native_variables.mjs']],
  [process.execPath, ['test/native_groups.mjs']],
  [process.execPath, ['test/native_structure.mjs']],
  [process.execPath, ['test/native_code.mjs']],
  [process.execPath, ['test/graphical_listing.mjs']],
  [process.execPath, ['test/pou_package.mjs']],
  [process.execPath, ['test/pou_conversion.mjs']],
  [process.execPath, ['test/fb_insertion.mjs']],
  [process.execPath, ['test/skill_delivery.mjs', root]],
  [process.execPath, ['test/workspace_session.mjs']],
  [process.execPath, ['test/workspace_boundary.mjs']],
  [process.execPath, ['test/stage_copy.mjs']],
  [process.execPath, ['test/packaged_runtime.mjs']],
  [process.execPath, ['test/close_consent.mjs']],
  [i.pythonExe(), ['-B', 'test/workspace_engine.py']],
  [i.pythonExe(), ['-B', 'test/navigation_target.py']],
  [i.pythonExe(), ['-B', 'test/task_settings.py']],
  [i.pythonExe(), ['-B', 'test/task_bindings.py']],
  [i.pythonExe(), ['-B', 'test/structure_reader.py']],
  [i.pythonExe(), ['-B', 'test/st_comments.py']],
  [i.pythonExe(), ['-B', 'test/block_interfaces.py']],
  [i.pythonExe(), ['-B', 'test/installed_help.py']],
  [i.pythonExe(), ['-B', 'test/graphical_listing.py']],
  [i.pythonExe(), ['-B', 'test/reliability_test.py']],
  [i.pythonExe(), ['-B', 'test/workflow_test.py']],
  [i.pythonExe(), ['-B', 'test/pou_deletion_test.py']],
  [i.pythonExe(), ['-B', 'test/knowledge_test.py']],
  [process.execPath, ['test/knowledge_tools.mjs']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/workspace_bridge.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/trial_dialog.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/startup_visibility.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/native_snapshot.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/native_group_reader.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/output_pane.ps1']],
  [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/focus_screenshot.ps1']],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
