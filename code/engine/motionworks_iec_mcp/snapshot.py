"""SHA-256 tree snapshots, used as the safety spine around every write.

A snapshot is a JSON manifest of relative path -> SHA-256 for every file in a
project.  Taking one before a change and verifying after gives a precise answer
to "what exactly did this touch?", which matters because MotionWorks will
rewrite unrelated state on the next save.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path

from .errors import VerificationFailed

MANIFEST_FORMAT = "motionworks-sha256-v1"

#: Directory names never included in a snapshot; they are build output.
_SKIP_DIRS = {"__pycache__", ".git"}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def hash_tree(
    base: Path,
    exclude: Path | None = None,
    include_generated: bool = True,
) -> dict[str, str]:
    """Hash every file under ``base``, keyed by POSIX-style relative path.

    ``tmp.sto`` build caches are included by default because a change there is
    still a change worth seeing, but ``include_generated=False`` filters them
    out when only source differences matter.
    """
    base = base.resolve()
    exclude_resolved = exclude.resolve() if exclude else None
    files: dict[str, str] = {}
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if exclude_resolved is not None and path.resolve() == exclude_resolved:
            continue
        if not include_generated and path.suffix.lower() in {".sto", ".sn"}:
            continue
        files[path.relative_to(base).as_posix()] = sha256_file(path)
    return files


def make_manifest(
    base: Path,
    exclude: Path | None = None,
    include_generated: bool = True,
    note: str | None = None,
) -> dict[str, object]:
    return {
        "format": MANIFEST_FORMAT,
        "base": str(Path(base).resolve()),
        "created": datetime.now().isoformat(timespec="seconds"),
        "note": note,
        "files": hash_tree(base, exclude, include_generated),
    }


def write_manifest(manifest: dict[str, object], output: Path) -> Path:
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return output


def load_manifest(path: Path) -> dict[str, object]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("format") != MANIFEST_FORMAT:
        raise VerificationFailed(
            f"Unsupported manifest format {data.get('format')!r}; "
            f"expected {MANIFEST_FORMAT!r}"
        )
    return data


def diff_manifest(
    manifest: dict[str, object],
    base: Path | None = None,
    include_generated: bool = True,
) -> dict[str, list[str]]:
    """Compare a manifest against the current tree.

    Returns lists of ``missing``, ``added``, and ``changed`` paths.  An empty
    result across all three means the tree is byte-for-byte identical.
    """
    target = Path(base) if base else Path(str(manifest["base"]))
    expected: dict[str, str] = manifest["files"]  # type: ignore[assignment]
    actual = hash_tree(target, include_generated=include_generated)
    return {
        "missing": sorted(set(expected) - set(actual)),
        "added": sorted(set(actual) - set(expected)),
        "changed": sorted(
            name for name in set(actual) & set(expected) if actual[name] != expected[name]
        ),
    }


def verify(
    manifest: dict[str, object],
    base: Path | None = None,
    include_generated: bool = True,
    raise_on_difference: bool = True,
) -> dict[str, list[str]]:
    result = diff_manifest(manifest, base, include_generated)
    if raise_on_difference and any(result.values()):
        summary = ", ".join(f"{k}={len(v)}" for k, v in result.items() if v)
        raise VerificationFailed(f"Snapshot verification failed: {summary}")
    return result


def default_backup_dir(project_root: Path) -> Path:
    """Where to place backups for a project.

    Deliberately outside the project directory: a backup inside the tree would
    be picked up by MotionWorks and by later snapshots.
    """
    return (
        Path(os.environ.get("MOTIONWORKS_MCP_BACKUP_DIR", Path.home() / ".motionworks-iec-mcp"))
        / "backups"
        / project_root.name
    )
