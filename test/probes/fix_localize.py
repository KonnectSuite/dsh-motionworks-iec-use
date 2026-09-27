"""Fix localize_variable_grid so it moves BOTH halves of an external record.

The bug, exactly:

    for offset in offsets:
        usage = struct.unpack_from("<I", data, offset + 4)[0]
        if usage == 5:
            struct.pack_into("<I", data, offset + 4, 1)     # usage only
            localized += 1

An external record says so TWICE - usage 5 in the header AND a marker in the trailing run:

    usage=5 EXTERNAL   header usage 5,  tail (0, 0, ffffffff, 0)
    usage=1 LOCAL      header usage 1,  tail (0, 0, 0, 0)

Changing only the header leaves every converted record contradicting itself, and the consequences
are not subtle. Measured on a real clone:

    template [0]  usage=5  tail=(0, 0, 4294967295, 0)   consistent
    clone    [0]  usage=1  tail=(0, 0, 4294967295, 0)   CONTRADICTION

    the clone builds clean at baseline          is_compiled=true
    adding ONE declaration to it                is_compiled=false, stalled=true
    and the grid becomes                       79,432,063 bytes

79 MB is the exact size the grid reached when this writer first destroyed a POU. That is the
"first attempt corrupted the project" symptom, and it was still reachable: create a POU from a
template that carries externals, then add a declaration to it.

Round 27 found the same contradiction in the other direction - a VAR_EXTERNAL declaration given a
usage=1 record - and the marker was the discriminator then too.

The fix locates each record's trailing run and zeroes the marker word when localizing. The run
starts after the record's four length-prefixed strings, and the marker is its third uint32, so the
position is computed per record rather than assumed to be a fixed stride - the same reason records
are found by pattern and not by stride.
"""
import ast
import sys
from pathlib import Path

OLD = '''    localized = 0
    fb_instances = 0
    for offset in offsets:
        usage = struct.unpack_from("<I", data, offset + 4)[0]
        if usage == 5:
            struct.pack_into("<I", data, offset + 4, 1)
            localized += 1
        elif usage == 0x00040001:
            fb_instances += 1
    return bytes(data), localized, fb_instances'''

NEW = '''    localized = 0
    fb_instances = 0
    marker_moved = 0
    for offset in offsets:
        usage = struct.unpack_from("<I", data, offset + 4)[0]
        if usage == 5:
            struct.pack_into("<I", data, offset + 4, 1)
            # An external record says so twice: header usage 5, and 0xFFFFFFFF as the third
            # word of its trailing run. Moving only the header left each converted record
            # contradicting itself, and the clone then stalled the build and blew its grid up
            # to 79 MB on the next append. Both halves move together.
            tail = _record_tail_offset(data, offset)
            if tail is not None and struct.unpack_from("<I", data, tail + 8)[0] == 0xFFFFFFFF:
                struct.pack_into("<I", data, tail + 8, 0)
                marker_moved += 1
            localized += 1
        elif usage == 0x00040001:
            fb_instances += 1
    if localized and marker_moved != localized:
        raise PouPlanError(
            f"localized {localized} external record(s) but moved only {marker_moved} external "
            f"marker(s); refusing to leave a record whose header says LOCAL while its trailing "
            f"run still says EXTERNAL"
        )
    return bytes(data), localized, fb_instances


def _record_tail_offset(data: bytes | bytearray, offset: int) -> int | None:
    """Where a record's trailing run begins, or None if its strings do not parse.

    Six uint32 of header, then four length-prefixed UTF-16LE strings - type, address, initial
    value, name - and then the trailing run. Located per record because the strings vary in
    length, which is why this format defeated a fixed stride.
    """
    try:
        cursor = offset + 24
        for _ in range(4):
            length = struct.unpack_from("<I", data, cursor)[0]
            if length % 2 or cursor + 4 + length > len(data):
                return None
            cursor += 4 + length
        if cursor + 16 > len(data):
            return None
        return cursor
    except struct.error:
        return None'''

for target in sys.argv[1:]:
    p = Path(target)
    t = p.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in t else "\n"
    if nl != "\n":
        old = OLD.replace("\n", nl)
        new = NEW.replace("\n", nl)
    else:
        old, new = OLD, NEW
    assert old in t, "localizer body anchor missing"
    t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")
    ast.parse(t)
    print(f"  localize_variable_grid now moves the marker too, in {p.name}")
