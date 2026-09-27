@echo off
rem Launches the MotionWorks Use COM bridge under 32-bit Windows PowerShell.
rem
rem WHY A .cmd WRAPPER
rem ------------------
rem Mwt.exe is a 32-bit LocalServer32, so a 64-bit client cannot create its COM
rem objects at all - the bitness here is load-bearing.
rem
rem The plugin spawns THIS file rather than invoking powershell.exe directly,
rem because Node's Windows argument quoting mangles the
rem     -Command "& '<path>'"
rem form: the child starts and exits 0 without ever running the script. Passing a
rem single launcher path to cmd.exe is unambiguous.
rem
rem %~dp0 already ends with a backslash, so '%~dp0mw_bridge.ps1' resolves to the
rem sibling script.
rem
rem -WindowStyle Hidden matters: without it, powershell.exe creates its OWN
rem visible console window. That console then sits on top of the IDE, and because
rem mw_ide_screenshot captures a screen region it appeared inside the capture.
"%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& '%~dp0mw_bridge.ps1'"
