"""Workspace-scoped project guards shared by the file engine.

The host supplies the current session workspace for each child process. Missing scope
fails closed. Staged copies live at <workspace>/.motionworks/stage and identities
must match that workspace, source, wrapper and project directory.
"""
from __future__ import annotations

import os
from pathlib import Path

from .errors import MotionWorksError

#: Optional consistency check; it cannot relocate the workspace stage.
STAGE_ENV = "MOTIONWORKS_MCP_STAGE"


class StagingRefused(MotionWorksError):
    """A project path outside the staging root."""


def workspace_root() -> Path:
    value = os.environ.get("MOTIONWORKS_MCP_WORKSPACE")
    if not value or not Path(value).is_absolute():
        raise StagingRefused("REFUSED: no absolute session workspace was supplied to the engine.")
    return Path(value).resolve()


def staging_root() -> Path:
    """A private stage within the calling workspace, never the shared plugin stage."""
    workspace = workspace_root()
    fixed = workspace / ".motionworks" / "stage"
    if not _inside(fixed, workspace):
        raise StagingRefused("REFUSED: workspace stage resolves outside the workspace.")
    override = os.environ.get(STAGE_ENV)
    if override and Path(override).resolve() != fixed.resolve():
        raise StagingRefused("REFUSED: stage override does not match the calling workspace stage.")
    return fixed.resolve()


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
        f"here. Stage a copy first with mw_ide_stage, then point at the copy. "
        f"{STAGE_ENV} cannot aim this root at a real project."
    )


def assert_proven(project_root: Path | str) -> Path:
    """Refuse a staged copy that mw_ide_stage did not record a source for.

    A directory under stage/ is not provenance. Scripts that call this engine directly
    used to edit whichever copy was there, including one with no recorded workspace source.
    """
    import json

    given = assert_staged(project_root)
    root = staging_root()
    path = given
    if path.suffix.lower() == ".mwt":
        path = path.with_suffix("")
    try:
        rel = path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise StagingRefused(
            f"REFUSED: '{given}' is not inside the staging root '{root}'."
        ) from exc
    if not rel.parts:
        raise StagingRefused(
            f"REFUSED: '{given}' is the staging root, not a project."
        )
    name = rel.parts[0]
    ident = root / f"{name}.identity.json"
    if not ident.is_file():
        raise StagingRefused(
            f"REFUSED: staged project '{name}' has no identity file. Stage it from the workspace "
            f"with mw_ide_stage. A folder copied into stage by hand is not edited."
        )
    try:
        data = json.loads(ident.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StagingRefused(f"REFUSED: could not read {ident.name}: {exc}") from exc
    if not data.get("source"):
        raise StagingRefused(
            f"REFUSED: staged project '{name}' has no recorded source. Stage it again from the "
            f"workspace project. A copy with no provenance is not edited."
        )
    workspace = workspace_root()
    if (not data.get("workspace")
            or Path(data["workspace"]).resolve() != workspace
            or not _inside(Path(data["source"]), workspace)
            or not _inside(Path(data.get("source_directory", data["source"])), workspace)
            or Path(data.get("staged_directory", "")).resolve() != (root / name).resolve()
            or Path(data.get("staged_mwt", "")).resolve() != (root / f"{name}.mwt").resolve()):
        raise StagingRefused("REFUSED: project identity does not belong to the calling workspace.")
    project = root / name
    if project.is_dir():
        for member in project.rglob("*"):
            if not _inside(member, project):
                raise StagingRefused(f"REFUSED: linked project member escapes the project: {member}")
    return given


def is_staged(project_root: Path | str) -> bool:
    """Whether a path is inside the staging root, for a caller that wants to ask rather than try."""
    given = Path(project_root).resolve()
    root = staging_root()
    return given == root or _inside(given, root)
