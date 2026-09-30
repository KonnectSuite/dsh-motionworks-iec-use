"""Detect and close the MotionWorks IEC IDE.

Writing to a project while the IDE has it open is unsafe: the IDE holds project state
in memory and rewrites whole files on save, so an external edit is either discarded or
leaves an internally inconsistent project. Every Tier 2 write therefore gates on the
IDE being closed -- and, when asked, closes it rather than merely refusing.

**Discovery is by window ownership, chosen after two other approaches failed
measurement here:**

1. ``CreateToolhelp32Snapshot``, the obvious ctypes approach, enumerates only 50 of
   ~460 processes and **silently omits ``Mwt.exe``**. A safety gate built on it says
   "the IDE is closed" while the IDE is running, which is the worst failure it can
   have: a write would then proceed under an open IDE.
2. Enumerating from a **child process** does not help. This Python process runs in a
   restricted Job object whose view is truncated, and children inherit it -- a
   PowerShell script spawned from Python sees the same ~52 processes, while the same
   script run by hand sees all ~460.

In-process ``EnumWindows`` is not restricted, and the IDE is a GUI application, so it
always owns windows. Every candidate PID's image name is then **verified** with
``QueryFullProcessImageNameW`` before it is reported or closed, because acting on an
unverified PID would mean killing the wrong process.
"""

from __future__ import annotations

import sys
from pathlib import Path

#: Executable names that indicate the IDE. Only these block writing.
MAIN_PROCESSES = ("mwt", "mwt.exe", "mwiec", "motionworks")
#: Helper processes that can hold the same project files open. They are closed
#: alongside the IDE and reported, but a bare write gate does not fail on them.
HELPER_PROCESSES = (
    "mwcameditor",
    "yaskawa.plottool",
    "plc_simulator",
    # Yaskawa's licence verifier. It owns the "Use Trial" dialog, keeps the
    # single-instance lock alive while it waits for an answer, and can outlive
    # Mwt.exe -- which exits while the dialog is still up. Closing MotionWorks
    # must therefore close this too, or the next launch is blocked.
    "mwctverify",
)
#: Everything the module will detect or close.
ALL_PROCESSES = MAIN_PROCESSES + HELPER_PROCESSES


def _window_owner_pids() -> set:
    """PIDs that own a top-level window, found in-process via ``EnumWindows``."""
    if sys.platform != "win32":
        return set()
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    pids = set()
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    get_pid = user32.GetWindowThreadProcessId
    get_pid.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]

    def visit(hwnd, _lparam):
        pid = wintypes.DWORD()
        get_pid(hwnd, ctypes.byref(pid))
        if pid.value:
            pids.add(pid.value)
        return True

    try:
        if not user32.EnumWindows(callback_type(visit), 0):
            raise RuntimeError('Could not enumerate IDE windows; offline write refused')
    except Exception as exc:
        raise RuntimeError('Could not verify that the IDE is closed') from exc
    return pids


def _image_name(pid: int):
    """The executable name of ``pid``, or None if it cannot be queried."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(1024)
        buffer = ctypes.create_unicode_buffer(size.value)
        ok = kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size))
        if not ok:
            return None
        # Strip the .exe suffix: the process-name lists here are written without it,
        # and leaving it on silently breaks detection. Measured: "mwctVerify.exe"
        # failed to match "mwctverify" in HELPER_PROCESSES, so the licence verifier
        # went unreported even though it owned the window being looked for.
        name = buffer.value.rsplit(chr(92), 1)[-1]
        if name.casefold().endswith(".exe"):
            name = name[:-4]
        return name
    finally:
        kernel32.CloseHandle(handle)


def _terminate(pid: int) -> bool:
    """Terminate a process by PID; True if the call was accepted."""
    if sys.platform != "win32":
        return False
    import ctypes

    PROCESS_TERMINATE = 0x0001
    SYNCHRONIZE = 0x00100000
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, False, pid)
    if not handle:
        return False
    try:
        kernel32.TerminateProcess(handle, 1)
        # Wait, so a caller never proceeds while the process still holds files open.
        kernel32.WaitForSingleObject(handle, 10_000)
        return True
    finally:
        kernel32.CloseHandle(handle)


#: The PowerShell fallback helper, written to a file and invoked with ``-File``:
#: ``-Command`` with inline script text is mangled by this shell's quoting and
#: silently returns nothing. Only useful to callers *outside* the restricted job.
_HELPER = r"""
param([string]$Out = '')

