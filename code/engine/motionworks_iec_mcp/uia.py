"""Look at and interact with Windows GUI elements, via UI Automation.

This gives the agent hands to go with the eyes in :mod:`motionworks_iec_mcp.capture`.
It exists because automating MotionWorks needs it: the IDE shows a **"Use Trial"**
dialog on startup, and until that is dismissed the IDE never loads a project, so every
COM call fails. Clicking that button is not something COM can do.

Two rules shaped the design, and both come from testing rather than theory:

* **Prefer the accessibility pattern over synthetic input.** Tapping a control through
  ``InvokePattern`` is addressed by name, so it cannot miss the target the way a
  coordinate does, and it does not depend on which window happens to be on top.
  Raw mouse/keyboard input is the fallback, not the first choice.
* **Verify the target before acting.** Every lookup returns the element's control type
  and rectangle, so a caller can confirm it found a *button* before clicking it.

These functions act on the live desktop, so they are deliberately explicit about what
they matched. Nothing here clicks by blind coordinate unless asked to.
"""

from __future__ import annotations

import sys
import time


class UiaError(RuntimeError):
    """A UI element could not be found or acted on."""


def _automation():
    """The UI Automation namespaces, imported lazily.

    ``uiautomation`` is not required: everything here goes through ``comtypes``-free
    .NET interop exposed by PowerShell, so the only requirement is Windows itself.
    """
    return None


#: PowerShell helper. UI Automation is reached through .NET, which is already present;
#: this avoids a third-party dependency for a core capability. The script writes JSON
#: to a file because capturing a child's stdout through a pipe truncates here.
_HELPER = r"""
param(
    [string]$Action = 'list',
    [string]$Out = '',
    [string]$Match = '',
    [string]$ControlType = '',
    [int]$Handle = 0,
    [string]$Text = ''
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-Root {
    param([int]$H)
    $auto = [System.Windows.Automation.AutomationElement]
    if ($H -ne 0) {
        return $auto::FromHandle([IntPtr]$H)
    }
    return $auto::RootElement
}

function Describe-Element {
    param($e)
    $r = $e.Current.BoundingRectangle
    [pscustomobject]@{
        name        = $e.Current.Name
        type        = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        automationId= $e.Current.AutomationId
        enabled     = $e.Current.IsEnabled
        offscreen   = $e.Current.IsOffscreen
        left        = [int]$r.Left
        top         = [int]$r.Top
        width       = [int]$r.Width
        height      = [int]$r.Height
    }
}

$results = New-Object System.Collections.Generic.List[object]
$note = ''

try {
    $root = Get-Root -H $Handle

    if ($Action -eq 'click' -or $Action -eq 'invoke') {
        # Find by exact name first, then fall back to a substring match.
        $target = $null
        foreach ($scope in @([System.Windows.Automation.TreeScope]::Descendants)) { }
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                             [System.Windows.Automation.Condition]::TrueCondition)
        $candidates = @()
        foreach ($e in $all) {
            $n = $e.Current.Name
            if (-not $n) { continue }
            if ($n -eq $Match) { $candidates = @($e); break }
            if ($Match -and $n.ToLower().Contains($Match.ToLower())) { $candidates += $e }
        }
        if (-not $candidates -or $candidates.Count -eq 0) {
            throw "no element named or containing '$Match'"
        }
        $target = $candidates[0]
        $ok = $false
        try {
            $p = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $p.Invoke()
            $ok = $true
            $note = 'invoked via InvokePattern'
        } catch { }
        if (-not $ok) {
            $note = 'no InvokePattern; reported rectangle for a coordinate click'
        }
        $results.Add((Describe-Element $target))
        if (-not $ok) { $note += '' }
    }
    else {
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                             [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($e in $all) {
            $n = $e.Current.Name
            if (-not $n) { continue }
            $t = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
            if ($ControlType -and $t -ne $ControlType) { continue }
            $results.Add((Describe-Element $e))
        }
    }
    $note = if ($note) { $note } else { "found $($results.Count) element(s)" }
} catch {
    $note = "error: $($_.Exception.Message)"
}

$payload = [pscustomobject]@{ note = $note; elements = $results }
$json = $payload | ConvertTo-Json -Depth 6 -Compress
if ($Out) { Set-Content -LiteralPath $Out -Value $json -Encoding UTF8 } else { $json }
"""


