"""Drive MotionWorks IEC directly through COM with pywin32.

This is the Tier 3 automation path in Python, as the project requires: the
``Ade.Application.550`` automation server, its type library, and a **32-bit**
interpreter. It is deliberately one of two implementations of the same job --
``mw_build.ps1`` under 32-bit PowerShell is the other -- so the two can be compared
when something goes wrong, rather than there being a single opaque path.

Why 32-bit is mandatory
-----------------------
``mwt.exe`` is a 32-bit local COM server, so a 64-bit process cannot instantiate it.
Run this from the ``.venv32`` interpreter. ``available()`` reports the reason rather
than failing obscurely, because "pywin32 is missing" and "the IDE is not running" are
very different problems.

Why the IDE must already be running
-----------------------------------
``Ade.Application.550`` is registered as a *LocalServer32*, so instantiating it
**launches** ``mwt.exe`` if it is not already up. A freshly launched IDE has no
project services ready, and calling into it returns ``Internal error`` for every
project call. So this client never launches the IDE; it refuses and says so.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

#: Repository root, two levels up from this module.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

#: The automation ProgID, and its CLSID for error messages.
PROG_ID = "Ade.Application.550"
CLSID = "{05500000-0108-2706-100F-0080C7AC3298}"

#: ``AdeCompileType`` values. 1 is an asynchronous Build; 2 is Rebuild. 0 and 3-6 are
#: not valid -- confirmed by probing the server, which rejects them.
COMPILE_BUILD = 1
COMPILE_REBUILD = 2


def interpreter_32() -> Path | None:
    """The 32-bit interpreter this server delegates COM work to."""
    candidate = PROJECT_ROOT / ".venv32" / "Scripts" / "python.exe"
    return candidate if candidate.is_file() else None


def query_via_32bit(compile_kind: int = 0, timeout: float = 120.0) -> dict[str, object]:
    """Ask the 32-bit interpreter to query the automation server, and return its JSON.

    This MCP server runs under a 64-bit interpreter, which cannot instantiate the
    32-bit COM server. Only ``mw_com_status`` needs COM -- everything else works on
    either -- so rather than requiring the whole server to run 32-bit (which would
    also need the ``mcp`` package installed there), the COM work is delegated.

    The child writes JSON to a file rather than stdout, because capturing a child's
    output through a pipe is unreliable in this environment.
    """
    import json
    import subprocess
    import tempfile

    interpreter = interpreter_32()
    if interpreter is None:
        return {
            "ok": False,
            "error": (
                "no 32-bit interpreter found at .venv32\\Scripts\\python.exe. COM "
                "automation needs one, because mwt.exe is a 32-bit local server."
            ),
        }

    helper = PROJECT_ROOT / "tools" / "com_query.py"
    if not helper.is_file():
        return {"ok": False, "error": f"helper not found: {helper}"}

    with tempfile.TemporaryDirectory() as tmp:
        result = Path(tmp) / "com.json"
        command = [str(interpreter), "-X", "utf8", str(helper), "--out", str(result)]
        if compile_kind:
            command += ["--compile", str(compile_kind)]
        try:
            subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                creationflags=0x08000000,
            )
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"could not run the 32-bit helper: {exc}"}
        try:
            return json.loads(result.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return {"ok": False, "error": f"the helper produced no usable result: {exc}"}


class ComUnavailable(RuntimeError):
    """The automation server could not be reached, with the reason why."""


def is_32bit() -> bool:
    """Whether this interpreter is 32-bit, which the COM server requires."""
    return sys.maxsize <= 2**32


def available() -> tuple[bool, str]:
    """Whether this interpreter can use the automation server at all."""
    if sys.platform != "win32":
        return False, "not Windows"
    if not is_32bit():
        return (
            False,
            f"this is a {struct_calcsize() * 8}-bit interpreter, but mwt.exe is a "
            f"32-bit local COM server; use the 32-bit interpreter (python.exe under "
            f".venv32)",
        )
    try:
        import win32com.client  # noqa: F401
    except ImportError as exc:
        return False, (
            f"pywin32 is not installed in this interpreter ({exc}); install it with: "
            f"python -m pip install pywin32"
        )
    return True, "ok"


def struct_calcsize() -> int:
    """``8`` for 64-bit, ``4`` for 32-bit, for messages."""
    import struct

    return struct.calcsize("P")


def connect(visible: bool = True):
    """Attach to a **running** MotionWorks IEC automation server.

    Raises :class:`ComUnavailable` rather than launching the IDE, because a
    launched-but-uninitialised IDE answers every project call with ``Internal
    error`` and that is indistinguishable from a real failure.
    """
    ok, reason = available()
    if not ok:
        raise ComUnavailable(reason)

    import win32com.client

    from . import ide

    running = [
        (pid, name)
        for pid, name in ide.motionworks_running(include_helpers=False)
    ]
    if not running:
        raise ComUnavailable(
            "MotionWorks IEC is not running. Instantiating "
            f"{PROG_ID} would launch it, and a freshly launched IDE has no project "
            "services, so every call would fail with 'Internal error'. Start "
            "MotionWorks IEC, open the project, then retry."
        )

    try:
        app = win32com.client.GetActiveObject(PROG_ID)
    except Exception as exc:  # noqa: BLE001 - COM raises a variety of types
        # Deliberately **no Dispatch fallback here.** Dispatch on a LocalServer32
        # would launch another mwt.exe, and we have just confirmed one is already
        # running; spawning a second IDE to talk to the first is never right.
        raise ComUnavailable(
            f"MotionWorks IEC is running (pid "
            f"{', '.join(str(p) for p, _ in running)}) but its automation server "
            f"could not be attached to: {exc}. This usually means the IDE is up as a "
            f"COM/DDE server without having initialised its project services -- see "
            f"docs/tier3-com-build.md."
        ) from exc

    if visible:
        try:
            app.Visible = True
        except Exception:  # noqa: BLE001 - not fatal
            pass
    return app


def project_state(app) -> dict[str, object]:
    """Read ``IsProjectOpen`` / ``IsCompiled`` / ``IsModified`` without raising.

    Each is reported as a value or as an error string. A failed call here is the
    signal that the IDE is up but its project services are not -- which must not be
    confused with "the project does not compile".
    """
    state: dict[str, object] = {}
    for label, getter in (
        ("project_open", lambda: app.IsProjectOpen()),
        ("compiled", lambda: app.ActiveProject.IsCompiled),
        ("modified", lambda: app.ActiveProject.IsModified),
        ("name", lambda: app.ActiveProject.Name),
    ):
        try:
            state[label] = getter()
        except Exception as exc:  # noqa: BLE001
            state[label] = f"error: {exc}"
    return state


def services_ready(app) -> tuple[bool, str]:
    """Whether the IDE's project services are usable.

    Distinguishes the important case: a ``False`` here means no compile was
    attempted, so "compiled is False" would be misleading if reported as a build
    failure.
    """
    state = project_state(app)
    opened = state.get("project_open")
    if isinstance(opened, str):
        return False, (
            "the IDE is running but its project services are not answering "
            f"({opened}). No compile was attempted, so this is NOT a build failure."
        )
    if opened is not True:
        return False, "no project is open in MotionWorks IEC"
    return True, "ok"


def compile_project(
    app, kind: int = COMPILE_REBUILD, settle: float = 3.0
) -> dict[str, object]:
    """Ask the IDE to Build or Rebuild the active project.

    ``Ade.Compile`` rejects a second call while the compiler is running
    (``"...compiler is running"``), so a rebuild is retried until it is accepted.
    The result reports whether the call was accepted, which is not the same as
    whether the project compiled -- read ``ActiveProject.IsCompiled`` afterwards.
    """
    result: dict[str, object] = {"requested": kind, "accepted": False, "note": ""}
    try:
        app.ActiveProject.Compile(kind)
        result["accepted"] = True
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "compiler is running" in message.casefold():
            result["note"] = "the compiler was busy; retry once it finishes"
        else:
            result["note"] = message

    time.sleep(settle)
    result["state"] = project_state(app)
    return result


def summary(app) -> str:
    """A one-block human-readable report, for tool output."""
    ok, reason = available()
    lines = [f"pywin32 COM client: {'usable' if ok else 'unusable'} ({reason})"]
    if not ok:
        return "\n".join(lines)

    try:
        state = project_state(app)
    except ComUnavailable as exc:
        lines.append(f"not connected: {exc}")
        return "\n".join(lines)

    for key in ("name", "project_open", "compiled", "modified"):
        lines.append(f"  {key:13}: {state.get(key)}")
    ready, why = services_ready(app)
    lines.append(f"  services     : {'ready' if ready else why}")
    return "\n".join(lines)
