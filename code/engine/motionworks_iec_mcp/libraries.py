"""Read the library side of a MotionWorks project: which function blocks it uses, and what
those blocks offer.

Two sources, and they answer different questions.

**`eCLRPouDependencies.dat` is the map.** It is plain text at the top of the resource
directory and names every POU and library block in the project with its kind and what it
depends on::

    PouDep.Cache;schema 1
    0,CalcBezier,3,FB
    1,CalcSplineMatrix,3,FB
    2,CalcSpline,3,FB; 1,CalcSplineMatrix
    4,CamGenerator,3,FB; 2,CalcSpline; 0,CalcBezier; 3,MasterIndex_Lookup
    5,TopCutterCamSetup,2,PG; 4,CamGenerator

so ``2,PG`` is a program and ``3,FB`` a function block, and the trailing entries are the
blocks it calls. That is enough to answer "what does this POU use" without reading any
binary.

**The block's own members come from its compiled assembly.** A library block in this project
is compiled to ``<name>.DLL`` beside the resource, and it is a real .NET assembly - the
signature is ``BSJB``, runtime ``v4.0.30319`` - so its identifiers sit in the metadata
``#Strings`` heap as plain UTF-8. Measured on CamGenerator.DLL, that heap begins with the
names that matter::

    CamGenerator, ProConOS_eCLR, Iec61131Standard, MasterIndex_Lookup, CalcSpline,
    CalcBezier, FUNCTION_BLOCK, CamSegmentStruct, Y_MS_CAM_STRUCT, ...
    Execute, TableSize, Done, Busy, Error, ErrorID, iActive, CamData, CamTable

WHAT THIS CANNOT TELL YOU, and it matters: **the heap does not record input/output
direction.** ``Execute`` and ``Done`` are distinguishable by convention, not by evidence
here, and this module does not guess. It reports the names the assembly defines and says
plainly that direction is not among them. The block's own declarations/native parameter
table (``mw_code_block_interface``) establish direction; caller instance declarations
do not establish a block's pin directions.

The heap also carries compiler temporaries - ``__temp_1`` through ``__temp_50``, ``s1``
through ``s7`` - which are noise here, so they are filtered out rather than reported as if
they were part of the block's interface.
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field
from pathlib import Path

from .errors import NotFound

DEPENDENCY_FILE = "C/Configuration/R/Resource/eCLRPouDependencies.dat"
RESOURCE_DIR = "C/Configuration/R/Resource"

KINDS = {"1": "FUNCTION", "2": "PROGRAM", "3": "FUNCTION_BLOCK", "4": "FUNCTION_BLOCK"}

# Names the compiler generates rather than the author writing: temporaries, scratch
# registers and one/two-letter locals. Reporting these as part of a block's interface would
# be worse than reporting nothing.
_NOISE = re.compile(
    r"^(__temp_\d+|__\w+|_\w+|[a-z]\d*|[A-Z]\d*|[a-z]{2}\d*|k\d+|sPtr|amm|amp|C0|d|p)$"
)


@dataclass
class Block:
    """One POU or library block named in the dependency manifest."""

    index: int
    name: str
    kind: str
    depends_on: list[str] = field(default_factory=list)

    @property
    def is_library(self) -> bool:
        return self.kind == "FUNCTION_BLOCK" or self.kind == "FUNCTION"


@dataclass
class BlockMembers:
    """The identifiers an assembly defines, in heap order."""

    name: str
    assembly: str
    runtime: str
    identifiers: list[str] = field(default_factory=list)
    filtered_out: int = 0


def _resource_dir(project_root: Path) -> Path:
    candidate = Path(project_root) / RESOURCE_DIR
    if not candidate.is_dir():
        raise NotFound(f"no {RESOURCE_DIR} in {project_root}")
    return candidate


def read_dependencies(project_root: Path) -> list[Block]:
    """Parse ``eCLRPouDependencies.dat`` into blocks, in file order."""
    path = Path(project_root) / DEPENDENCY_FILE
    if not path.is_file():
        raise NotFound(
            f"no {DEPENDENCY_FILE} in {project_root}; the project has not been built, so it "
            f"has no dependency manifest yet"
        )
    blocks: list[Block] = []
    by_index: dict[int, Block] = {}
    for raw in path.read_text(encoding="latin1", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("PouDep"):
            continue
        parts = [p.strip() for p in line.split(";")]
        head = parts[0].split(",")
        if len(head) < 4:
            continue
        try:
            index = int(head[0])
        except ValueError:
            continue
        name, code = head[1], head[2]
        block = Block(index=index, name=name, kind=KINDS.get(code, f"KIND_{code}"))
        blocks.append(block)
        by_index[index] = block

    # second pass: the trailing entries are indices, resolved once every block is known
    for raw in path.read_text(encoding="latin1", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("PouDep"):
            continue
        parts = [p.strip() for p in line.split(";")]
        head = parts[0].split(",")
        if len(head) < 4:
            continue
        try:
            index = int(head[0])
        except ValueError:
            continue
        block = by_index.get(index)
        if block is None:
            continue
        for dep in parts[1:]:
            if not dep:
                continue
            dep_index = dep.split(",")[0].strip()
            try:
                target = by_index.get(int(dep_index))
            except ValueError:
                target = None
            block.depends_on.append(target.name if target else dep)
    return blocks


# ── .NET metadata ────────────────────────────────────────────────────────────────

def _metadata_streams(data: bytes):
    """Locate the .NET metadata streams, or None if this is not a managed assembly."""
    at = data.find(b"BSJB")
    if at < 0:
        return None
    off = at + 4
    try:
        _major, _minor, _reserved, version_len = struct.unpack_from("<HHII", data, off)
    except struct.error:
        return None
    off += 12
    version = data[off:off + version_len].split(b"\x00")[0].decode("ascii", "replace")
    off += version_len + 2
    try:
        count = struct.unpack_from("<H", data, off)[0]
    except struct.error:
        return None
    off += 2
    heaps: dict[str, tuple[int, int]] = {}
    for _ in range(count):
        try:
            stream_off, stream_size = struct.unpack_from("<II", data, off)
        except struct.error:
            return None
        off += 8
        end = data.find(b"\x00", off)
        if end < 0:
            return None
        name = data[off:end].decode("ascii", "replace")
        off = (end + 1 + 3) & ~3
        heaps[name] = (at + stream_off, stream_size)
    return version, heaps


def _strings(data: bytes, base: int, size: int) -> list[str]:
    raw = data[base:base + size]
    out: list[str] = []
    current = bytearray()
    for byte in raw:
        if byte == 0:
            if current:
                out.append(current.decode("utf-8", "replace"))
            current = bytearray()
        else:
            current.append(byte)
    if current:
        out.append(current.decode("utf-8", "replace"))
    return out


def read_block_members(project_root: Path, name: str) -> BlockMembers:
    """Identifiers defined by a block's compiled assembly.

    Direction is NOT among them - see the module docstring - so this reports names and says
    so rather than presenting a guess as an interface.
    """
    directory = _resource_dir(project_root)
    for candidate in (directory / f"{name}.DLL", directory / f"{name}.dll"):
        if candidate.is_file():
            assembly = candidate
            break
    else:
        blocks = {b.name.lower(): b for b in read_dependencies(project_root)}
        known = ", ".join(sorted(b.name for b in blocks.values())[:25])
        raise NotFound(
            f"no compiled assembly for {name!r} in {RESOURCE_DIR}. Blocks with an assembly "
            f"here: {known}. A block with no assembly may be defined in the project's own "
            f"source rather than a library - list those with mw_code_pous."
        )

    data = assembly.read_bytes()
    streams = _metadata_streams(data)
    if not streams:
        raise NotFound(
            f"{assembly.name} is not a managed assembly, so it has no readable identifier "
            f"table. It may be legacy native code."
        )
    version, heaps = streams
    if "#Strings" not in heaps:
        raise NotFound(f"{assembly.name} has .NET metadata but no #Strings heap")

    base, size = heaps["#Strings"]
    everything = _strings(data, base, size)
    seen: set[str] = set()
    kept: list[str] = []
    dropped = 0
    for item in everything:
        if not item or item in seen:
            continue
        seen.add(item)
        if _NOISE.match(item):
            dropped += 1
            continue
        kept.append(item)
    return BlockMembers(
        name=name, assembly=assembly.name, runtime=version,
        identifiers=kept, filtered_out=dropped,
    )