def _run_helper(
    action: str,
    match: str = "",
    control_type: str = "",
    handle: int = 0,
    timeout_s: float = 60.0,
) -> dict[str, object]:
    """Run the UI Automation helper and return its parsed result."""
    import json
    import subprocess
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "uia.ps1"
        listing = Path(tmp) / "uia.json"
        script.write_text(_HELPER, encoding="ascii")
        command = [
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-Action",
            action,
            "-Out",
            str(listing),
            "-Match",
            match,
            "-ControlType",
            control_type,
            "-Handle",
            str(handle),
        ]
        try:
            subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout_s + 60,
                creationflags=0x08000000,
            )
        except Exception as exc:  # noqa: BLE001
            raise UiaError(f"could not run the UI Automation helper: {exc}") from exc
        try:
            return json.loads(listing.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            raise UiaError(f"the helper produced no usable result: {exc}") from exc


def elements(
    title_contains: str | None = None,
    handle: int | None = None,
    control_type: str = "",
) -> list[dict[str, object]]:
    """Every named UI element inside a window (or the whole desktop).

    ``control_type`` filters to one kind, e.g. ``"Button"`` -- which is how you find
    something clickable without reading through every label.
    """
    hwnd = handle or 0
    if title_contains and not hwnd:
        from . import capture

        window = capture.find_window(title_contains=title_contains)
        if window is None:
            raise UiaError(f"no visible window matching {title_contains!r}")
        hwnd = int(window["handle"])
    result = _run_helper("list", control_type=control_type, handle=hwnd)
    return list(result.get("elements") or [])


def find_button(name_contains: str, title_contains: str | None = None):
    """The first control whose name contains ``name_contains``.

    Despite the name this does **not** filter to ``ControlType.Button``, and that is
    the whole point. Measured on the MotionWorks trial dialog, every clickable control
    reports itself as a **``Pane``**, not a Button -- which is exactly why the original
    trial-dismissal code, which searched for a Button named "Use Trial", never found
    anything and the IDE sat waiting forever. Matching by name alone finds it.
    """
    for element in elements(title_contains=title_contains):
        if name_contains.casefold() in str(element.get("name", "")).casefold():
            return element
    return None


def click_element(
    name: str, title_contains: str | None = None, handle: int | None = None
) -> dict[str, object]:
    """Click a control by name, preferring the accessibility ``InvokePattern``.

    Addresses the control by name rather than by coordinate where possible. When a
    control exposes no invoke pattern -- as the MotionWorks dialog's ``Pane`` elements
    do not -- it falls back to a **synthetic click at the element's own centre**, and
    the result says which route was taken so the caller can tell them apart.
    """
    hwnd = handle or 0
    if title_contains and not hwnd:
        from . import capture

        window = capture.find_window(title_contains=title_contains)
        if window is None:
            raise UiaError(f"no visible window matching {title_contains!r}")
        hwnd = int(window["handle"])
    result = _run_helper("click", match=name, handle=hwnd)
    matched = list(result.get("elements") or [])
    if not matched:
        raise UiaError(str(result.get("note", "nothing matched")))
    element = matched[0]
    note = str(result.get("note", ""))
    if "InvokePattern" in note:
        element["invoked"] = True
        element["note"] = note
        return element

    # No invoke pattern: click the centre of the rectangle UIA reported.
    left, top = int(element["left"]), int(element["top"])
    width, height = int(element["width"]), int(element["height"])
    if width <= 0 or height <= 0:
        raise UiaError(
            f"found {element.get('name')!r} but it has no size, so it cannot be "
            f"clicked"
        )
    x, y = left + width // 2, top + height // 2
    detail = click_point(x, y)
    element["invoked"] = True
    element["note"] = (
        f"no InvokePattern, so clicked at the element centre ({x},{y}) via SendInput"
    )
    element["clicked_at"] = detail.get("clicked_at", (x, y))
    return element


def _ensure_dpi_aware() -> None:
    """Make this process per-monitor DPI aware, once.

    Without this, a click at a coordinate that UI Automation reported fails outright:
    on this machine the trial dialog sits on a monitor with **negative x**, and an
    unaware process asking for ``(-3227, 542)`` gets
    ``SetCursorPos: (18, 'There are no more files.')``. The coordinates UIA returns
    are physical pixels, so the process must be aware to use them.
    """
    global _DPI_SET

    if _DPI_SET:
        return
    _DPI_SET = True
    try:
        import ctypes

        # -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (Windows 10 1703+)
        if not ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            # -2 = PER_MONITOR_AWARE, for older builds
            ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-2))
    except Exception:  # noqa: BLE001 - best effort; the fallback below still tries
        try:
            import ctypes

            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:  # noqa: BLE001
            pass


_DPI_SET = False


