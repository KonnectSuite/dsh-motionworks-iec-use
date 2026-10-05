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

Next verify the running Arya chat after reload and an Arya-led engineering flow.
Installed-host registration and historical successful calls do not establish
that end-to-end result.
