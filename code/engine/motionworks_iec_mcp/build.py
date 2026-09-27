"""Drive a real MotionWorks build, and use the result to verify or revert a write.

The motivation is a measured limitation rather than a design preference.  Static
checks can predict *some* declaration failures -- a non-``BOOL`` type on a bit
address, or a dangling reference -- but not all of them: one variable delete was
verified as unreferenced and still failed to compile, for reasons that remain
unexplained (see docs/tier2-format-notes.md).

The only trustworthy validation of a change is compiling it.  So instead of
predicting, this module:

1. applies a write,
2. drives a real Build/Rebuild through COM,
3. reads whether the project compiled,
4. **restores the backup automatically if it did not.**

That turns an unpredictable operation into one whose failure is detected and
undone, which is a stronger guarantee than prediction.

The COM mechanism is the one proven in docs/tier3-com-build.md: a 32-bit shell is
required, the automation server only works while the IDE is running, and a trial
install's startup dialog must be dismissed first.  All of that lives in
``tools/mw_build.ps1``; this module just invokes it and interprets the result.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .errors import MotionWorksError

#: Marker the PowerShell helper puts in front of its JSON document, so the
#: result can be found even when the IDE writes to the same stream.
_JSON_MARKER = "MWBUILD_JSON:"

#: 32-bit Windows PowerShell.  Required because mwt.exe is 32-bit and its COM
#: wrapper is registered only in the 32-bit registry view.
POWERSHELL_32 = Path(
    os.environ.get("SystemRoot", r"C:\Windows")
) / "SysWOW64/WindowsPowerShell/v1.0/powershell.exe"

#: The build helper lives in the repository's tools/ directory.
_HELPER = Path(__file__).resolve().parents[2] / "tools" / "mw_build.ps1"

#: Where a space-free copy of a project is staged when its real path contains a
#: space.  Deliberately inside the repository rather than the system temp
#: directory: the development sandbox permits writes only under the workspace,
#: and a denied create can block instead of raising.
_STAGE_ROOT = Path(__file__).resolve().parents[2] / ".mw_build_stage"


class BuildUnavailable(MotionWorksError):
    """The build could not be driven at all.

    Distinct from a build that ran and failed: this means the mechanism is
    missing, so no conclusion about the project can be drawn.
    """


@dataclass
class BuildResult:
    """Outcome of one build attempt."""

    ok: bool = False
    project: str = ""
    loaded: bool = False
    compiled: bool | None = None
    modified: bool | None = None
    dlls: int = 0
    err: str = ""
    stage: str = ""
    error: str = ""

    @property
    def ide_would_not_load(self) -> bool:
        """True when the project never loaded, so no compile was attempted.

        This is distinct from a genuine compile failure and must not be treated
        as one.  Observed cause: the IDE sitting at a startup prompt, in which
        case *every* automation call -- including ``IsProjectOpen()`` on an
        unmodified project -- returns "Internal error".  Reporting that as "the
        code does not compile" would be badly misleading.
        """
        return self.error.startswith("project did not load") or self.stage == "load failed"

    @classmethod
    def from_payload(cls, payload: dict[str, object]) -> "BuildResult":
        return cls(
            ok=bool(payload.get("ok")),
            project=str(payload.get("project", "")),
            loaded=bool(payload.get("loaded")),
            compiled=payload.get("compiled"),  # type: ignore[arg-type]
            modified=payload.get("modified"),  # type: ignore[arg-type]
            dlls=int(payload.get("dlls") or 0),
            err=str(payload.get("err") or ""),
            stage=str(payload.get("stage") or ""),
            error=str(payload.get("error") or ""),
        )

    def summary(self) -> str:
        bits = [
            f"compiled={self.compiled}",
            f"pou_dlls={self.dlls}",
        ]
        if self.stage:
            bits.append(f"stage={self.stage}")
        if self.err.strip():
            bits.append(f"compiler_errors={self.err.strip()[:200]!r}")
        if self.error:
            bits.append(f"error={self.error}")
        return "  ".join(bits)


def build_available() -> tuple[bool, str]:
    """Whether a build can be driven here, with the reason if not."""
    if sys.platform != "win32":
        return False, "not running on Windows"
    if not POWERSHELL_32.is_file():
        return False, f"32-bit PowerShell not found at {POWERSHELL_32}"
    if not _HELPER.is_file():
        return False, f"build helper not found at {_HELPER}"
    exe = Path(
        r"C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Mwt.exe"
    )
    if not exe.is_file():
        return False, f"MotionWorks not found at {exe}"
    return True, "ok"


def _stage_spacefree(project_mwt: Path) -> Path:
    """Return a copy of ``project_mwt`` at a path containing no spaces.

    The ``.mwt`` is a small pointer file and the real project lives in the
    sibling directory, so the sibling is copied alongside it to keep the pair
    together.  Returns the original path unchanged when it already has no space.
    """
    project_mwt = Path(project_mwt)
    if " " not in str(project_mwt) and "\t" not in str(project_mwt):
        return project_mwt

    import tempfile  # noqa: F401  (kept out of the path logic on purpose)

    project_dir = project_mwt.with_suffix("")
    base = _STAGE_ROOT
    base.mkdir(parents=True, exist_ok=True)

    staged_mwt = base / project_mwt.name
    shutil.copy2(project_mwt, staged_mwt)

    staged_dir = base / project_dir.name
    if staged_dir.exists():
        shutil.rmtree(staged_dir, ignore_errors=True)
    if project_dir.is_dir():
        shutil.copytree(project_dir, staged_dir)
    return staged_mwt


def _quote(value: str) -> str:
    """Wrap an argument in quotes when it contains a space.

    PowerShell's ``-File`` parameter splits its own arguments, and a path such as
    ``...\\MP2600iec Program\\TopCutter.mwt`` is silently truncated without this.
    That failure mode is nasty: the helper then reports "project did not load",
    which looks like a problem with the project rather than with the invocation.
    """
    if " " in value or "\t" in value:
        return f'"{value}"'
    return value


def run_build(project_mwt: Path, timeout: int = 600) -> BuildResult:
    """Drive a Build/Rebuild of ``project_mwt`` and return the outcome.

    Raises :class:`BuildUnavailable` when the mechanism is missing, so callers
    can distinguish "could not try" from "tried and it failed".
    """
    available, reason = build_available()
    if not available:
        raise BuildUnavailable(f"cannot drive a build: {reason}")

    # Invoked through a short space-free staging directory.  PowerShell's -File
    # parameter does its own argument splitting, and a path containing a space
    # (such as "...\MP2600iec Program\TopCutter.mwt") is silently truncated --
    # the helper then reports "project did not load", which looks like a project
    # problem rather than an invocation bug.  Avoiding the space is more robust
    # than trying to escape it through two layers of quoting.
    staged = _stage_spacefree(project_mwt)
    # Invoked with -ExecutionPolicy Bypass AND -Command.
    #
    # Both are needed, which was established by testing each form:
    #   * with -File, PowerShell ignores the policy flag when launched from a
    #     non-shell parent and refuses the script with "is not digitally signed";
    #   * with -Command but no policy flag, the same refusal occurs;
    #   * -Command *with* the policy flag runs it.
    # The helper reports its own outcome in JSON, so the process exit code is not
    # used to decide success.
    command = [
        str(POWERSHELL_32),
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        f"& '{_HELPER}' -Project '{staged}'",
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired as exc:
        raise BuildUnavailable(
            f"build did not finish within {timeout}s"
        ) from exc

    payload = _extract_payload(completed.stdout) or _extract_payload(completed.stderr)
    if payload is None:
        tail = (completed.stdout or "")[-400:]
        raise BuildUnavailable(
            f"build helper produced no result (exit {completed.returncode}). "
            f"Last output: {tail!r}"
        )
    return BuildResult.from_payload(payload)


def _extract_payload(text: str) -> dict[str, object] | None:
    """Find and decode the JSON document the helper emits."""
    if not text:
        return None
    for line in reversed(text.splitlines()):
        index = line.find(_JSON_MARKER)
        if index < 0:
            continue
        raw = line[index + len(_JSON_MARKER):].strip()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


@dataclass
class VerifiedWrite:
    """A write plus the build verdict, and whether it had to be undone."""

    written: dict[str, object] = field(default_factory=dict)
    build: BuildResult | None = None
    reverted: bool = False
    revert_paths: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        if self.build is None:
            return False
        return bool(self.build.ok) and not self.reverted


def apply_and_verify(
    plan: object,
    project_root: Path,
    project_mwt: Path | None = None,
    revert_on_failure: bool = True,
    timeout: int = 600,
) -> VerifiedWrite:
    """Apply ``plan``, build the project, and revert if it did not compile.

    ``plan`` is a :class:`motionworks_iec_mcp.writer.WritePlan`.  Typed loosely to
    avoid an import cycle.
    """
    from . import writer as W

    outcome = VerifiedWrite()
    result = W.apply_plan(plan, project_root)  # type: ignore[arg-type]
    outcome.written = result
    backups = [Path(p) for p in result.get("backups", [])]  # type: ignore[union-attr]

    if not result.get("applied"):
        outcome.notes.append("nothing was written, so nothing to verify")
        return outcome

    if project_mwt is None:
        project_mwt = _default_mwt(project_root)
    if project_mwt is None or not project_mwt.is_file():
        outcome.notes.append(
            "no .mwt found, so the write could not be verified by building"
        )
        return outcome

    try:
        outcome.build = run_build(project_mwt, timeout=timeout)
    except BuildUnavailable as exc:
        outcome.notes.append(f"build unavailable: {exc}")
        return outcome

    if outcome.build.ok:
        return outcome

    # A project that never loaded is not a compile failure, and reverting because
    # of it would destroy a perfectly good change on the strength of an
    # environmental problem.  Report it and leave the write in place.
    if outcome.build.ide_would_not_load:
        outcome.notes.append(
            "the IDE did not load the project, so no compile was attempted. "
            "This is an environment problem, NOT a compile failure; the write "
            "has been left in place. Check the MotionWorks window for a startup "
            "or licensing prompt."
        )
        return outcome

    outcome.notes.append(f"build failed: {outcome.build.summary()}")
    if not revert_on_failure:
        outcome.notes.append("not reverting")
        return outcome

    pairs = result.get("backup_pairs") or []
    if not pairs:
        outcome.notes.append("no backup recorded, so the change could not be reverted")
        return outcome

    outcome.revert_paths = _restore(
        [{"original": p["original"], "backup": p["backup"]} for p in pairs]  # type: ignore[index]
    )
    outcome.reverted = True
    outcome.notes.append(
        f"reverted {len(outcome.revert_paths)} file(s) from backup"
    )
    return outcome


def _default_mwt(project_root: Path) -> Path | None:
    """The ``.mwt`` beside an expanded project directory."""
    candidate = project_root.with_suffix(".mwt")
    if candidate.is_file():
        return candidate
    sibling = project_root.parent / f"{project_root.name}.mwt"
    return sibling if sibling.is_file() else None


def _restore(pairs: list[dict[str, str]]) -> list[str]:
    """Copy backups back over the exact files they came from.

    ``pairs`` entries are ``{"original": <path>, "backup": <path>}``.  The
    original path is supplied rather than inferred: an earlier version searched
    the backup path for the project name, which finds the wrong position when the
    name occurs twice in the path and would restore to the wrong file.
    """
    restored: list[str] = []
    for pair in pairs:
        original = Path(pair["original"])
        backup = Path(pair["backup"])
        if not backup.is_file():
            continue
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, original)
        restored.append(str(original))
    return restored
