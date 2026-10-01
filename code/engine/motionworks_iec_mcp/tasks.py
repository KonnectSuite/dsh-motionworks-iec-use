"""Read MotionWorks task configuration.

Each resource task has a plain-text ``<Task>.SET`` file beside the resource
``src.st1``::

    TASK FastTsk
    (TYPE := CYCLIC,
    INTERVAL := T#4ms,
    PRIORITY := 0,
    WATCHDOG := 4
    WATCHDOG_DISPLAY := 4
    WATCHDOG_ENABLED := YES
    );

This is useful context for anyone editing motion code.  Cycle time and priority
decide whether a block can finish in its task, and the watchdog decides what
happens when it cannot -- both matter more in motion control than in ordinary PLC
logic, and neither is visible from the POU bodies alone.

The format is close to IEC structured text but is not valid ST: fields are
newline-separated inside the parentheses and only the last one carries a
semicolon, so a real ST parser rejects it.  This reader is therefore its own
small field parser rather than a reuse of the declaration parser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .errors import NotFound

#: ``TASK <name>`` on the first meaningful line.
_TASK_RE = re.compile(r"^\s*TASK\s+(\S+)", re.IGNORECASE)
#: ``FIELD := value`` with an optional trailing comma or semicolon.
_FIELD_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)[ \t]*:=[ \t]*([^,;\r\n]*)")


@dataclass
class TaskSettings:
    """One task's configuration."""

    name: str
    source: Path
    fields: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def type(self) -> str | None:
        return self.fields.get("TYPE")

    @property
    def interval(self) -> str | None:
        """Cycle time such as ``T#4ms``, for cyclic tasks."""
        return self.fields.get("INTERVAL")

    @property
    def priority(self) -> int | None:
        raw = self.fields.get("PRIORITY")
        try:
            return int(raw) if raw is not None else None
        except ValueError:
            return None

    @property
    def watchdog(self) -> str | None:
        return self.fields.get("WATCHDOG")

    @property
    def watchdog_enabled(self) -> bool | None:
        raw = self.fields.get("WATCHDOG_ENABLED")
        if raw is None:
            return None
        return raw.strip().upper() in {"YES", "TRUE", "1"}

    def summary(self) -> str:
        bits = [f"TYPE={self.type or '?'}"]
        if self.interval:
            bits.append(f"cycle={self.interval}")
        if self.priority is not None:
            bits.append(f"priority={self.priority}")
        # Report the watchdog whenever we know anything about it.  Gating this on
        # a WATCHDOG value alone hid the "disabled" state for tasks that set only
        # WATCHDOG_ENABLED, which is exactly the case worth surfacing.
        if self.watchdog or self.watchdog_enabled is not None:
            state = " (disabled)" if self.watchdog_enabled is False else ""
            bits.append(f"watchdog={self.watchdog or 'n/a'}{state}")
        for key in ("SPG", "INTERVAL_DISPLAY"):
            if key in self.fields:
                bits.append(f"{key.lower()}={self.fields[key]}")
        return "  ".join(bits)


def parse_task_settings(text: str, source: Path | None = None) -> TaskSettings:
    """Parse a ``.SET`` payload.

    Raises :class:`NotFound` when the text does not begin with a ``TASK`` line,
    which is how a non-task ``.SET`` file is rejected rather than mis-parsed.
    """
    match = _TASK_RE.search(text)
    if match is None:
        raise NotFound(
            f"{source.name if source else '<text>'} is not a task settings file "
            f"(no TASK line)"
        )

    settings = TaskSettings(
        name=match.group(1).strip(),
        source=source or Path("<text>"),
    )
    for field_match in _FIELD_RE.finditer(text):
        key = field_match.group(1).upper()
        value = field_match.group(2).strip()
        if key in settings.fields:
            settings.warnings.append(f"duplicate field {key!r}; kept the first")
            continue
        settings.fields[key] = value
    return settings


def task_files(project_root: Path) -> list[Path]:
    """Every ``*.SET`` that looks like a task configuration in a project."""
    root = Path(project_root)
    found: list[Path] = []
    for pattern in ("C/Configuration/R/Resource", "C/Resource/R/Resource"):
        directory = root / pattern
        if directory.is_dir():
            found.extend(sorted(directory.glob("*.SET")))
    return found


def read_tasks(project_root: Path) -> list[TaskSettings]:
    """Read every task configuration in a project.

    Task files sit beside the resource ``src.st1``.  Files that are not task
    settings are skipped rather than treated as errors, because the same
    directory holds other ``.SET`` files.
    """
    settings: list[TaskSettings] = []
    for path in task_files(project_root):
        try:
            text = path.read_bytes().decode("latin1")
        except OSError:
            continue
        try:
            settings.append(parse_task_settings(text, path))
        except NotFound:
            continue
    # Present cyclic tasks in ascending cycle time, which is how a user thinks
    # about them: the fastest task is the one with the least time to spare.
    def sort_key(item: TaskSettings):
        interval = item.interval or ""
        match = re.search(r"T#(\d+(?:\.\d+)?)(ms|us|s|ns)?", interval, re.IGNORECASE)
        if not match:
            return (2, 0.0, item.name)
        value = float(match.group(1))
        unit = (match.group(2) or "ms").lower()
        scale = {"ns": 1e-6, "us": 1e-3, "ms": 1.0, "s": 1000.0}[unit]
        return (0, value * scale, item.name)

    return sorted(settings, key=sort_key)