def click_point(x: int, y: int) -> dict[str, object]:
    """Synthesise a left click at an absolute desktop coordinate.

    Coordinates are physical pixels across the whole virtual desktop, matching the
    rectangles reported by :func:`elements` and
    :func:`motionworks_iec_mcp.capture.list_windows`.

    Uses ``SendInput`` with ``MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`` rather
    than ``SetCursorPos`` plus ``mouse_event``: the latter rejects coordinates on a
    monitor left of the primary one, which is where the IDE's dialog sits here.
    """
    if sys.platform != "win32":
        raise UiaError("synthetic input is only implemented on Windows")
    import ctypes
    from ctypes import wintypes

    _ensure_dpi_aware()

    user32 = ctypes.windll.user32
    virtual_left = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
    virtual_top = user32.GetSystemMetrics(77)
    virtual_width = user32.GetSystemMetrics(78)
    virtual_height = user32.GetSystemMetrics(79)
    if virtual_width <= 0 or virtual_height <= 0:
        raise UiaError("could not read the virtual desktop size")

    # SendInput takes coordinates normalised to 0..65535 across the virtual desktop.
    normalised_x = int((int(x) - virtual_left) * 65535 / max(1, virtual_width - 1))
    normalised_y = int((int(y) - virtual_top) * 65535 / max(1, virtual_height - 1))

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT(ctypes.Structure):
        class _UNION(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT)]

        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _UNION)]

    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_ABSOLUTE = 0x8000
    MOUSEEVENTF_VIRTUALDESK = 0x4000
    flags = (
        MOUSEEVENTF_MOVE
        | MOUSEEVENTF_ABSOLUTE
        | MOUSEEVENTF_VIRTUALDESK
        | MOUSEEVENTF_LEFTDOWN
        | MOUSEEVENTF_LEFTUP
    )

    events = (INPUT * 1)()
    events[0].type = 0  # INPUT_MOUSE
    events[0].mi = MOUSEINPUT(
        normalised_x, normalised_y, 0, flags, 0, None
    )
    sent = user32.SendInput(1, ctypes.byref(events), ctypes.sizeof(INPUT))
    if sent != 1:
        raise UiaError(
            f"SendInput sent {sent} of 1 event; clicking at ({x},{y}) failed"
        )
    return {"clicked_at": (int(x), int(y)), "sent": int(sent)}


def type_text(text: str, interval: float = 0.01) -> None:
    """Type text into whatever window has focus."""
    if sys.platform != "win32":
        raise UiaError("synthetic input is only implemented on Windows")
    import win32api
    import win32con

    for character in text:
        code = win32api.VkKeyScan(character)
        if code == -1:
            continue
        virtual_key = code & 0xFF
        shift = bool(code >> 8 & 1)
        keys = [virtual_key]
        if shift:
            win32api.keybd_event(win32con.VK_SHIFT, 0, 0, 0)
        win32api.keybd_event(virtual_key, 0, 0, 0)
        win32api.keybd_event(virtual_key, 0, win32con.KEYEVENTF_KEYUP, 0)
        if shift:
            win32api.keybd_event(win32con.VK_SHIFT, 0, win32con.KEYEVENTF_KEYUP, 0)
        time.sleep(interval)


def dismiss_trial(title_contains: str = "Motionworks", timeout: float = 45.0):
    """Click **Use Trial** if the trial dialog is showing, and say what happened.

    This is the single thing that stood between the IDE and every COM call working.
    While this dialog is up, MotionWorks never loads a project, so ``OpenProject`` and
    ``IsProjectOpen`` both return ``Internal error`` -- which looks like a broken
    install but is only an unanswered prompt.

    Returns ``(dismissed, detail)``. Polls, because the dialog can appear a few seconds
    after the process starts, and a single attempt at a fixed moment misses it.
    """
    deadline = time.monotonic() + timeout
    seen = False
    last = ""
    while time.monotonic() < deadline:
        from . import capture

        # Exclude browsers. A Chrome tab can be titled with the application name and
        # is far larger than the dialog, so the "largest match" rule would pick it and
        # the dialog would never be found -- which is exactly what happened.
        window = capture.find_window(
            title_contains=title_contains,
            exclude=("chrome", "edge", "firefox", "brave", "opera"),
        )
        windows = [window] if window else []
        if windows:
            handle = int(windows[0]["handle"])
            try:
                for element in elements(handle=handle):
                    name = str(element.get("name", ""))
                    if "use trial" in name.casefold():
                        seen = True
                        clicked = click_element(handle=handle, name="Use Trial")
                        return True, (
                            f"clicked {clicked.get('name')!r}: {clicked.get('note')}"
                        )
            except UiaError as exc:
                last = str(exc)
        time.sleep(1.5)
    if seen:
        return False, f"the trial dialog was found but could not be clicked: {last}"
    return False, (
        f"no window matching {title_contains!r} appeared within {timeout:.0f}s"
    )


def describe(elements_list: list[dict[str, object]], limit: int = 40) -> str:
    """A readable listing of UI elements, for a tool reply."""
    if not elements_list:
        return "No named UI elements found."
    lines = [f"{min(len(elements_list), limit)} of {len(elements_list)} element(s):"]
    for element in elements_list[:limit]:
        name = str(element.get("name", ""))[:60]
        kind = element.get("type", "?")
        left, top = element.get("left"), element.get("top")
        width, height = element.get("width"), element.get("height")
        lines.append(
            f"  [{kind:<12}] {name!r:<64} at ({left},{top}) {width}x{height}"
            + ("" if element.get("enabled", True) else "  DISABLED")
        )
    return "\n".join(lines)