$names = @('Mwt', 'Mwcameditor', 'Yaskawa.PlotTool', 'plc_simulator')
$found = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $names -contains $_.ProcessName })
$lines = New-Object System.Collections.Generic.List[string]
foreach ($p in $found) { $lines.Add(("running`t{0}`t{1}" -f $p.Id, $p.ProcessName)) }
$lines.Add("done`t0`t$($found.Count)")
if ($Out) { Set-Content -LiteralPath $Out -Value $lines -Encoding ascii } else { $lines }
"""


def _run_helper(timeout_s: float = 20.0):
    """Run the PowerShell helper; returns ``(kind, pid, name)`` rows."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "ide_helper.ps1"
        listing = Path(tmp) / "ide_helper.out"
        script.write_text(_HELPER, encoding="ascii")
        try:
            subprocess.run(
                [
                    "powershell.exe",
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(script),
                    "-Out",
                    str(listing),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout_s + 120,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        except Exception:  # noqa: BLE001
            return []
        try:
            text = listing.read_text(encoding="ascii", errors="replace")
        except OSError:
            return []

    rows = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            rows.append((parts[0], parts[1], parts[2]))
    return rows


def motionworks_running(include_helpers: bool = True):
    """Return ``(pid, exe_name)`` for running MotionWorks-related processes.

    An empty list means it is safe to write. Only :data:`MAIN_PROCESSES` block
    writing; the helpers are informational.
    """
    if sys.platform != "win32":
        return []
    wanted = MAIN_PROCESSES + HELPER_PROCESSES if include_helpers else MAIN_PROCESSES
    found = []
    for pid in sorted(_window_owner_pids()):
        # Verify before reporting: the caller may close these PIDs.
        name = _image_name(pid)
        if name and name.casefold() in wanted:
            found.append((pid, name))
    return found


def ide_blocks_writes():
    """Return whether the IDE blocks writing, plus the offending processes."""
    procs = motionworks_running(include_helpers=False)
    return bool(procs), procs


def close_motionworks(timeout: float = 15.0):
    """Close every running MotionWorks instance and verify it is gone.

    The IDE is asked to quit through COM first, when pywin32 is installed and the
    automation server is already running, so it can flush its own state. Anything
    still alive is then terminated by PID. The list is **re-read** afterwards, so
    ``remaining`` is what is actually still running rather than an assumption -- a
    caller must not write while it is non-empty.
    """
    import time

    if sys.platform != "win32":
        return {"before": [], "closed": [], "remaining": [], "ok": True}

    before = motionworks_running(include_helpers=True)

    # Ask nicely, if the automation server is reachable. 32-bit pywin32 is an
    # optional extra, so this is skipped rather than failing when absent.
    if any(name.casefold() in MAIN_PROCESSES for _, name in before):
        try:
            import win32com.client  # type: ignore[import-not-found]

            app = win32com.client.GetActiveObject("Ade.Application.550")
            app.Quit(0)
            time.sleep(1.5)
        except Exception:  # noqa: BLE001 - not installed, or nothing to quit
            pass

    closed = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        still = motionworks_running(include_helpers=True)
        if not still:
            break
        for pid, name in still:
            if _terminate(pid):
                closed.append((pid, name))
        time.sleep(0.4)

    remaining = motionworks_running(include_helpers=True)
    return {
        "before": before,
        "closed": closed,
        "remaining": remaining,
        "ok": not remaining,
    }


def auto_close_enabled() -> bool:
    """Whether write tools should close the IDE themselves.

    Controlled by ``MOTIONWORKS_MCP_CLOSE_IDE``: ``1``/``true``/``yes``/``on`` means
    a write closes a running IDE and proceeds rather than refusing. Off by default,
    because silently closing an application the user may be working in is not a
    decision to make on their behalf.
    """
    import os

    value = os.environ.get("MOTIONWORKS_MCP_CLOSE_IDE", "")
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def ensure_ide_closed(auto_close: bool | None = None, timeout: float = 15.0):
    """Raise :class:`IdeRunning` unless the IDE is closed, closing it if configured.

    Every write path calls this instead of inspecting processes itself, so the
    close-or-refuse policy lives in exactly one place.

    Args:
        auto_close: Override the environment setting; ``None`` uses
            :func:`auto_close_enabled`.
        timeout: How long to wait for the IDE to exit when closing it.
    """
    from .errors import IdeRunning

    if sys.platform != "win32":
        return
    # Project identity can only be verified by the bridge close tool.
    auto_close = False
    procs = require_ide_closed(auto_close=auto_close, timeout=timeout)
    if procs:
        described = ", ".join(f"{name} (pid {pid})" for pid, name in procs)
        raise IdeRunning(
            f"MotionWorks is running ({described}), so nothing was written. Close "
            f"MotionWorks IEC through the guarded mw_ide_close tool and retry."
        )


def require_ide_closed(auto_close: bool = False, timeout: float = 15.0):
    """Ensure the IDE is closed, closing it first when asked.

    Returns the processes *still* running (empty means safe to write). With
    ``auto_close`` the IDE is shut down when found; without it this only reports, so
    a caller can refuse and tell the user to close it.
    """
    blocking, procs = ide_blocks_writes()
    if not blocking:
        return []
    if not auto_close:
        return procs
    close_motionworks(timeout=timeout)
    _, procs = ide_blocks_writes()
    return procs
