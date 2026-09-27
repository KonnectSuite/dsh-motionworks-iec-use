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
    """Decode one record's strings and the offsets needed to rewrite them.

    Returns the type, the name, and the byte ranges of each length-prefixed string so a
    caller can rebuild the record while touching nothing it does not understand.
    """
    pos = offset + 24
    type_len = struct.unpack_from("<I", grid, pos)[0]
    type_at = pos
    type_raw = grid[pos + 4 : pos + 4 + type_len]
    pos += 4 + type_len

    # Three uint32 sit between the type and the name's length. Counted from the bytes:
    # type ends at 160, the name's length 36 is at 172, and the name itself at 176.
    # Reading +16 instead of +12 lands ON the name, so the length is taken from the
    # name's own first characters and every record decodes two bytes short.
    between_at = pos
    pos += 12
    name_len = struct.unpack_from("<I", grid, pos)[0]
    name_at = pos
    name_raw = grid[pos + 4 : pos + 4 + name_len]
    pos += 4 + name_len

    return {
        "type": type_raw.decode("utf-16-le", "replace").rstrip("\x00"),
        "name": name_raw.decode("utf-16-le", "replace").rstrip("\x00"),
        "type_at": type_at,
        "between_at": between_at,
        "name_at": name_at,
        "after_name": pos,
    }


def _record_extent(grid: bytes, records: list[dict], index: int) -> int:
    """Byte length of the record at ``index``, bounded by the next record."""
    start = records[index]["offset"]
    if index + 1 < len(records):
        return records[index + 1]["offset"] - start
    return len(grid) - start


def append_grid_variable(grid: bytes, name: str, type_name: str) -> tuple[bytes, int]:
    """Append one LOCAL variable record to a POU's ``.VGR`` grid.

    Why this is needed: a POU's declarations live in TWO stores - the ``.VB`` text and
    this binary grid - and the compiler resolves variables from the GRID. Adding only the
    text leaves the grid a record short and the compiler reports

        Variable '<POU>:<name>' not found!

    even though the declaration reads back fine. Variable adds appeared to work earlier
    only because those builds were incremental and never recompiled the variable unit.

    The new record is CLONED from an existing local record of the SAME TYPE, so every
    field whose meaning is not understood is copied rather than invented; only the
    handle, the worksheet row, the type text and the name are patched, and the header's
    record count and last-handle are bumped.  Returns ``(new_grid, handle)``.
    """
    records = parse_grid_records(grid)
    if not records:
        raise PouPlanError("no variable records found in the grid; refusing to guess")

    wanted = (type_name or "").upper()

    def decoded(index: int) -> dict:
        return read_grid_record(grid, records[index]["offset"])

    def clean(info: dict) -> bool:
        """A record whose type and name decode to plain text.

        A record carrying an INITIAL VALUE has a different shape: three strings rather
        than two (type, initial value, name). Decoding one as if it had two reads the
        initial value as the name and then runs off into the following records, which is
        why cloning such a record produced a name like 'SE\\x00...'. Requiring plain text
        excludes them, and the remaining records are the shape a fresh declaration needs.
        """
        for key in ("type", "name"):
            text = info.get(key) or ""
            if not text or "\\x00" in text:
                return False
            if any(ord(ch) < 32 or ord(ch) > 126 for ch in text):
                return False
        return True

    # Choose the donor by SHAPE, not by usage or type:
    #
    #   * usage is rewritten to 1 regardless, so restricting to local records only threw
    #     away the clean ones. In the grid this was measured on, the plain BOOL records
    #     are marked external - and requiring usage == 1 left only the init-value BOOLs,
    #     whose three-string shape decodes wrongly.
    #   * the type is rewritten too, so a different type is fine.
    #   * the SMALLEST matching record wins, because a big trailing run means structure
    #     (a struct's sub-fields), and cloning that for a scalar drags it along. The
    #     CamSegmentStruct record is 180 bytes against a BOOL's 106 for exactly that
    #     reason.
    candidates: list[tuple[int, int, dict]] = []
    for index in range(len(records)):
        try:
            info = decoded(index)
        except Exception:                                   # noqa: BLE001
            continue
        if not clean(info):
            continue
        candidates.append((index, _record_extent(grid, records, index), info))
    if not candidates:
        raise PouPlanError(
            "no variable record with a plain type/name pair to clone in the grid"
        )

    same_type = [c for c in candidates if c[2]["type"].upper() == wanted]
    pool = same_type or candidates
    donor = min(pool, key=lambda c: c[1])[0]

    info = decoded(donor)
    start = records[donor]["offset"]
    extent = _record_extent(grid, records, donor)
    chunk = bytearray(grid[start : start + extent])

    new_handle = max(r["handle"] for r in records) + 1
    new_row = max(r["row"] for r in records) + 1
    struct.pack_into("<I", chunk, 0, new_handle)                    # handle
    struct.pack_into("<I", chunk, 4, 1)                             # usage: local
    struct.pack_into("<I", chunk, 16, new_row)                      # worksheet row

    def encoded(text: str) -> bytes:
        raw = text.encode("utf-16-le") + b"\x00\x00"
        return struct.pack("<I", len(raw)) + raw

    # Rebuild relative to the record start, keeping the four uint32 and the trailing run
    # exactly as the donor had them.
    rel_type = info["type_at"] - start
    rel_name = info["name_at"] - start
    rebuilt = (
        bytes(chunk[:rel_type])
        + encoded(type_name)
        + bytes(chunk[info["between_at"] - start : rel_name])
        + encoded(name)
        + bytes(chunk[info["after_name"] - start :])
    )

    # The donor supplies the SHAPE; it does not decide where the record goes. Appending
    # at the donor's end splices into the middle of the grid whenever the donor is not
    # the last record, displacing everything after it - which is why choosing a small
    # donor made the result worse rather than better. A new record always goes after the
    # LAST record, just before the grid's trailer.
    last = records[-1]
    insert_at = last["offset"] + _record_extent(grid, records, len(records) - 1)
    out = bytearray(grid[:insert_at]) + rebuilt + bytearray(grid[insert_at:])
    struct.pack_into("<I", out, 4, new_handle)
    struct.pack_into("<I", out, 8, struct.unpack_from("<I", grid, 8)[0] + 1)
    return bytes(out), new_handle

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
