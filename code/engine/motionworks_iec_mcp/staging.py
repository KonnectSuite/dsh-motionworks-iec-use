"""The staging guard, in the layer that cannot be routed around.

WHY THIS EXISTS, AND WHY IT IS HERE.

index.js already refuses a project outside the plugin's staging root - assertStaged(), and
mw_ide_stage refuses a source outside the session's workspace. That covers everything that goes
through the plugin's TOOLS. It does not cover the engine.

Measured: the workspace at Desktop\\Arya WorkSpace holds 25-odd scripts the agent wrote for itself,
and they call the engine DIRECTLY:

    Tools/_mw_call.py     "Invoke the MotionWorks code engine directly, the same way ..."
    Tools/_mw_call2.py    "Invoke the MotionWorks code engine directly: python mw_code.py ..."
    Tools/_real_state.py  "Record the state of the owner's REAL MotionWorks project, ..."

So the agent routed around every guard simply by not using the tools, and the owner reported, three
times, that a project outside the workspace had been opened again. A guard that a caller can walk
past is not a guard; it is a suggestion.

The engine is the choke point. Nothing writes a POU, and nothing opens a project in the IDE, without
coming through here - whether the caller is a tool, a script the agent wrote, or a person at a
command line. So the rule lives here, once, and every entry point inherits it.

WHAT IT REFUSES. A project root that is not inside the staging root. The staging root is derived from
the engine's own location - <plugin>/stage - so it cannot be talked out of position by an environment
variable, a working directory, or an argument. MOTIONWORKS_MCP_STAGE overrides it for a deployment
that genuinely stages elsewhere, which is the same deliberate-override shape as the tool layer.

WHAT IT DOES NOT DO. It does not stop a caller who is not using this engine at all. An agent that
drives MotionWorks' COM interface with its own code is outside any plugin's reach, and no guard here
changes that. What this guarantees is narrower and still worth having: THIS engine never writes to or
opens anything but a staged copy.
"""
from __future__ import annotations

import os
from pathlib import Path

from .errors import MotionWorksError

#: Set to stage somewhere else on purpose. Unset, the root is derived from this file's location.
STAGE_ENV = "MOTIONWORKS_MCP_STAGE"


class StagingRefused(MotionWorksError):
    """A project path outside the staging root."""


def staging_root() -> Path:
    """The staging root: where copies live, and the only tree this engine will touch.

    Derived from the engine's own location so that no argument, environment variable or working
    directory can move it. <plugin>/code/engine/motionworks_iec_mcp/staging.py -> <plugin>/stage
    """
    override = os.environ.get(STAGE_ENV)
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[3] / "stage"


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def assert_staged(project_root: Path | str, what: str = "project") -> Path:
    """Return the resolved project root, or refuse if it is not a staged copy.

    Called by every write and every IDE open. The message names the path, the staging root and the
    way through - because the caller is usually an agent that has just been stopped mid-task and
    needs to know what to do instead, not merely that it may not.
    """
    given = Path(project_root).resolve()
    root = staging_root()

    if given == root or _inside(given, root):
        return given

    raise StagingRefused(
        f"REFUSED: {what} '{given}' is outside the staging root '{root}'. This engine only ever "
        f"reads or writes a STAGED COPY, never a real project tree - a real tree holds the owner's "
        f"work and MotionWorks rewrites whole files, so a mistake there is not recoverable from "
        f"here. Stage a copy first (mw_ide_stage in the plugin, or copy the project under {root} "
        f"yourself), then point at the copy. If the caller deliberately needs another root, set "
        f"{STAGE_ENV}."
    )


def is_staged(project_root: Path | str) -> bool:
    """Whether a path is inside the staging root, for a caller that wants to ask rather than try."""
    given = Path(project_root).resolve()
    root = staging_root()
    return given == root or _inside(given, root)
