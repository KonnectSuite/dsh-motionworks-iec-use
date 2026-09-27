"""Compare the clone's grid records to the template's, byte for byte.

localize_variable_grid changed usage 5 -> 1 on five records and the caller applies the result. If
it changed ONLY the usage word and left the trailing run alone, then each converted record now
contradicts itself: usage says LOCAL while the trailing marker still says EXTERNAL.

That is precisely the defect round 27 found the other way round. There, a VAR_EXTERNAL
declaration got a record with usage=1 and an all-zero trailing run, and the build stalled with an
empty Errors pane - and the marker was the discriminator:

    usage=5 EXTERNAL   00 00 00 00 | 00 00 00 00 | ff ff ff ff | 00 00 00 00
    usage=1 LOCAL      00 00 00 00 | 00 00 00 00 | 00 00 00 00 | 00 00 00 00

Measured now: the clone builds clean at baseline, and ADDING A DECLARATION to it then stalls the
build, while the same add on a normal POU is proved good by the capability matrix. So the clone's
grid is in a state the append logic cannot extend correctly - and a record whose usage and marker
disagree is exactly such a state.

This prints every record's header words and its trailing run for both grids, so the difference is
visible rather than inferred.
"""
import struct
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(INST / "code" / "engine"))

from motionworks_iec_mcp.cfb import CompoundFile           # noqa: E402
from motionworks_iec_mcp import variables as V             # noqa: E402

STAGE = INST / "stage" / "TopCutter" / "POE"


def records_with_tails(raw: bytes):
    """Locate each record and show its six header words plus what follows its strings."""
    recs = V.parse_grid_records(raw)
    out = []
    for r in recs:
        out.append(r)
    return out


def dump(label: str, src: Path) -> None:
    if not src.is_file():
        print(f"  {label}: missing")
        return
    cf = CompoundFile(src)
    grid_name = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    if not grid_name:
        print(f"  {label}: no grid")
        return
    raw = cf.read_stream(grid_name)
    print(f"  ===== {label}: {grid_name} {len(raw)}B =====")
    print(f"    raw[0:12] header: {struct.unpack_from('<3I', raw, 0)}")

    # Walk records the way variables.py does and print the header words plus the
    # first 16 bytes after the strings, which is where the marker lives.
    offset = 12
    i = 0
    while offset + 24 <= len(raw):
        head = struct.unpack_from("<6I", raw, offset)
        handle, usage, group, flags, row, final = head
        if not (1000 <= handle <= 10000 and group == 1 and flags == 0):
            break
        try:
            cursor = offset + 24
            strs = []
            for _ in range(4):
                n = struct.unpack_from("<I", raw, cursor)[0]
                strs.append(raw[cursor + 4:cursor + 4 + n].decode("utf-16-le", "replace").rstrip("\x00"))
                cursor += 4 + n
            tail = raw[cursor:cursor + 16]
            tail_words = struct.unpack_from("<4I", raw, cursor)
        except Exception as e:
            print(f"    record {i}: decode failed {e}")
            break
        marker = "EXTERNAL" if tail_words[2] == 0xFFFFFFFF else "local   "
        print(f"    [{i:>2}] @{offset:<5} usage={usage:<7} row={row:<4} "
              f"name={strs[3]:<24} tail={tail_words} {marker}")
        i += 1
        # advance past the strings and the trailing run, using the same extent logic
        offset = cursor + 16
        if offset >= len(raw):
            break
    print(f"    {i} record(s) walked, ended at {offset} of {len(raw)}")
    print()


dump("TEMPLATE (externals intact)", STAGE / "TopCutterCamSetup" / "src.st1")
dump("CLONE (localized)", STAGE / "ZzInspect" / "src.st1")
