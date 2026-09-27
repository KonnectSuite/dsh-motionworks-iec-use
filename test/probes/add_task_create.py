"""Add task creation, through the same COM path that made assignment work.

Measured this round, on the staged project:

    resource = GetObjectByLogicalName('Hardware/Configuration/Resource', 10)
    resource.Tasks.Create('ZzTask2', 'CYCLIC')        -> 5 tasks become 6
    Save()                                            -> the IDE writes PROJECT.TRE itself

    before save   TREE 5 tasks   COM 6 tasks
    after save    TREE 6 tasks   COM 6 tasks
    after reopen  TREE 6 tasks                        <- on disk, not just in memory

So a task can be created, and the plugin has never been able to make one - it can only read them,
two ways, and had no way to add one at all.

It is the same shape as ProgramInstances.Create, which round 37 proved works where the hand-built
tree writer had failed for sixteen rounds. The lesson generalises: reach for the object model
before the file.

Two verbs and one tool:

    create_task      the bridge verb, on the resource's Tasks collection
    delete_task      the counterpart, since a task that can be made should be removable
    mw_code_task_create   the tool, with a dry_run that reports what would happen

A task's cycle is its Type, read back from the IDE: this project has BG as DEFAULT, FastTsk,
MedTsk and SlowTsk as CYCLIC, and Start as SYSTEM.
"""
import sys
from pathlib import Path

VERBS = r'''
            'create_task' {
                $app = Connect-App
                if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
                $name = [string]$req.name
                $kind = [string]$req.kind
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'create_task requires "name"' }
                if ([string]::IsNullOrWhiteSpace($kind)) { $kind = 'CYCLIC' }

                $resource = $app.ActiveProject.GetObjectByLogicalName(
                    'Hardware/Configuration/Resource', 10)
                if ($resource -eq $null) { throw 'no resource found in the active project' }
                $tasks = $resource.Tasks
                $before = $tasks.Count

                foreach ($i in 1..$before) {
                    if ([string]$tasks.Item($i).Name -eq $name) {
                        throw "a task named '$name' already exists"
                    }
                }

                $tasks.GetType().InvokeMember('Create', 'InvokeMethod', $null, $tasks,
                    @([string]$name, [string]$kind)) | Out-Null
                $after = $tasks.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $names = @()
                for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                $made = $null
                for ($i = 1; $i -le $tasks.Count; $i++) {
                    if ([string]$tasks.Item($i).Name -eq $name) { $made = $tasks.Item($i) }
                }
                $ok = $true
                $data = [ordered]@{
                    created      = $true
                    name         = $name
                    cycle        = $kind
                    before       = $before
                    after        = $after
                    tasks        = $names
                    logical_name = if ($made) { [string]$made.LogicalName } else { $null }
                }
            }

            'delete_task' {
                $app = Connect-App
                if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'delete_task requires "name"' }

                $resource = $app.ActiveProject.GetObjectByLogicalName(
                    'Hardware/Configuration/Resource', 10)
                if ($resource -eq $null) { throw 'no resource found in the active project' }
                $tasks = $resource.Tasks
                $before = $tasks.Count

                $hit = -1
                for ($i = 1; $i -le $tasks.Count; $i++) {
                    if ([string]$tasks.Item($i).Name -eq $name) { $hit = $i; break }
                }
                if ($hit -lt 0) {
                    $names = @()
                    for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                    throw "no task named '$name'. Tasks: $($names -join ', ')"
                }
                $task = $tasks.Item($hit)
                $kids = $task.ProgramInstances.Count
                if ($kids -gt 0) {
                    throw "task '$name' still has $kids program instance(s) assigned; unassign them first"
                }
                $task.Delete()
                $after = $tasks.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $names = @()
                for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                $ok = $true
                $data = [ordered]@{
                    deleted = $true
                    name    = $name
                    before  = $before
                    after   = $after
                    tasks   = $names
                }
            }

'''

