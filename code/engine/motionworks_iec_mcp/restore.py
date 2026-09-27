"""Put a POU back from a snapshot.

WHY THIS EXISTS. mw_ide_build now detects the moment a POU is destroyed - a container whose size is
not plausible, which is what a blown resource grid looks like - and names the POU. It then says to
restore it, and there was no way to do that. A diagnosis with no remedy is only half a fix.

WHAT MAKES IT POSSIBLE. The writer already backs up every file it is about to change, into
snapshots keyed by timestamp, and those snapshots mirror the project tree: a POU write leaves
``<snapshot>/POE/<POU>/src.st1``. Measured on this install: 370 such snapshots. A POU's .VB text and
its .VGR grid are streams inside that ONE container, so restoring the container restores both - one
file copy, no format knowledge, nothing to get wrong.

WHAT IT DOES NOT DO. It does not pick the snapshot for you beyond taking the newest that holds the
POU, and it does not decide whether restoring is right. A restore can throw away work done since the
snapshot, so the tool is dry-run by default and reports which snapshot it would use and how it
compares to what is on disk.

The current file is backed up before being replaced, so a restore is itself undoable.
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .errors import MotionWorksError, NotFound
from .snapshot import default_backup_dir

#: A POU container normally runs 1.5 KB to 60 KB on this project (21 measured, median 13 KB), so
#: these bound what a container has to look like before it is trusted. A container outside the range
#: is damaged, and a DAMAGED CONTAINER MUST NOT BE RESTORED OVER A GOOD FILE or used as a snapshot.
#:
#: The upper bound is deliberately the same 1 MB that mw_ide_build uses to decide a POU has been
#: destroyed. Two parts of one plugin disagreeing about what "damaged" means is its own bug: the
#: diagnosis would name a POU that restore then refused to treat as damaged, and the contradiction
#: would surface as a confusing refusal rather than a clear one.
PLAUSIBLE_MIN = 256
PLAUSIBLE_MAX = 1_000_000


@dataclass
class Snapshot:
    """One backup directory, and whether it holds the POU being looked for."""

    path: Path
    taken: str
    pou_file: Path | None = None

    @property
    def when(self) -> str:
        """The timestamp rendered for a person, falling back to the directory name."""
        try:
            return datetime.strptime(self.taken, "%Y%m%d-%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            return self.taken


def snapshots_for(project_root: Path) -> list[Snapshot]:
    """Every snapshot for a project, newest first."""
    root = default_backup_dir(project_root)
    if not root.is_dir():
        return []
    found = [Snapshot(path=p, taken=p.name) for p in root.iterdir() if p.is_dir()]
    return sorted(found, key=lambda s: s.taken, reverse=True)


def pou_file_in(snapshot: Path, pou: str) -> Path | None:
    """The POU's container inside a snapshot, if that snapshot holds it."""
    for candidate in snapshot.rglob(f"POE/{pou}/src.st1"):
        if candidate.is_file():
            return candidate
    return None


def find_snapshots(project_root: Path, pou: str) -> list[Snapshot]:
    """Snapshots that hold this POU, newest first, each with the file it holds."""
    out = []
    for snap in snapshots_for(project_root):
        found = pou_file_in(snap.path, pou)
        if found is not None:
            out.append(Snapshot(path=snap.path, taken=snap.taken, pou_file=found))
    return out


def current_pou_file(project_root: Path, pou: str) -> Path | None:
    """The live container for a POU."""
    for candidate in project_root.rglob(f"POE/{pou}/src.st1"):
        if candidate.is_file():
            return candidate
    return None


def describe(path: Path | None) -> dict:
    """Size and plausibility of a container, for comparing a snapshot against what is live."""
    if path is None or not path.is_file():
        return {"path": None, "bytes": 0, "plausible": False}
    size = path.stat().st_size
    return {
        "path": str(path),
        "bytes": size,
        "plausible": PLAUSIBLE_MIN <= size <= PLAUSIBLE_MAX,
    }


def restore_pou(project_root: Path, pou: str, which: int = 0, dry_run: bool = True) -> dict:
    """Replace a POU's container with a copy from a snapshot.

    ``which`` selects among the snapshots holding this POU, 0 being the newest. Returns a report
    rather than raising for the ordinary refusals, because the caller is usually an agent that has
    just been told its POU is damaged and needs to know what happened.
    """
    if current_pou_file(project_root, pou) is None:
        raise NotFound(
            f"no POU named '{pou}' in {project_root}; snapshots cannot restore what is not there. "
            f"Use mw_code_pous to list what exists."
        )

    candidates = find_snapshots(project_root, pou)
    if not candidates:
        raise NotFound(
            f"no snapshot holds a POU named '{pou}'. Backups live in "
            f"{default_backup_dir(project_root)}; if the project has never been written to through "
            f"this plugin there will be none."
        )
    if which >= len(candidates):
        raise MotionWorksError(
            f"only {len(candidates)} snapshot(s) hold '{pou}' and which={which} was asked for"
        )

    chosen = candidates[which]
    target = current_pou_file(project_root, pou)
    before = describe(target)
    source = describe(chosen.pou_file)

    report = {
        "pou": pou,
        "dry_run": dry_run,
        "snapshot": str(chosen.path),
        "snapshot_taken": chosen.when,
        "snapshots_available": len(candidates),
        "before": before,
        "after": source,
    }

    if not source["plausible"]:
        report["restored"] = False
        report["refused"] = (
            f"the snapshot's copy of {pou} is {source['bytes']} bytes, outside the "
            f"{PLAUSIBLE_MIN} B to {PLAUSIBLE_MAX} B range a real container falls in. Restoring it "
            f"would replace one damaged file with another; try which=1 for an older snapshot."
        )
        return report

    if dry_run:
        report["restored"] = False
        report["would_restore"] = True
        return report

    # Keep the current file, so a restore can itself be undone.
    keep = target.with_suffix(".before-restore")
    try:
        shutil.copy2(target, keep)
        report["saved_current_to"] = str(keep)
    except OSError as e:
        report["saved_current_to"] = None
        report["note"] = f"could not save the current file first: {e}"

    shutil.copy2(chosen.pou_file, target)
    after = describe(target)
    report["restored"] = after["bytes"] == source["bytes"]
    report["after"] = after
    report["bytes_restored"] = after["bytes"]

    if not report["restored"]:
        report["refused"] = (
            f"the copy did not take: the file is {after['bytes']} bytes and the snapshot held "
            f"{source['bytes']}"
        )
    return report


def list_restorable(project_root: Path) -> dict:
    """Which POUs have snapshots, and which look damaged right now - the two together."""
    snapshots = snapshots_for(project_root)
    pous: dict[str, int] = {}
    for snap in snapshots:
        for found in snap.path.rglob("POE/*/src.st1"):
            pous[found.parent.name] = pous.get(found.parent.name, 0) + 1

    damaged = []
    for live in project_root.rglob("POE/*/src.st1"):
        size = live.stat().st_size
        if size < PLAUSIBLE_MIN or size > PLAUSIBLE_MAX:
            damaged.append({"pou": live.parent.name, "bytes": size,
                            "snapshots": pous.get(live.parent.name, 0)})

    return {
        "snapshots": len(snapshots),
        "restorable_pous": len(pous),
        "most_recent": snapshots[0].when if snapshots else None,
        "damaged": damaged,
    }
