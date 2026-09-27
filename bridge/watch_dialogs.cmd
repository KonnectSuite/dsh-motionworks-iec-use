@echo off
rem Launches the MotionWorks Use modal-dialog watcher, hidden and detached.
rem
rem The bridge starts this immediately before OpenProject, because that COM call
rem blocks for as long as MotionWorks keeps a prompt on screen - so the prompt can
rem only be answered from another process. It is killed once OpenProject returns
rem or the bridge gives up.
rem
rem Takes the lifetime in seconds as %1, so the bridge controls the budget.
rem
rem -WindowStyle Hidden for the same reason start_bridge.cmd needs it: a visible
rem console would sit on top of the IDE and end up inside any screenshot.
"%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& '%~dp0watch_dialogs.ps1' -Seconds %1"
