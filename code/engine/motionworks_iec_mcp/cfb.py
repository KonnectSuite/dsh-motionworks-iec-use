"""OLE/CFB (Compound File Binary) reader and writer for MotionWorks IEC sources.

MotionWorks IEC 3 Pro stores the project tree and every POU source as
``src.st1`` files: OLE2/CFB version-3 containers with 512-byte sectors and
64-byte mini sectors.  Inside a POU source the four streams are::

    <POU>T.TXT   worksheet comments
    <POU>V.VGR   binary variable-grid records
    <POU>V.VB    textual IEC 61131-3 variable declarations
    <POU>.STB    Structured Text body      (or)
    <POU>.GB     graphical LD/FBD body

This module has no MotionWorks-specific knowledge; it only understands CFB.

Design notes
------------
* The proven implementation this was derived from read exactly one FAT sector
  (128 entries, 64 KiB of file).  That is enough for the MotionWorks POU and
  project sources seen so far, but the root ``src.st1`` of a large project is
  already 13-35 KiB and the resource source is larger, so silently truncating
  the FAT is a latent corruption bug.  :meth:`CompoundFile._read_fat` now walks
  the DIFAT and reads *all* FAT sectors, and the file header is validated.
* Writing is done by :meth:`replace_streams`, which handles mini streams,
  normal streams, and migration across the 4096-byte mini-stream cutoff.  It
  compacts all mini streams together, because the mini-FAT and the root mini
  stream must always agree.
* Every write goes to a temporary file in the destination directory and is then
  atomically replaced, so an interrupted write cannot leave a half-written
  project file behind.
"""

from __future__ import annotations

import os
import struct
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")

FREESECT = 0xFFFFFFFF
ENDOFCHAIN = 0xFFFFFFFE
FATSECT = 0xFFFFFFFD
DIFSECT = 0xFFFFFFFC

# Directory entry object types
OBJ_STORAGE = 1
OBJ_STREAM = 2
OBJ_ROOT = 5

MAXREGSECT = 0xFFFFFFFA


class CfbError(ValueError):
    """Raised when a file is not a supported CFB container."""


def _replace_with_retry(temporary: Path, destination: Path) -> None:
    """Atomically replace ``destination``, retrying a transient lock.

    ``os.replace`` normally succeeds outright, but on Windows it can fail with
    ``PermissionError`` when something else briefly holds the target -- an
    antivirus scanner or a file-sync client noticing the freshly written file.  A
    stress run of 387 writes hit this 54 times, so a single attempt is not enough
    for a file the IDE will later open.

    Retries are short and bounded: a genuine permission problem (a read-only
    attribute, or a lock held by a running application) must still surface rather
    than hang.
    """
    last_error: OSError | None = None
    for attempt in range(10):
        try:
            os.replace(temporary, destination)
            return
        except PermissionError as exc:  # transient lock
            last_error = exc
            time.sleep(0.02 * (attempt + 1))
    # Do not leave the temporary file behind when giving up.
    try:
        temporary.unlink(missing_ok=True)
    except OSError:
        pass
    raise CfbError(
        f"could not replace {destination.name} after 10 attempts; another program "
        f"may be holding the file: {last_error}"
    )


@dataclass
class DirectoryEntry:
    index: int
    name: str
    object_type: int
    start_sector: int
    size: int
    left: int = FREESECT
    right: int = FREESECT
    child: int = FREESECT


