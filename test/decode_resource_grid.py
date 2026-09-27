"""Decode Global_Variables.VGR - the resource-level global grid.

A THIRD layout, distinct from a POU's .VGR. Known so far:

    header   magic=524289, last_handle=1438, count=161, then one more uint32 (1025)
    records  five uint32, then four length-prefixed UTF-16LE strings in the same field order
             as a POU record - type, address, initial value, name

    0a 00 00 00 | 44 00 49 00 4e 00 54 00 00 00     len=10  "DINT"
    0e 00 00 00 | 25 00 4d 00 44 00 31 00 2e 00 30 00 00 00   len=14  "%MD1.0"
    02 00 00 00 | 00 00                             len=2   ""
    22 00 00 00 | 50 00 ...                         len=34  the NAME

The hypothesis is that the five uint32 are the record header and the four strings follow. It
has to be validated, not assumed: walking records that way must consume the stream exactly and
find exactly `count` of them, and every name must decode as plain text with no NULs. If the
arithmetic comes out one record short or leaves trailing bytes, the header size is wrong and the
whole thing is a different shape.
"""
import struct
import sys
from pathlib import Path

ENGINE = Path(
    r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace"
    r"\motionworks-iec-use\code\engine"
)
sys.path.insert(0, str(ENGINE))

from motionworks_iec_mcp.cfb import CompoundFile      # noqa: E402

GRID = "Global_Variables.VGR"


def read_string(data: bytes, offset: int) -> tuple[str, int]:
    """A length-prefixed UTF-16LE string with a NUL terminator. Returns (text, next offset)."""
    length = struct.unpack_from("<I", data, offset)[0]
    start = offset + 4
    raw = data[start:start + length]
    text = raw.decode("utf-16-le", "replace").rstrip("\x00")
    return text, start + length


def main() -> int:
    project = Path(sys.argv[1])
    source = project / "C" / "Configuration" / "R" / "Resource" / "src.st1"
    if not source.is_file():
        print(f"  no resource src.st1 at {source}")
        return 1
    data = CompoundFile(source).read_stream(GRID)

    magic, last_handle, count, spare = struct.unpack_from("<4I", data, 0)
    print(f"  {GRID}: {len(data)} bytes")
    print(f"  header: magic={magic} last_handle={last_handle} count={count} spare={spare}")

    # Hypothesis A: five uint32 of record header, then four strings.
    HEADER_WORDS = 5
    offset = 16
    records = []
    while offset + 4 * HEADER_WORDS <= len(data):
        head = struct.unpack_from(f"<{HEADER_WORDS}I", data, offset)
        cursor = offset + 4 * HEADER_WORDS
        try:
            type_name, cursor = read_string(data, cursor)
            address, cursor = read_string(data, cursor)
            initial, cursor = read_string(data, cursor)
            name, cursor = read_string(data, cursor)
        except struct.error:
            break
        if not name or any(ord(c) < 32 for c in name):
            break
        records.append((head, type_name, address, initial, name, offset, cursor))
        offset = cursor

    print(f"\n  hypothesis A ({HEADER_WORDS} uint32 + 4 strings):")
    print(f"    records found : {len(records)}   (header says {count})")
    print(f"    consumed      : {offset} of {len(data)}   leftover {len(data) - offset}")
    print(f"    MATCHES COUNT : {len(records) == count}")

    if records:
        print("\n    first 3 records:")
        for head, t, a, i, n, start, end in records[:3]:
            print(f"      @{start:>6}  head={head}  type={t!r} addr={a!r} init={i!r} name={n!r}")
        print("    last record:")
        head, t, a, i, n, start, end = records[-1]
        print(f"      @{start:>6}  head={head}  type={t!r} addr={a!r} init={i!r} name={n!r}")

        heads = {}
        for head, *_ in records:
            heads[head[:4]] = heads.get(head[:4], 0) + 1
        print(f"\n    distinct first-4-word combinations: {len(heads)}")
        for key, n in sorted(heads.items(), key=lambda kv: -kv[1])[:6]:
            print(f"      {key}  x{n}")

    if len(records) != count or offset != len(data):
        print("\n  hypothesis A is WRONG - trying other header sizes")
        for words in (4, 6, 3):
            off = 16
            found = 0
            while off + 4 * words <= len(data):
                cursor = off + 4 * words
                ok = True
                try:
                    for _ in range(4):
                        _t, cursor = read_string(data, cursor)
                except struct.error:
                    ok = False
                if not ok or cursor <= off:
                    break
                found += 1
                off = cursor
            print(f"    {words} uint32: {found} records, consumed {off}/{len(data)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