TOOL = """    {
      name: 'mw_code_task_create',
      description:
        'Create a task in the project, through the IDE\\'s own object model - '
        + 'resource.Tasks.Create(name, cycle) then Save(), so the IDE writes the project tree '
        + 'itself and nothing here edits a file. This is the counterpart of mw_code_pou_assign: '
        + 'assign puts a program INTO a task, and this makes the task to put it in. Measured: the '
        + 'task survives the save, appears to mw_code_tasks (which reads the tree) and to '
        + 'mw_code_task_model (which reads COM), and is still there after a close and reopen. '
        + 'The cycle is the task\\'s Type as the IDE reports it - this project uses DEFAULT for the '
        + 'background task, CYCLIC for the periodic ones, and SYSTEM for Start. A task starts with '
        + 'no programs assigned; use mw_code_pou_assign to add them. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Name for the new task, e.g. "MyTsk".' },
          kind: { type: 'string', description: 'Cycle type: CYCLIC (default), DEFAULT or SYSTEM.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Create task ${a.name}`, kind: 'edit' }),
      execute: async (args) => {
        const name = args?.name;
        if (args?.dry_run !== false) {
          let existing = null;
          try { existing = (await verb('task_model', {}, 60000)).tasks ?? null; } catch { /* */ }
          const names = existing ? Object.keys(existing) : null;
          return {
            dry_run: true,
            would_create: { name, kind: args?.kind ?? 'CYCLIC' },
            existing_tasks: names,
            note: names?.includes(name)
              ? `a task named ${name} already exists`
              : `This would call Tasks.Create('${name}', '${args?.kind ?? 'CYCLIC'}') then save. Pass dry_run:false to do it.`,
          };
        }
        return verb('create_task', {
          name: String(name),
          ...(args?.kind ? { kind: String(args.kind) } : {}),
        }, 120000);
      },
    },

    {
      name: 'mw_code_task_delete',
      description:
        'Delete a task, through the IDE\\'s own object model - Task.Delete() then Save(). Refuses '
        + 'while programs are still assigned to it, and names them, because deleting a task that '
        + 'is running code should be deliberate. Unassign first with mw_code_pou_unassign, or use '
        + 'mw_code_pou_delete to remove the programs themselves. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Task to delete.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Delete task ${a.name}`, kind: 'edit' }),
      execute: async (args) => {
        const name = args?.name;
        if (args?.dry_run !== false) {
          let info = null;
          try { info = (await verb('task_model', {}, 60000)).tasks?.[name] ?? null; } catch { /* */ }
          return {
            dry_run: true,
            would_delete: name,
            currently: info,
            note: !info
              ? `no task named ${name}`
              : (info.instances ?? []).length
                ? `task ${name} has ${info.instances.length} program(s) assigned; unassign them first`
                : `This would delete task ${name} and save. Pass dry_run:false to do it.`,
          };
        }
        return verb('delete_task', { name: String(name) }, 120000);
      },
    },

"""


def main() -> None:
    bridge = Path(sys.argv[1])
    t = bridge.read_text(encoding="utf-8")
    anchor = "            'assign_pou' {"
    assert anchor in t, "assign_pou anchor missing"
    t = t.replace(anchor, VERBS.lstrip("\n") + anchor, 1)
    bridge.write_text(t, encoding="utf-8")
    print(f"  create_task / delete_task added to {bridge.name}")

    js = Path(sys.argv[2])
    t = js.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in t else "\n"
    marker = "name: 'mw_code_task_model',"
    assert marker in t, "task_model anchor missing"
    i = t.index(marker)
    start = t.rindex("    {", 0, i)
    t = t[:start] + TOOL.replace("\n", nl) + t[start:]
    js.write_text(t, encoding="utf-8")
    print(f"  mw_code_task_create / mw_code_task_delete added to {js.name}")


if __name__ == "__main__":
    main()
