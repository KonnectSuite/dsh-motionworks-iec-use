"""Read a MotionWorks project's user-defined data types from ``DT/Tyllist.typ``.

Why this exists: a POU in this project declares ``CamData : CamSegmentStruct`` and
``CamTable : Y_MS_CAM_STRUCT``, and writing Structured Text that touches either one needs
the member names. Nothing in this plugin could read them, so the agent was writing code
against types it could not see.

The file is line-oriented, tab-separated. Measured from a real project:

    (*
    NDTE: 297        number of data types
    NCPE: 943        number of components (members, array bounds, and so on)
    NDME: 147        number of direct members
    *)
    24 0<TAB>ControllerInfoTypes\\Cont<TAB>FIRMWARE_INFO<TAB>1031<TAB>5<TAB>USER<TAB>STRUCT
    25 0<TAB><TAB>VersionNumber<TAB>VERSION_NUMBER<TAB>1027<TAB>0

Splitting on tabs, a TYPE line and a MEMBER line differ in ONE place that matters:

    TYPE    ['24 0', 'ControllerInfoTypes\\Cont', 'FIRMWARE_INFO', '1031', '5', 'USER', 'STRUCT']
    MEMBER  ['25 0', '',                          'VersionNumber', 'VERSION_NUMBER', '1027', '0']

so the discriminator is the CONTAINER field at index 1 - empty for a member, a namespace
path for a type - and the NAME is at index 2 in both cases. An earlier version of this
reader looked at index 2 for the container and index 3 for the name, which turned every
member into a type with an id for a name: it reported 1054 types where the header says 297.

An ARRAY carries its element type on the type line and its bound on the line after:

    15 0<TAB>ControllerInfoTypes\\Cont<TAB>BYTE32<TAB>1024<TAB>1<TAB>USER<TAB>ARRAY<TAB>BYTE<TAB>17
    15 0<TAB><TAB><TAB>0<TAB>31

Library types are NOT in this file. ``CamGenerator`` and ``Y_CamStructSelect`` are used by
the POUs and absent here, because they come from an installed library rather than the
project. This reader reports what the project defines and says so when asked for one it does
not have.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .errors import NotFound

TYPE_FILE = "DT/Tyllist.typ"
_COUNTS = re.compile(r"^\s*(\w+)\s*:\s*(\d+)\s*$")
_INDEX = re.compile(r"^\s*\d+(\s+\d+)?\s*$")


@dataclass
class DataTypeMember:
    """One member of a user-defined type."""

    name: str
    type_name: str
    type_id: int = 0
    array_size: int | None = None


@dataclass
class DataType:
    """One user-defined type."""

    name: str
    kind: str = ""
    type_id: int = 0
    container: str = ""
    declared_members: int = 0
    element_type: str = ""
    element_id: int = 0
    members: list[DataTypeMember] = field(default_factory=list)

    @property
    def is_struct(self) -> bool:
        return self.kind.upper() in ("STRUCT", "UNION")

    @property
    def is_array(self) -> bool:
        return self.kind.upper() in ("ARRAY", "MATRIX")


def types_path(project_root: Path) -> Path:
    candidate = Path(project_root) / TYPE_FILE
    if not candidate.is_file():
        raise NotFound(
            f"no {TYPE_FILE} in {project_root}; this project defines no data types of its own "
            f"- library types such as CamGenerator live outside the project"
        )
    return candidate


def _int_at(fields: list[str], index: int, default: int = 0) -> int:
    if index >= len(fields):
        return default
    try:
        return int(fields[index].strip())
    except ValueError:
        return default


def read_types(project_root: Path) -> tuple[list[DataType], dict[str, int]]:
    """Parse the type list, returning ``(types, header_counts)``.

    ``header_counts`` is the file's own ``NDTE``/``NCPE``/``NDME`` tally, which is a useful
    check on the parse: a count that does not match the number of types found means the
    layout is not what this reader assumes.
    """
    text = types_path(project_root).read_text(encoding="latin1", errors="replace")

    counts: dict[str, int] = {}
    types: list[DataType] = []
    current: DataType | None = None
    pending_array: DataType | None = None

    for raw in text.splitlines():
        if not raw.strip():
            continue
        stripped = raw.strip()
        if stripped.startswith("(*") or stripped.startswith("*)"):
            continue
        match = _COUNTS.match(stripped)
        if match:
            counts[match.group(1)] = int(match.group(2))
            continue

        fields = raw.split("\t")
        if len(fields) < 2 or not _INDEX.match(fields[0]):
            continue

        container, name = fields[1].strip(), (fields[2].strip() if len(fields) > 2 else "")

        if container:
            # A TYPE line: container, NAME, id, declared count, source, KIND, ...
            if not name:
                continue
            kind = fields[6].strip() if len(fields) > 6 else ""
            current = DataType(
                name=name,
                kind=kind,
                type_id=_int_at(fields, 3),
                container=container,
                declared_members=_int_at(fields, 4),
            )
            if current.is_array and len(fields) > 7:
                current.element_type = fields[7].strip()
                current.element_id = _int_at(fields, 8)
                pending_array = current
            else:
                pending_array = None
            types.append(current)
            continue

        # A MEMBER line, or the bound line that follows an ARRAY type line.
        if pending_array is not None and not name:
            for value in fields[2:]:
                if value.strip().isdigit():
                    pending_array.declared_members = int(value.strip())
                    break
            pending_array = None
            continue

        if current is None:
            continue
        # The bound line of an array whose element field was blank arrives here as a
        # nameless record with a number; treat that as the bound, not a member.
        if not name:
            for value in fields[2:]:
                if value.strip().isdigit():
                    current.declared_members = int(value.strip())
                    break
            continue

        bound = None
        for value in fields[5:]:
            text_value = value.strip()
            if text_value.isdigit() and int(text_value) > 1:
                bound = int(text_value)
                break
        current.members.append(
            DataTypeMember(
                name=name,
                type_name=fields[3].strip() if len(fields) > 3 else "",
                type_id=_int_at(fields, 4),
                array_size=bound,
            )
        )

    return types, counts


def find_type(project_root: Path, name: str) -> DataType:
    """One type by name, case-insensitively."""
    types, _ = read_types(project_root)
    for t in types:
        if t.name.lower() == name.lower():
            return t
    defined = sorted({t.name for t in types})
    sample = ", ".join(defined[:25])
    raise NotFound(
        f"no data type named {name!r} defined in this project. It defines {len(types)}: "
        f"{sample}{' ...' if len(defined) > 25 else ''}. Types used by POUs but absent here "
        f"come from an installed library rather than the project."
    )
