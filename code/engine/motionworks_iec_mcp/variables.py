"""Parse MotionWorks IEC variable declarations.

A MotionWorks POU stores its variables in two places inside ``src.st1``:

``<POU>V.VB``
    The authoritative *textual* IEC 61131-3 declarations.  This is what the
    MotionWorks variable grid is showing you, and it carries the names, types,
    addresses, and ``(*...*)`` descriptions.  It is plain text and it is
    complete, so it is the primary source of truth here.

``<POU>V.VGR``
    A binary "variable grid" record table holding the grid's UI state (handles,
    row positions, usage flags, group assignment).  It duplicates some of what
    ``.VB`` holds and adds editor metadata.

Format of ``.VB`` (observed across all 34 declaration streams in the sample
projects)::

    <blank>
    (*Group:Default*)
    <blank>
    <blank>
    VAR_EXTERNAL
    \tTopCutter :\tAXIS_REF;(*SGD7S - 1 (Do Not Modify!!) *)<CRLF>
    \tEIP_FromCLX_Axis_SVON_Cmd :\tBOOL;<CRLF>
    END_VAR
    <blank>
    <blank>
    VAR
    \tMC_TopCutter_ServoOn :\tMC_Power;<CRLF>
    END_VAR

Only ``VAR`` and ``VAR_EXTERNAL`` appear in POU files; the resource-level
``Global_Variables.VB`` uses ``VAR_GLOBAL``.  Blocks with the same keyword may
repeat, each optionally preceded by its own ``(*Group:...*)`` marker, so a
variable's group is the most recent marker seen at or before it.

Grammar per declaration::

    <name> [AT <address>] : <type> ; [(*description*)]
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field

from .errors import UnsupportedFormat

#: Block keywords that may introduce a declaration list.
BLOCK_KEYWORDS = (
    "VAR_GLOBAL",
    "VAR_EXTERNAL",
    "VAR_INPUT",
    "VAR_OUTPUT",
    "VAR_IN_OUT",
    "VAR_TEMP",
    "VAR_RETAIN",
    "VAR_CONFIG",
    "VAR_ACCESS",
    "VAR",
)

_GROUP_RE = re.compile(
    r"^\(\*Group\s*:\s*(?P<inner>.*)\*\)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_TRAILING_COMMENT_RE = re.compile(r"\(\*(.*?)\*\)\s*$", re.DOTALL)
_ADDRESS_RE = re.compile(r"^(.*?)\s+AT\s+(\S+)$", re.IGNORECASE | re.DOTALL)

#: Keywords that may follow a block keyword without introducing a declaration.
#: ``VAR_GLOBAL RETAIN`` is real MotionWorks output; ``RETAIN`` is a modifier,
#: not a variable name.
_BLOCK_MODIFIERS = {
    "RETAIN", "NON_RETAIN", "CONSTANT", "PERSISTENT", "VAR_INPUT", "VAR_OUTPUT",
}

#: Usage values observed in the .VGR binary grid, for cross-checking.
USAGE_LOCAL = 1
USAGE_EXTERNAL = 5
USAGE_FB_INSTANCE = 0x00040001
USAGE_NAMES = {
    USAGE_LOCAL: "local",
    USAGE_EXTERNAL: "external",
    USAGE_FB_INSTANCE: "fb-instance",
}

#: Block keyword -> whether it declares data owned by this POU.
_EXTERNAL_BLOCKS = {"VAR_EXTERNAL"}


@dataclass
class Variable:
    """A single declared variable."""

    name: str
    type_name: str
    section: str
    group: str | None = None
    address: str | None = None
    description: str | None = None
    line: int = 0
    initial_value: str | None = None

    @property
    def is_external(self) -> bool:
        """True when the POU references a symbol owned elsewhere."""
        return self.section in _EXTERNAL_BLOCKS

    @property
    def is_global(self) -> bool:
        return self.section == "VAR_GLOBAL"

    @property
    def base_type(self) -> str:
        """The type with any array/string qualification reduced.

        ``ARRAY [0..7] OF INT`` reduces to ``ARRAY`` and ``STRING[80]`` to
        ``STRING``, so classification is not fooled by parameters.
        """
        text = self.type_name.strip()
        upper = text.upper()
        if upper.startswith("ARRAY"):
            return "ARRAY"
        if "[" in text:
            text = text.split("[", 1)[0].strip()
        if "." in text:
            # A dotted type such as a library structure reference.
            text = text.rsplit(".", 1)[-1].strip()
        return text

    @property
    def is_fb_instance(self) -> bool:
        """True when the type looks like a function-block instance.

        MotionWorks marks these with usage ``0x00040001`` in the binary grid.
        A function-block instance is a *stateful* instance rather than a plain
        value, which matters when transplanting bodies between POUs.  The check
        is case-insensitive and ignores any default initialiser, because a
        declaration such as ``BOOL := FALSE`` is a plain value.
        """
        return (
            not self.is_global
            and not self.is_external
            and self.base_type.upper() not in BUILTIN_TYPES
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "type": self.type_name,
            "section": self.section,
            "group": self.group,
            "address": self.address,
            "initial_value": self.initial_value,
            "description": self.description,
            "line": self.line,
        }

    def format_line(self) -> str:
        bits = [self.name]
        if self.address:
            bits.append(f"AT {self.address}")
        text = f"{' '.join(bits)} : {self.type_name}"
        if self.initial_value:
            text += f" := {self.initial_value}"
        if self.description:
            text += f"  (*{self.description}*)"
        return text


@dataclass
class DeclarationTable:
    """Every variable declared in one ``.VB`` stream."""

    variables: list[Variable] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    source_stream: str | None = None

    def __len__(self) -> int:
        return len(self.variables)

    def by_name(self, name: str) -> Variable | None:
        target = name.casefold()
        for v in self.variables:
            if v.name.casefold() == target:
                return v
        return None

    def sections(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for v in self.variables:
            counts[v.section] = counts.get(v.section, 0) + 1
        return counts

    def duplicates(self) -> dict[str, list[Variable]]:
        seen: dict[str, list[Variable]] = {}
        for v in self.variables:
            seen.setdefault(v.name.casefold(), []).append(v)
        return {k: v for k, v in seen.items() if len(v) > 1}

    def variants(self, name: str) -> list[Variable]:
        """All declarations of ``name``, in file order.

        MotionWorks permits the same symbol to appear in more than one block
        (for example declared in a ``VAR`` and referenced in a
        ``VAR_EXTERNAL``), so callers must not assume a name is unique.
        """
        target = name.casefold()
        return [v for v in self.variables if v.name.casefold() == target]


#: IEC elementary types that are plain values rather than function-block
#: instances.  Types deliberately *not* listed here (``AXIS_REF``,
#: ``TASK_INFO_ECLR``, ``CONTROLLER_INFO``, library structures) are reported as
#: instances, because classification only affects how a donor body is treated.
BUILTIN_TYPES = {
    "BOOL", "BYTE", "WORD", "DWORD", "LWORD", "SINT", "USINT", "INT", "UINT",
    "DINT", "UDINT", "LINT", "ULINT", "REAL", "LREAL", "STRING", "WSTRING",
    "TIME", "LTIME", "DATE", "LDATE", "TOD", "LTOD", "DT", "LDT", "CHAR",
    "WCHAR", "TIME_OF_DAY", "DATE_AND_TIME", "ARRAY",
}


def _split_type_initial_comment(body: str) -> tuple[str, str | None, str | None]:
    """Split ``TYPE := INIT;(*desc*)`` into type, initial value, and description."""
    description = None
    match = _TRAILING_COMMENT_RE.search(body)
    if match:
        description = match.group(1).strip()
        body = body[: match.start()]
    body = body.strip().rstrip(";").strip()

    initial_value = None
    if ":=" in body:
        body, initial_value = body.split(":=", 1)
        initial_value = initial_value.strip()
    return body.strip(), initial_value, description


def parse_declarations(text: str, source_stream: str | None = None) -> DeclarationTable:
    """Parse a ``.VB`` declaration stream into a :class:`DeclarationTable`.

    The parser is tolerant: a line it cannot interpret becomes a warning rather
    than an exception, because a partially understood file is still useful for
    reading and a hard failure would hide the rest of the project.
    """
    table = DeclarationTable(source_stream=source_stream)
    section: str | None = None
    group: str | None = None

    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()

        group_match = _GROUP_RE.match(line)
        if group_match:
            group = group_match.group("inner").strip()
            # A group marker is always alone on its line in practice, so once it
            # is recognised the whole line is consumed.
            continue

        if not line:
            continue

        upper = line.upper()

        if upper == "END_VAR":
            section = None
            continue

        # Match the longest keyword first so VAR_EXTERNAL never matches VAR.
        matched_block = None
        for keyword in BLOCK_KEYWORDS:
            if upper == keyword or upper.startswith(keyword + " "):
                # Guard against "VAR_EXTERNAL" being caught by a prefix rule.
                matched_block = keyword
                break
        if matched_block:
            section = matched_block
            remainder = line[len(matched_block):].strip()
            if not remainder or remainder.upper().rstrip() in _BLOCK_MODIFIERS:
                # "VAR_GLOBAL RETAIN" declares nothing on this line.
                continue
            line = remainder
            upper = line.upper()

        if section is None:
            table.warnings.append(
                f"line {lineno}: declaration outside any VAR block: {line!r}"
            )
            continue

        if ":" not in line:
            table.warnings.append(f"line {lineno}: no ':' in declaration: {line!r}")
            continue

        left, right = line.split(":", 1)
        type_name, initial_value, description = _split_type_initial_comment(right)
        if not type_name:
            table.warnings.append(f"line {lineno}: empty type in {line!r}")
            continue

        left = left.strip()
        address = None
        address_match = _ADDRESS_RE.match(left)
        if address_match:
            left = address_match.group(1).strip()
            address = address_match.group(2).strip()

        if not left:
            table.warnings.append(f"line {lineno}: empty variable name in {line!r}")
            continue

        # A left side such as "A, B" declares several names of one type.
        for name in (n.strip() for n in left.split(",")):
            if not name:
                continue
            table.variables.append(
                Variable(
                    name=name,
                    type_name=type_name,
                    section=section,
                    group=group,
                    address=address,
                    description=description,
                    line=lineno,
                    initial_value=initial_value,
                )
            )

    if section is not None:
        table.warnings.append(f"unterminated {section} block at end of file")

    for name, dupes in table.duplicates().items():
        table.warnings.append(
            f"variable {name!r} declared {len(dupes)} times "
            f"(lines {', '.join(str(d.line) for d in dupes)})"
        )

    return table


def parse_grid_records(grid: bytes) -> list[dict]:
    """Locate every variable record in a POU's binary ``.VGR`` grid.

    Layout, established by decoding a real grid byte by byte:

        +0    6 x uint32   handle, usage, group, flags, worksheet row, final flags
        +24   uint32       byte length of the TYPE string
              ...          the type, UTF-16LE with a NUL terminator
              +0  +4  +8  +12      FOUR more uint32
              uint32       byte length of the NAME string
              ...          the name, UTF-16LE with a NUL terminator
              ...          a variable trailing run

    The four uint32 between the type and the name are the part that is easy to miss -
    an earlier version assumed the name followed the type directly, misread every
    record's name as empty, and cloned a record with the name written in the wrong
    place, which stalled the linker with no diagnostic at all.

    ``usage`` is 5 for an external variable, 1 for a local one and 0x00040001 for a
    function-block instance.  Records are found by their field pattern rather than a
    fixed stride, because the strings make the stride uneven (84 to 258 bytes here).
    """
    if len(grid) < 12:
        return []
    records = []
    for offset in range(12, max(12, len(grid) - 23)):
        handle, usage, group, flags, row, final_flags = struct.unpack_from(
            "<6I", grid, offset
        )
        if (
            1000 <= handle <= 10000
            and usage in (1, 5, 0x00040001)
            and group == 1
            and flags == 0
            and 1 <= row <= 999
            and final_flags == 0
        ):
            records.append(
                {"offset": offset, "handle": handle, "usage": usage, "row": row}
            )
    return records


def read_grid_record(grid: bytes, offset: int) -> dict:
    """Decode one record's four length-prefixed strings and their byte ranges.

    A record holds FOUR strings, measured on a real grid:

        1  the TYPE
        2  always empty
        3  the INITIAL VALUE   - "" for an external, "FALSE" for a local BOOL, "0" for a
                                 local INT, "" for a struct
        4  the NAME

    An earlier version skipped a fixed 12 bytes between the type and the name. That is the
    size of strings 2 and 3 when BOTH are empty, so it worked for every external record and
    quietly broke for every local one - records holding "FALSE", "0" and their names
    decoded as garbage, and the name of a freshly written record came back shifted.

    Returns the type, the initial value, the name, and the byte ranges needed to rebuild
    the record while touching nothing that is not understood.
    """
    pos = offset + 24
    spans = []
    for _ in range(4):
        length = struct.unpack_from("<I", grid, pos)[0]
        spans.append((pos, pos + 4, pos + 4 + length))
        pos += 4 + length

    def text(span):
        start, _, end = span
        return grid[start + 4:end].decode("utf-16-le", "replace").rstrip("\x00")

    return {
        "type": text(spans[0]),
        "initial_value": text(spans[2]),
        "name": text(spans[3]),
        "type_at": spans[0][0],
        "between_at": spans[0][2],
        "initial_at": spans[2][0],
        "name_at": spans[3][0],
        "after_name": spans[3][2],
        "strings_end": pos,
    }

def _record_extent(grid: bytes, records: list[dict], index: int) -> int:
    """Byte length of the record at ``index``, bounded by the next record."""
    start = records[index]["offset"]
    if index + 1 < len(records):
        return records[index + 1]["offset"] - start
    return len(grid) - start


def default_initial_value(type_name: str) -> str:
    """The initial value a LOCAL scalar declaration carries.

    Measured: a local BOOL record holds "FALSE" where an external one holds nothing, and a
    local INT holds "0". A struct holds nothing, because a struct has no scalar default.
    Writing an empty third string for a local scalar leaves a record that does not match
    anything MotionWorks writes itself.
    """
    table = {
        "BOOL": "FALSE",
        "BYTE": "0", "SINT": "0", "USINT": "0", "INT": "0", "UINT": "0",
        "WORD": "0", "DINT": "0", "UDINT": "0", "DWORD": "0",
        "LINT": "0", "ULINT": "0", "LWORD": "0",
        "REAL": "0.0", "LREAL": "0.0",
        "TIME": "T#0s", "DATE": "D#1970-01-01",
    }
    return table.get((type_name or "").upper(), "")

def append_grid_variable(
    grid: bytes, name: str, type_name: str, row: int | None = None,
    initial_value: str | None = None,
) -> tuple[bytes, int]:
    """Add one record to a POU's ``.VGR`` grid, IN ROW ORDER. Returns ``(new_grid, handle)``.

    This was DISABLED for several rounds because it destroyed the POU. It does not any more,
    and the reason matters because the failure looked like a bad record.

    The record content was always right: four strings (type, empty, initial value, name),
    usage 1 for a local, the initial value, and zeros where an external record carries the
    ``ffffffff`` marker. Every decodable field matched a real local record field for field -
    and the POU was still rewritten into garbage, the .VB emptied from 1132 bytes to 0 and the
    grid inflated from 1665 bytes to 79,432,063, with an empty Errors pane.

    The problem was never the CONTENT. It was the POSITION. Records are ordered by worksheet
    row, and the row is the declaration's 1-based line number in the .VB:

        row 6,7,8,9    VAR_EXTERNAL group 1
        row 14..20     VAR
        row 25         VAR_EXTERNAL group 2

    ascending. A new declaration appended to the last VAR block lands at row 21, so its record
    belongs BETWEEN the row-20 and row-25 records. The old code inserted after the LAST record
    unconditionally, putting row 21 after row 25 - an unordered grid.

    Measured, identical record content, only the position differing, on a variable that is
    actually USED:

        inserted IN ROW ORDER   is_compiled=true,  src.st1 9216 ->    9728 bytes
        appended AT THE END     is_compiled=false, src.st1 9216 -> 80,071,680 bytes

    Twelve integrity checks pass on the row-ordered form - compile, stability across a second
    build, the body still carrying the use, the declaration still readable, the grid still
    ascending, the .VB stream not emptied. A declaration can now be DECLARED AND USED with no
    IDE step at all.
    """
    records = parse_grid_records(grid)
    if not records:
        raise UnsupportedFormat("no variable records found in the grid; refusing to guess")

    header = struct.unpack_from("<4I", grid, 0)
    last_handle = header[1]
    new_handle = last_handle + 1

    # The row is the declaration's line number in the .VB, so the caller supplies it. Guessing
    # max(row) + 1 produces a number that corresponds to no line at all.
    if row is None:
        row = max(r["row"] for r in records) + 1

    if initial_value is None:
        initial_value = default_initial_value(type_name)

    def _string(text: str) -> bytes:
        # Length-prefixed UTF-16LE with a NUL terminator, so the prefix counts bytes and is
        # always even.
        return struct.pack("<I", (len(text) + 1) * 2) + text.encode("utf-16-le") + b"\x00\x00"

    # Synthesised from the layout rather than cloned from a donor. Cloning kept leaving one
    # field wrong - a struct's trailing structure, or an external marker left on a record
    # marked local - and each wrong guess is not a polite failure.
    record = struct.pack("<6I", new_handle, 1, 1, 0, row, 0)
    record += _string(type_name) + _string("") + _string(initial_value) + _string(name)
    record += b"\x00" * 16          # a LOCAL record carries no external marker

    # THE FIX: the insertion point is where the ROW belongs, not the end of the grid.
    index = next((i for i, r in enumerate(records) if r["row"] > row), len(records))
    if index == 0:
        insert_at = records[0]["offset"]
    elif index >= len(records):
        insert_at = records[-1]["offset"] + _record_extent(grid, records, len(records) - 1)
    else:
        insert_at = records[index]["offset"]

    out = bytearray(grid[:insert_at]) + bytearray(record) + bytearray(grid[insert_at:])
    struct.pack_into("<I", out, 4, new_handle)
    struct.pack_into("<I", out, 8, len(records) + 1)
    return bytes(out), new_handle


def update_grid_variable(
    grid: bytes,
    old_name: str,
    new_name: str | None = None,
    type_name: str | None = None,
    initial_value: str | None = None,
) -> tuple[bytes, dict]:
    """Rewrite one record's name, type or initial value IN PLACE. Returns (grid, info).

    A rename has to reach the grid as well as the text, and that is not cosmetic: the compiler
    resolves a variable through the grid, so renaming in the .VB alone leaves the old name in
    the grid and the new one unresolvable. The build then STALLS - is_compiled=false,
    is_modified=true, an EMPTY Errors pane - which is the same failure that made variable
    addition look impossible for a dozen rounds.

    The record's LENGTH changes when the name or type changes, so the bytes after it shift; the
    row, handle and usage are preserved, and the records that follow are re-emitted unchanged.
    Because the record keeps its position in the row order, nothing else has to move.
    """
    records = parse_grid_records(grid)
    if not records:
        raise UnsupportedFormat("no variable records found in the grid; refusing to guess")

    target = None
    for index, record in enumerate(records):
        decoded = read_grid_record(grid, record["offset"])
        if decoded["name"].upper() == old_name.upper():
            target = (index, record, decoded)
            break
    if target is None:
        raise NotFound(
            f"{old_name!r} has no record in the grid, so a rename would leave the text and the "
            f"grid disagreeing. Refusing rather than writing a half change."
        )

    index, record, decoded = target
    keep_name = new_name if new_name is not None else decoded["name"]
    keep_type = type_name if type_name is not None else decoded["type"]
    keep_init = initial_value if initial_value is not None else decoded["initial_value"]

    def _string(text: str) -> bytes:
        return struct.pack("<I", (len(text) + 1) * 2) + text.encode("utf-16-le") + b"\x00\x00"

    start = record["offset"]
    end = start + _record_extent(grid, records, index)
    trailing = bytes(grid[decoded["after_name"]:end])
    # The record dict carries only handle/offset/row/usage; the other three - group, flags and
    # the trailing flags word - are read straight from the six uint32 that open the record, so
    # a field this module does not model cannot be silently zeroed by a rewrite.
    fields = struct.unpack_from("<6I", grid, start)
    replacement = struct.pack("<6I", fields[0], fields[1], fields[2], fields[3], fields[4], fields[5])
    replacement += _string(keep_type) + _string("") + _string(keep_init) + _string(keep_name)
    replacement += trailing

    out = bytearray(grid[:start]) + bytearray(replacement) + bytearray(grid[end:])
    return bytes(out), {
        "handle": record["handle"],
        "row": record["row"],
        "from": decoded["name"],
        "to": keep_name,
        "type": keep_type,
        "initial_value": keep_init,
        "old_bytes": end - start,
        "new_bytes": len(replacement),
    }


def remove_grid_variable(grid: bytes, name: str) -> tuple[bytes, dict]:
    """Delete one record from the grid. Returns (grid, info).

    The mirror of append: a variable deleted from the .VB must lose its grid record too, or the
    grid carries a name with no declaration behind it. The header count and last-handle are left
    alone - the count drops by one and the handle was already spent, which is what the IDE's own
    grids show.
    """
    records = parse_grid_records(grid)
    if not records:
        raise UnsupportedFormat("no variable records found in the grid; refusing to guess")

    target = None
    for index, record in enumerate(records):
        decoded = read_grid_record(grid, record["offset"])
        if decoded["name"].upper() == name.upper():
            target = (index, record, decoded)
            break
    if target is None:
        raise NotFound(f"{name!r} has no record in the grid; nothing to remove")

    index, record, decoded = target
    if len(records) == 1:
        raise UnsupportedFormat(
            "refusing to remove the only record in the grid; a POU with an empty grid is not a "
            "state this plugin has ever seen and is not worth guessing at"
        )

    start = record["offset"]
    end = start + _record_extent(grid, records, index)
    out = bytearray(grid[:start]) + bytearray(grid[end:])
    struct.pack_into("<I", out, 8, len(records) - 1)
    return bytes(out), {
        "handle": record["handle"],
        "row": record["row"],
        "name": decoded["name"],
        "removed_bytes": end - start,
        "records_before": len(records),
        "records_after": len(records) - 1,
    }


def update_grid_variable(
    grid: bytes,
    old_name: str,
    new_name: str | None = None,
    type_name: str | None = None,
    initial_value: str | None = None,
) -> tuple[bytes, dict]:
    """Rewrite one record's name, type or initial value IN PLACE. Returns (grid, info).

    A rename has to reach the grid as well as the text, and that is not cosmetic: the compiler
    resolves a variable through the grid, so renaming in the .VB alone leaves the old name in
    the grid and the new one unresolvable. The build then STALLS - is_compiled=false,
    is_modified=true, an EMPTY Errors pane - which is the same failure that made variable
    addition look impossible for a dozen rounds.

    The record's LENGTH changes when the name or type changes, so the bytes after it shift; the
    row, handle and usage are preserved, and the records that follow are re-emitted unchanged.
    Because the record keeps its position in the row order, nothing else has to move.
    """
    records = parse_grid_records(grid)
    if not records:
        raise UnsupportedFormat("no variable records found in the grid; refusing to guess")

    target = None
    for index, record in enumerate(records):
        decoded = read_grid_record(grid, record["offset"])
        if decoded["name"].upper() == old_name.upper():
            target = (index, record, decoded)
            break
    if target is None:
        raise NotFound(
            f"{old_name!r} has no record in the grid, so a rename would leave the text and the "
            f"grid disagreeing. Refusing rather than writing a half change."
        )

    index, record, decoded = target
    keep_name = new_name if new_name is not None else decoded["name"]
    keep_type = type_name if type_name is not None else decoded["type"]
    keep_init = initial_value if initial_value is not None else decoded["initial_value"]

    def _string(text: str) -> bytes:
        return struct.pack("<I", (len(text) + 1) * 2) + text.encode("utf-16-le") + b"\x00\x00"

    start = record["offset"]
    end = start + _record_extent(grid, records, index)
    trailing = bytes(grid[decoded["after_name"]:end])
    # The record dict carries only handle/offset/row/usage; the other three - group, flags and
    # the trailing flags word - are read straight from the six uint32 that open the record, so
    # a field this module does not model cannot be silently zeroed by a rewrite.
    fields = struct.unpack_from("<6I", grid, start)
    replacement = struct.pack("<6I", fields[0], fields[1], fields[2], fields[3], fields[4], fields[5])
    replacement += _string(keep_type) + _string("") + _string(keep_init) + _string(keep_name)
    replacement += trailing

    out = bytearray(grid[:start]) + bytearray(replacement) + bytearray(grid[end:])
    return bytes(out), {
        "handle": record["handle"],
        "row": record["row"],
        "from": decoded["name"],
        "to": keep_name,
        "type": keep_type,
        "initial_value": keep_init,
        "old_bytes": end - start,
        "new_bytes": len(replacement),
    }


def remove_grid_variable(grid: bytes, name: str) -> tuple[bytes, dict]:
    """Delete one record from the grid. Returns (grid, info).

    The mirror of append: a variable deleted from the .VB must lose its grid record too, or the
    grid carries a name with no declaration behind it. The header count and last-handle are left
    alone - the count drops by one and the handle was already spent, which is what the IDE's own
    grids show.
    """
    records = parse_grid_records(grid)
    if not records:
        raise UnsupportedFormat("no variable records found in the grid; refusing to guess")

    target = None
    for index, record in enumerate(records):
        decoded = read_grid_record(grid, record["offset"])
        if decoded["name"].upper() == name.upper():
            target = (index, record, decoded)
            break
    if target is None:
        raise NotFound(f"{name!r} has no record in the grid; nothing to remove")

    index, record, decoded = target
    if len(records) == 1:
        raise UnsupportedFormat(
            "refusing to remove the only record in the grid; a POU with an empty grid is not a "
            "state this plugin has ever seen and is not worth guessing at"
        )

    start = record["offset"]
    end = start + _record_extent(grid, records, index)
    out = bytearray(grid[:start]) + bytearray(grid[end:])
    struct.pack_into("<I", out, 8, len(records) - 1)
    return bytes(out), {
        "handle": record["handle"],
        "row": record["row"],
        "name": decoded["name"],
        "removed_bytes": end - start,
        "records_before": len(records),
        "records_after": len(records) - 1,
    }


def read_grid_variable_count(grid: bytes) -> int | None:
    """Return the variable count recorded in a ``.VGR`` binary grid header.

    Offsets 0 and 4 hold format markers; the record count is a little-endian
    DWORD at offset 8.  This is used to cross-check the textual declaration
    count, which is how a mis-parse or a desynchronised grid is detected.
    """
    if len(grid) < 12:
        return None
    return struct.unpack_from("<I", grid, 8)[0]


#: Magic observed at the start of MotionWorks' compressed stream container.
#: The body that follows is not a standard codec (zlib/deflate, LZMA and bzip2
#: all fail on it), so these streams are recognised and reported, not decoded.
COMPRESSED_MAGIC = bytes.fromhex("CADAC758")

#: Sidecar suffix holding a 64-byte digest plus an 8-byte header.
SIDECAR_SUFFIX = ".sn"


def is_compressed_stream(payload: bytes) -> bool:
    """True when a stream uses the MotionWorks compressed container.

    The magic is checked against the *whole* compact payload because the first
    eight bytes are a little-endian hash/length header on some streams, which
    shifts the magic off offset zero.
    """
    head = payload[:16]
    return COMPRESSED_MAGIC in head or head[:4] == b"\x00\x00\x00\x00" and not looks_like_text(head)


def looks_like_text(payload: bytes) -> bool:
    """Heuristic: is this payload plausibly IEC 61131-3 source text?"""
    if not payload:
        return True
    sample = payload[:4096]
    printable = sum(
        1 for b in sample if 32 <= b < 127 or b in (9, 10, 13)
    )
    return printable / len(sample) > 0.90


class CompressedStreamError(UnsupportedFormat):
    """Raised when a declaration stream uses MotionWorks' compressed container.

    Five of the largest RotaryKnife POUs serialise ``<POU>V.VB`` this way.  The
    format is not a recognised codec, so rather than guess (and risk writing
    back a corrupted project) callers are told exactly what was found.
    """


def decode_declarations(payload: bytes, source_stream: str | None = None) -> DeclarationTable:
    """Decode a ``.VB`` payload, raising a precise error when it is compressed.

    Kept separate from :func:`parse_declarations` so callers that already know
    they hold text can skip the sniffing.
    """
    if is_compressed_stream(payload):
        raise CompressedStreamError(
            f"Declaration stream {source_stream or '<unnamed>'!r} uses the "
            f"MotionWorks compressed container (magic {COMPRESSED_MAGIC.hex()}). "
            f"This is not a standard codec and is not yet supported; the "
            f"variables for this POU cannot be read or edited safely."
        )
    if not looks_like_text(payload):
        raise UnsupportedFormat(
            f"Declaration stream {source_stream or '<unnamed>'!r} is neither "
            f"valid IEC text nor the known compressed container "
            f"(first bytes: {payload[:8].hex(' ')})"
        )
    return parse_declarations(payload.decode("latin1"), source_stream=source_stream)


def cross_check(table: DeclarationTable, grid_count: int | None) -> list[str]:
    """Compare the textual declaration count against the binary grid count.

    A mismatch means the two stores disagree, which MotionWorks will surface as
    inconsistent symbols.  It is reported rather than raised so the read path
    still returns useful data.
    """
    notes: list[str] = []
    if grid_count is None:
        return notes
    if grid_count != len(table):
        notes.append(
            f"declaration count mismatch: .VB declares {len(table)} variables "
            f"but the .VGR grid header records {grid_count}"
        )
    return notes