class CompoundFile:
    """Read and rewrite the version-3 CFB files used by MotionWorks IEC."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        try:
            self.data = self.path.read_bytes()
        except OSError as exc:
            raise CfbError(f"Cannot read {self.path}: {exc}") from exc
        if len(self.data) < 512 or self.data[:8] != MAGIC:
            raise CfbError(f"Not a CFB (OLE2) file: {self.path}")

        (self.minor_version, self.major_version, self.byte_order,
         sector_shift, mini_sector_shift) = struct.unpack_from("<HHHHH", self.data, 24)
        if self.byte_order != 0xFFFE:
            raise CfbError("Big-endian CFB files are not supported")
        if self.major_version != 3:
            raise CfbError(
                f"Unsupported CFB major version {self.major_version} "
                f"(expected 3) in {self.path}"
            )
        self.sector_size = 1 << sector_shift
        self.mini_sector_size = 1 << mini_sector_shift
        if self.sector_size != 512 or self.mini_sector_size != 64:
            raise CfbError(
                f"Unsupported CFB sector sizes "
                f"{self.sector_size}/{self.mini_sector_size} in {self.path}"
            )

        self.mini_cutoff = struct.unpack_from("<I", self.data, 56)[0]
        self.fat = self._read_fat()
        self._validate_fat_coverage()
        self.entries = self._read_directory()
        self.root = next(
            (e for e in self.entries if e.object_type == OBJ_ROOT), None
        )
        if self.root is None:
            raise CfbError(f"No root directory entry in {self.path}")
        self.root_stream = self._read_normal_chain(self.root.start_sector, self.root.size)
        self.minifat = self._read_minifat()
        self._validate_stream_chains()

    def _physical_sector_count(self) -> int:
        size = len(self.data)
        if size % self.sector_size:
            raise CfbError(
                f"File size {size} is not a multiple of the sector size "
                f"{self.sector_size}"
            )
        return size // self.sector_size - 1

    def _validate_fat_coverage(self) -> None:
        """Fail loudly if the FAT cannot address the whole file.

        A truncated FAT is the single most dangerous failure mode for this
        format: chains past the end of the table either raise (best case) or,
        if the missing entries are silently treated as free, truncate a stream
        to a shorter length and let us write back a corrupted project.
        """
        physical = self._physical_sector_count()
        if len(self.fat) < physical:
            raise CfbError(
                f"FAT covers {len(self.fat)} sectors but the file has {physical}; "
                f"refusing to parse a truncated FAT in {self.path}"
            )

    def _validate_stream_chains(self) -> None:
        """Walk every stream chain up front so corruption is caught on open.

        :meth:`read_stream` already raises on a broken chain, but only for the
        streams a caller happens to touch.  Verifying all of them here means a
        damaged file is rejected before any write path can act on it.
        """
        for e in self.entries:
            if e.object_type != OBJ_STREAM or e.size == 0:
                continue
            if e.size >= self.mini_cutoff:
                if e.start_sector >= MAXREGSECT:
                    raise CfbError(f"Stream {e.name!r} has no sector but size {e.size}")
                self._chain(e.start_sector, self.fat, f"FAT chain of {e.name!r}")
            else:
                if e.start_sector >= MAXREGSECT:
                    raise CfbError(f"Stream {e.name!r} has no mini sector but size {e.size}")
                chain = self._chain(
                    e.start_sector, self.minifat, f"mini-FAT chain of {e.name!r}"
                )
                needed = (e.size + self.mini_sector_size - 1) // self.mini_sector_size
                if len(chain) < needed:
                    raise CfbError(
                        f"Stream {e.name!r} needs {needed} mini sectors for "
                        f"{e.size} bytes but its chain has {len(chain)}"
                    )

    # ------------------------------------------------------------------ read

    def _sector_offset(self, sector: int) -> int:
        return (sector + 1) * self.sector_size

    def _fat_sector_indices(self) -> list[int]:
        """The sectors holding FAT data, read from the DIFAT.

        ``_read_fat`` keeps this list local.  Kept separate so a caller that needs
        to know which sectors hold FAT data -- anything reasoning about free space
        -- can ask without re-parsing the DIFAT itself.
        """
        indices: list[int] = []
        for i in range(109):
            value = struct.unpack_from("<I", self.data, 76 + i * 4)[0]
            if value < MAXREGSECT:
                indices.append(value)

        next_difat = struct.unpack_from("<I", self.data, 68)[0]
        difat_count = struct.unpack_from("<I", self.data, 72)[0]
        per_sector = self.sector_size // 4 - 1
        seen: set[int] = set()
        while next_difat < MAXREGSECT and difat_count:
            if next_difat in seen:
                break
            seen.add(next_difat)
            base = self._sector_offset(next_difat)
            if base + self.sector_size > len(self.data):
                break
            for i in range(per_sector):
                value = struct.unpack_from("<I", self.data, base + i * 4)[0]
                if value < MAXREGSECT:
                    indices.append(value)
            next_difat = struct.unpack_from(
                "<I", self.data, base + per_sector * 4
            )[0]
            difat_count -= 1
        return indices

    def _read_fat(self) -> list[int]:
        """Read every FAT sector listed in the header DIFAT.

        The header holds 109 DIFAT entries inline; any further DIFAT sectors are
        chained off the header.  Reading only the first FAT sector caps the
        addressable file at 128 sectors (~64 KiB), which is not enough for the
        larger MotionWorks POU sources.

        ``fat_sectors`` and the returned FAT table are deliberately separate
        lists: the DIFAT slots live at file offsets 76..511 and must never be
        mistaken for FAT entries, because FAT sector indices are what
        :meth:`_chain` dereferences.
        """
        fat_sectors: list[int] = []
        for i in range(109):
            value = struct.unpack_from("<I", self.data, 76 + i * 4)[0]
            if value < MAXREGSECT:
                fat_sectors.append(value)

        # Follow any additional DIFAT sectors to collect the remaining FAT
        # sector numbers.
        next_difat = struct.unpack_from("<I", self.data, 68)[0]
        difat_count = struct.unpack_from("<I", self.data, 72)[0]
        per_sector = self.sector_size // 4 - 1
        seen: set[int] = set()
        while next_difat < MAXREGSECT and difat_count:
            if next_difat in seen:
                raise CfbError("Cyclic DIFAT chain")
            seen.add(next_difat)
            base = self._sector_offset(next_difat)
            if base + self.sector_size > len(self.data):
                raise CfbError("DIFAT sector beyond end of file")
            for i in range(per_sector):
                value = struct.unpack_from("<I", self.data, base + i * 4)[0]
                if value < MAXREGSECT:
                    fat_sectors.append(value)
            next_difat = struct.unpack_from(
                "<I", self.data, base + per_sector * 4
            )[0]
            difat_count -= 1

        if not fat_sectors:
            raise CfbError("No FAT sector referenced by the header")

        fat: list[int] = []
        count = self.sector_size // 4
        for sector in fat_sectors:
            offset = self._sector_offset(sector)
            if offset + self.sector_size > len(self.data):
                raise CfbError("FAT sector beyond end of file")
            fat.extend(struct.unpack_from(f"<{count}I", self.data, offset))
        return fat

    def _chain(self, start: int, table: list[int], what: str = "chain") -> list[int]:
        result: list[int] = []
        current = start
        seen: set[int] = set()
        while current < MAXREGSECT:
            if current in seen:
                raise CfbError(f"Cyclic CFB {what}")
            if current >= len(table):
                raise CfbError(
                    f"CFB {what} references sector {current} beyond the FAT "
                    f"({len(table)} entries)"
                )
            seen.add(current)
            result.append(current)
            current = table[current]
        return result

    def _read_normal_chain(self, start: int, size: int) -> bytes:
        if size == 0 or start >= MAXREGSECT:
            return b""
        output = bytearray()
        for sector in self._chain(start, self.fat, "FAT chain"):
            offset = self._sector_offset(sector)
            output.extend(self.data[offset : offset + self.sector_size])
        return bytes(output[:size])

    def _read_directory(self) -> list[DirectoryEntry]:
        first_directory = struct.unpack_from("<I", self.data, 48)[0]
        raw = self._read_normal_chain(first_directory, 1 << 30)
        entries: list[DirectoryEntry] = []
        for index in range(len(raw) // 128):
            offset = index * 128
            name_length = struct.unpack_from("<H", raw, offset + 64)[0]
            object_type = raw[offset + 66]
            if name_length < 2 or object_type == 0:
                continue
            name = raw[offset : offset + name_length - 2].decode("utf-16le")
            entries.append(
                DirectoryEntry(
                    index=index,
                    name=name,
                    object_type=object_type,
                    start_sector=struct.unpack_from("<I", raw, offset + 116)[0],
                    size=struct.unpack_from("<Q", raw, offset + 120)[0],
                    left=struct.unpack_from("<I", raw, offset + 68)[0],
                    right=struct.unpack_from("<I", raw, offset + 72)[0],
                    child=struct.unpack_from("<I", raw, offset + 76)[0],
                )
            )
        return entries

    def _read_minifat(self) -> list[int]:
        first = struct.unpack_from("<I", self.data, 60)[0]
        count = struct.unpack_from("<I", self.data, 64)[0]
        if not count or first >= MAXREGSECT:
            return []
        raw = self._read_normal_chain(first, count * self.sector_size)
        return list(struct.unpack(f"<{len(raw) // 4}I", raw))

    def stream_names(self) -> list[str]:
        return [e.name for e in self.entries if e.object_type == OBJ_STREAM]

    def entry(self, name: str) -> DirectoryEntry:
        for e in self.entries:
            if e.object_type == OBJ_STREAM and e.name == name:
                return e
        raise KeyError(name)

    def read_stream(self, name: str) -> bytes:
        e = self.entry(name)
        if e.size == 0 or e.start_sector >= MAXREGSECT:
            return b""
        if e.size >= self.mini_cutoff:
            return self._read_normal_chain(e.start_sector, e.size)
        output = bytearray()
        for mini_sector in self._chain(e.start_sector, self.minifat, "mini-FAT chain"):
            offset = mini_sector * self.mini_sector_size
            output.extend(self.root_stream[offset : offset + self.mini_sector_size])
        return bytes(output[: e.size])

    def streams(self) -> dict[str, bytes]:
        return {name: self.read_stream(name) for name in self.stream_names()}

    def summary(self) -> dict[str, int]:
        return {name: e.size for name, e in
                ((x.name, x) for x in self.entries if x.object_type == OBJ_STREAM)}

    # ----------------------------------------------------------------- write

    def _directory_locations(self, table: list[int]) -> list[int]:
        """Absolute byte offsets, per directory entry index, of each 128-byte slot.

        The directory may span several sectors, so this cannot assume the
        entries are contiguous in the file.
        """
        directory_start = struct.unpack_from("<I", self.data, 48)[0]
        chain = self._chain(directory_start, table, "directory chain")
        locations: list[int] = []
        for sector in chain:
            base = self._sector_offset(sector)
            for slot in range(self.sector_size // 128):
                locations.append(base + slot * 128)
        return locations

    def replace_streams(
        self, replacements: dict[str, bytes], destination: str | Path | None = None
    ) -> Path:
        """Replace named streams, creating none and deleting none.

        Supports payloads growing or shrinking across the 4096-byte mini-stream
        cutoff.  Unreplaced normal streams keep their existing allocation.
        Sectors released by a replaced stream are reused by that same stream
        first, and any remaining need is satisfied by appending to the file and
        growing the FAT if it has no spare entries.  All mini streams are
        re-packed together.

        FAT growth matters in practice: MotionWorks sizes the FAT so that it
        covers exactly the file's sectors, leaving no free entries, so a stream
        that grows by even one sector cannot be written without it.
        """
        destination = Path(destination) if destination else self.path
        stream_entries = {e.name: e for e in self.entries if e.object_type == OBJ_STREAM}
        unknown = set(replacements) - set(stream_entries)
        if unknown:
            raise KeyError(f"Unknown streams: {sorted(unknown)}")

        payloads: dict[str, bytes] = {}
        for name, e in stream_entries.items():
            payloads[name] = replacements.get(name, self.read_stream(name))

        updated = bytearray(self.data)
        working_fat = list(self.fat)
        # Header bookkeeping that FAT growth must maintain.
        header_num_fat = struct.unpack_from("<I", self.data, 44)[0]
        header_num_difat = struct.unpack_from("<I", self.data, 72)[0]

        def write_working_fat() -> None:
            """Serialise ``working_fat`` across all allocated FAT sectors."""
            blob = struct.pack(f"<{len(working_fat)}I", *working_fat)
            written = 0
            for sector in fat_sector_list:
                offset = self._sector_offset(sector)
                chunk = blob[written : written + self.sector_size]
                updated[offset : offset + self.sector_size] = chunk.ljust(
                    self.sector_size, b"\x00"
                )
                written += self.sector_size

        fat_sector_list = [
            struct.unpack_from("<I", self.data, 76 + i * 4)[0]
            for i in range(109)
        ]
        fat_sector_list = [s for s in fat_sector_list if s < MAXREGSECT]
        if not fat_sector_list:
            raise CfbError("No FAT sector in header")

        def fat_capacity() -> int:
            return len(fat_sector_list) * (self.sector_size // 4)

        def ensure_fat_capacity(needed: int) -> None:
            """Make sure the FAT can address, and has entries for, ``needed`` sectors.

            Two different things have to be true, and conflating them caused a real
            bug: the FAT must be *addressable* (enough FAT sectors, measured by
            ``fat_capacity``) **and** the working table must actually have an entry
            per sector.  MotionWorks writes a FAT that can address far more sectors
            than the file contains -- 128 entries for 28 sectors -- so the capacity
            check passes while the list is short, and a caller assigning to a
            high-numbered sector then raises IndexError.  Growing the list here
            makes every call site correct instead of relying on each to remember.
            """
            nonlocal working_fat, header_num_fat, header_num_difat
            while fat_capacity() < needed:
                # Append a new FAT sector.  The FAT must already be able to
                # address that sector's own index, so grow the table if needed.
                next_sector = (len(updated) - self.sector_size) // self.sector_size
                while len(working_fat) <= next_sector:
                    working_fat.append(FREESECT)
                updated.extend(b"\x00" * self.sector_size)
                working_fat[next_sector] = FATSECT
                fat_sector_list.append(next_sector)
                header_num_fat = len(fat_sector_list)
                struct.pack_into("<I", updated, 44, header_num_fat)
                # Record the new FAT sector in a free inline DIFAT slot, or in a
                # chained DIFAT sector once the 109 inline slots are used up.
                slot = None
                for i in range(109):
                    value = struct.unpack_from("<I", updated, 76 + i * 4)[0]
                    if value == FREESECT:
                        slot = i
                        break
                if slot is not None:
                    struct.pack_into("<I", updated, 76 + slot * 4, next_sector)
                else:
                    raise CfbError(
                        "CFB exceeds the 109 FAT sectors addressable without a "
                        "chained DIFAT, which is not supported"
                    )
            # Cover every sector the caller is about to allocate, regardless of
            # whether any FAT sector had to be added.
            while len(working_fat) < needed:
                working_fat.append(FREESECT)
            write_working_fat()

        # Sectors the container itself owns and a stream write must never touch.
        #
        # The MiniFAT is reached through the *header* (offsets 60 and 64), not a
        # directory entry, so nothing in the normal allocation path notices it.  On
        # a real POU the MiniFAT chain is [2, 20] while another stream's chain also
        # contains sector 20, and replacing that stream wrote its payload over the
        # MiniFAT -- then the MiniFAT was written back over the stream, so the
        # stream read back with mini-FAT entries in the middle of its content.
        # Reproduced deterministically; the stream must simply not allocate these.
        protected: set[int] = set(self._fat_sector_indices())
        protected.update(self._chain(self.root.start_sector, self.fat, "root mini stream"))
        minifat_start = struct.unpack_from("<I", self.data, 60)[0]
        minifat_count = struct.unpack_from("<I", self.data, 64)[0]
        if minifat_count and minifat_start < MAXREGSECT:
            protected.update(
                self._chain(minifat_start, self.fat, "mini-FAT chain")[:minifat_count]
            )

        def append_normal(payload: bytes, reuse: list[int]) -> tuple[int, int]:
            """Write a normal stream, reusing released sectors where possible."""
            count = (len(payload) + self.sector_size - 1) // self.sector_size
            if not count:
                return ENDOFCHAIN, 0
            # Never take a sector the container owns, even if the reuse pool offers
            # it or it looks free.
            sectors = [s for s in reuse if s not in protected][:count]
            remaining = count - len(sectors)
            if remaining:
                # Walk forward taking only sectors that are genuinely free and not
                # owned by the container, instead of assuming a contiguous run of
                # `remaining` sectors is available.  `ENDOFCHAIN` is deliberately not
                # treated as free: it marks the end of an allocated chain.
                #
                # Growth is done once, up front, rather than inside the scan:
                # `ensure_fat_capacity` writes FAT sectors into `updated` and extends
                # it, and interleaving that with the scan made the buffer's length
                # change while sector indices were being computed from it -- the
                # payload then missed the sectors it was supposed to occupy.
                extra: list[int] = []
                cursor = (len(updated) - self.sector_size) // self.sector_size
                # A generous scan bound, but the file is only extended to cover the
                # sectors actually taken below -- extending to the scan bound would
                # leave the container several sectors larger than it needs to be.
                scan_end = len(updated) // self.sector_size + remaining + 8
                ensure_fat_capacity(scan_end)
                if len(updated) < scan_end * self.sector_size:
                    updated.extend(
                        b"\x00" * (scan_end * self.sector_size - len(updated))
                    )
                while len(extra) < remaining and cursor < scan_end:
                    if cursor not in protected and working_fat[cursor] == FREESECT:
                        extra.append(cursor)
                    cursor += 1
                if len(extra) < remaining:
                    raise CfbError(
                        f"could not find {remaining} free sector(s) for a stream"
                    )
                # Trim the buffer back to the last sector actually used.
                needed_end = (extra[-1] + 1) * self.sector_size
                if len(updated) > needed_end:
                    del updated[needed_end:]
                sectors.extend(extra)
            for index, sector in enumerate(sectors):
                working_fat[sector] = (
                    sectors[index + 1] if index + 1 < count else ENDOFCHAIN
                )
                start = index * self.sector_size
                offset = self._sector_offset(sector)
                updated[offset : offset + self.sector_size] = payload[
                    start : start + self.sector_size
                ].ljust(self.sector_size, b"\x00")
            return sectors[0], len(payload)

        def zero_sectors(sectors: list[int]) -> None:
            """Clear whole sectors so a shrunken stream leaves no stale bytes."""
            for sector in sectors:
                offset = self._sector_offset(sector)
                updated[offset : offset + self.sector_size] = b"\x00" * self.sector_size

        # Release replaced streams that previously occupied normal sectors, and
        # remember those sectors so the replacement can reuse them.
        reuse_pool: dict[str, list[int]] = {}
        for name in replacements:
            e = stream_entries[name]
            if e.size >= self.mini_cutoff and e.size:
                released = self._chain(e.start_sector, self.fat)
                # A sector can belong to two chains at once.  On a real POU the
                # MiniFAT chain is [2, 20] and the body stream's chain also contains
                # sector 20; freeing it marked the MiniFAT's own sector free, and the
                # replacement then wrote payload over it, so the stream read back with
                # mini-FAT entries in the middle of its content.  Protected sectors
                # keep their original FAT value and are never offered for reuse.
                usable: list[int] = []
                for sector in released:
                    if sector in protected:
                        working_fat[sector] = self.fat[sector]
                        continue
                    working_fat[sector] = FREESECT
                    usable.append(sector)
                reuse_pool[name] = usable
                # Only sectors that go unused need clearing; the ones we reuse
                # are overwritten below.
                needed = (len(payloads[name]) + self.sector_size - 1) // self.sector_size
                if len(usable) > needed:
                    zero_sectors(usable[needed:])

        mini_streams = [
            (stream_entries[name], payload)
            for name, payload in payloads.items()
            if 0 < len(payload) < self.mini_cutoff
        ]
        required = sum(
            (len(payload) + self.mini_sector_size - 1) // self.mini_sector_size
            for _, payload in mini_streams
        )

        root_chain = self._chain(self.root.start_sector, working_fat, "root mini stream")
        root_capacity = len(root_chain) * self.sector_size
        required_bytes = required * self.mini_sector_size
        if required_bytes > root_capacity:
            extra_count = (
                required_bytes - root_capacity + self.sector_size - 1
            ) // self.sector_size
            physical = (len(updated) - self.sector_size) // self.sector_size
            sectors = list(range(physical, physical + extra_count))
            ensure_fat_capacity(sectors[-1] + 1)
            updated.extend(b"\x00" * (extra_count * self.sector_size))
            working_fat[root_chain[-1]] = sectors[0]
            for index, sector in enumerate(sectors):
                working_fat[sector] = (
                    sectors[index + 1] if index + 1 < extra_count else ENDOFCHAIN
                )
            root_chain.extend(sectors)
            root_capacity = len(root_chain) * self.sector_size

        available = root_capacity // self.mini_sector_size
        if required > available:
            raise CfbError("Mini stream capacity exceeded")
        if required > len(self.minifat):
            raise CfbError(
                f"Mini-FAT has {len(self.minifat)} entries but {required} are needed"
            )

        packed_root = bytearray(root_capacity)
        new_minifat = list(self.minifat)
        for index in range(len(new_minifat)):
            new_minifat[index] = FREESECT

        allocation: dict[str, tuple[int, int]] = {}
        cursor = 0
        for e, payload in mini_streams:
            count = (len(payload) + self.mini_sector_size - 1) // self.mini_sector_size
            start = cursor if count else ENDOFCHAIN
            for part in range(count):
                mini_sector = cursor + part
                source_start = part * self.mini_sector_size
                target_start = mini_sector * self.mini_sector_size
                packed_root[target_start : target_start + self.mini_sector_size] = (
                    payload[source_start : source_start + self.mini_sector_size].ljust(
                        self.mini_sector_size, b"\x00"
                    )
                )
                new_minifat[mini_sector] = (
                    mini_sector + 1 if part + 1 < count else ENDOFCHAIN
                )
            allocation[e.name] = (start, len(payload))
            cursor += count

        for index, sector in enumerate(root_chain):
            offset = self._sector_offset(sector)
            start = index * self.sector_size
            updated[offset : offset + self.sector_size] = packed_root[
                start : start + self.sector_size
            ].ljust(self.sector_size, b"\x00")

        # Replaced streams that are now normal streams get fresh sectors,
        # reusing whatever their previous allocation released.
        for name, payload in replacements.items():
            if len(payload) >= self.mini_cutoff:
                allocation[name] = append_normal(payload, reuse_pool.get(name, []))
            elif not payload:
                allocation[name] = (ENDOFCHAIN, 0)

        first_minifat = struct.unpack_from("<I", self.data, 60)[0]
        minifat_count = struct.unpack_from("<I", self.data, 64)[0]
        if minifat_count:
            minifat_chain = self._chain(first_minifat, self.fat, "mini-FAT chain")[
                :minifat_count
            ]
            minifat_bytes = struct.pack(f"<{len(new_minifat)}I", *new_minifat)
            written = 0
            for sector in minifat_chain:
                offset = self._sector_offset(sector)
                chunk = minifat_bytes[written : written + self.sector_size]
                updated[offset : offset + len(chunk)] = chunk
                written += len(chunk)

        locations = self._directory_locations(self.fat)
        struct.pack_into(
            "<Q", updated, locations[self.root.index] + 120, required_bytes
        )
        for name, (start, size) in allocation.items():
            offset = locations[stream_entries[name].index]
            struct.pack_into("<I", updated, offset + 116, start)
            struct.pack_into("<Q", updated, offset + 120, size)

        # Serialise the FAT across every FAT sector.  This was already done by
        # ensure_fat_capacity when the FAT grew; writing it again is harmless
        # and keeps the non-growing path correct.
        write_working_fat()

        # No tail compaction is attempted.  A version that freed the last sector
        # when nothing in the FAT pointed at it looked safe and was not: the sector
        # held live data that only a header field led to, so freeing it truncated
        # real content (the CFB write suite caught it).  Discarding a sector
        # because *this* parser cannot find a reference to it is not evidence that
        # nothing references it.
        #
        # The consequence is recorded rather than hidden: after a grow-then-shrink
        # cycle the container stays one 512-byte sector larger than the original,
        # even though every stream reads back byte-identically.

        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=destination.parent, delete=False, suffix=".tmp"
        ) as handle:
            handle.write(updated)
            temporary = Path(handle.name)
        _replace_with_retry(temporary, destination)
        return destination

    def verify_streams(self, expected: dict[str, bytes]) -> None:
        """Re-open the file and assert the streams read back byte-identically."""
        check = CompoundFile(self.path)
        for name, payload in expected.items():
            actual = check.read_stream(name)
            if actual != payload:
                raise CfbError(
                    f"Read-back verification failed for stream {name!r}: "
                    f"wrote {len(payload)} bytes, read {len(actual)}"
                )

    def rename_streams(self, renames: dict[str, str], destination: str | Path | None = None) -> Path:
        """Rename directory entries in place.

        CFB directory names are UTF-16LE, null-terminated, and limited to 64
        bytes including the terminator.  Renaming is how a cloned POU template
        gets its own stream names without re-serialising the payloads.
        """
        destination = Path(destination) if destination else self.path
        updated = bytearray(self.data)
        locations = self._directory_locations(self.fat)
        by_name = {e.name: e for e in self.entries if e.object_type == OBJ_STREAM}
        unknown = set(renames) - set(by_name)
        if unknown:
            raise KeyError(f"Unknown streams: {sorted(unknown)}")
        for old, new in renames.items():
            encoded = new.encode("utf-16le") + b"\x00\x00"
            if len(encoded) > 64:
                raise CfbError(
                    f"CFB stream name too long ({len(encoded)} > 64 bytes): {new!r}"
                )
            offset = locations[by_name[old].index]
            updated[offset : offset + 64] = encoded.ljust(64, b"\x00")
            struct.pack_into("<H", updated, offset + 64, len(encoded))
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=destination.parent, delete=False, suffix=".tmp"
        ) as handle:
            handle.write(updated)
            temporary = Path(handle.name)
        _replace_with_retry(temporary, destination)
        return destination
