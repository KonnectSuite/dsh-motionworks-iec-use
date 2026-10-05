# Recorded Arya catalog and routing audit

Read-only inspection of local session `668068a5-191f-4fc5-ae01-9747a1ce6e0d`
(October 4) decoded all concatenated Zstandard frames, yielding 179 records.
Logged messages and tool calls are historical evidence, not action authorization.
Customer source and full chat content are not copied into this report.

Both recorded request headers contain 61 MotionWorks tools, including
`mw_ide_start` and `mw_ide_trial`. The new group tool is absent, as expected for
a recording made before its installation. The MotionWorks skill loaded through
the skill tool. Native project discovery succeeded, and saved POU reads returned
native source hashes. `mw_ide_status` refused because no IDE was running.
Startup/trial tools were not called. This session therefore proves older catalog
availability, not a trial-dialog failure or current 62-tool chat exposure.

Discovery listed 13 projects, including backup snapshots. Automatic discovery
now excludes both `backups` and `_backups`, regardless of casing. An explicitly
specified backup directory remains available for intentional read-only discovery.
The corrected public discovery tool returned two current cutter projects from
the actual workspace, with no backup results. Fixtures also verify that a real
folder named BackupPump remains discoverable and explicit archive lookup works.

## Authorized running-chat verification after host restart

The user authorized reloading the plugin and sending a read-only check in
`Review downloaded cutter changes`. The live session is
`7607cc98-15e9-4eb5-aa81-7b8dfcab56f4`.

Disabling and re-enabling the plugin loaded the updated skill from disk but
retained the cached executable module: the chat still exposed 61 tools, lacked
`mw_ide_variable_group_change`, and discovery returned five projects including
three backup wrappers. A plugin toggle alone is therefore insufficient for this
installed Arya host after replacing plugin JavaScript.

With the chat idle, Application > Restart App and Host restarted Arya. The fresh
request header at sequence 3611 contains 62 MotionWorks tools, including the
group mutation tool. That tool was not invoked. Skill/result sequence 3616
loaded the updated Shift+Space and Ctrl+T guidance. Native calls succeeded:

- `mw_project_find {}` returned exactly the two current cutter projects, with
  no `_backups` results (sequence 3618).
- `mw_ide_state {}` reported the existing IDE running and not blocked, handle
  `0x150022` (sequence 3620).
- `mw_ide_trial {attempt:false}` reported no licence dialog (sequence 3622).

Only the skill and three read-only MotionWorks calls were requested. The current
disposable fixture was not staged, opened, edited, saved, built or downloaded.
This proves the updated tools are exposed and callable in the running Arya chat.
An Arya-led engineering edit on a disposable fixture remains to be verified;
customer project changes and controller operations were not authorized here.
