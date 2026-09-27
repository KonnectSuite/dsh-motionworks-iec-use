"""Find records in Global_Variables.VGR by SHAPE rather than by stride.

A fixed stride works for fifteen records and then fails, because the trailing run carries
per-type structure: PLC_TASK_1 : TASK_INFO_ECLR has six uint32 of tail where a scalar has four.
So the walk cannot be "record, then N bytes" - it has to locate the next record by what a record
looks like.

Twelve records decoded by hand in sequence, plus a sixteenth read directly at 1804, all share one
signature:

    handle, 6, 1, 0, N, 0        with N incrementing 6, 7, 8, ... 20, 21
    then four length-prefixed UTF-16LE strings, the fourth a plausible identifier

    h=1025  (6, 1, 0,  6, 0)   DINT            %MD1.0       PLC_SYS_TICK_CNT
    h=1026  (6, 1, 0,  7, 0)   INT             %MW1.4       PLC_TASK_DEFINED
    h=1040  (6, 1, 0, 20, 0)   TASK_INFO_ECLR  %MB1.5000    PLC_TASK_1
    h=1041  (6, 1, 0, 21, 0)   TASK_INFO_ECLR  %MB1.5128    PLC_TASK_2

`word[1] == 6 and word[2] == 1 and word[3] == 0 and word[5] == 0` is therefore a strong
signature - four constants out of six words, with the handle and N free. Scanning for it and
requiring the four strings to decode cleanly should locate every record regardless of tail
length.

The test of the idea is arithmetic: the header says 161 records, so a scanner that finds 161,
in ascending handle order, with no overlap and no unclaimed interior, is right. Anything else
means the signature is too loose or too tight.
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
NAME_RE = None


def _plausible(text: str) -> bool:
    if not text or len(text) > 120:
        return False
    if not (text[0].isalpha() or text[0] == "_"):
        return False
    return all(c.isalnum() or c in "_ ." for c in text)


def read_string(data: bytes, offset: int, limit: int):
    if offset + 4 > limit:
        return None, offset
    length = struct.unpack_from("<I", data, offset)[0]
    if length == 0 or length % 2 or offset + 4 + length > limit:
        return None, offset
    raw = data[offset + 4:offset + 4 + length]
    if raw[-2:] != b"\x00\x00":
        return None, offset
    try:
        text = raw.decode("utf-16-le").rstrip("\x00")
    except Exception:
        return None, offset
    return text, offset + 4 + length


def candidate(data: bytes, offset: int):
    """Return the record starting at offset, or None."""
    if offset + 24 > len(data):
        return None
    head = struct.unpack_from("<6I", data, offset)
    if head[1] != 6 or head[2] != 1 or head[3] != 0 or head[5] != 0:
        return None
    cursor = offset + 24
    parts = []
    for _ in range(4):
        text, cursor = read_string(data, cursor, len(data))
        if text is None:
            return None
        parts.append(text)
    if not _plausible(parts[3]):
        return None
    return {"offset": offset, "head": head, "type": parts[0], "address": parts[1],
            "initial": parts[2], "name": parts[3], "strings_end": cursor}


def main() -> int:
    project = Path(sys.argv[1])
    data = CompoundFile(
        project / "C" / "Configuration" / "R" / "Resource" / "src.st1"
    ).read_stream(GRID)
    magic, last_handle, count = struct.unpack_from("<3I", data, 0)
    print(f"  count={count} last_handle={last_handle} len={len(data)}")

    hits = []
    for offset in range(12, len(data) - 24, 4):
        got = candidate(data, offset)
        if got:
            hits.append(got)

    print(f"  candidates by shape : {len(hits)}")
    print(f"  header count        : {count}")
    print(f"  MATCHES             : {len(hits) == count}")

    if hits:
        handles = [h["head"][0] for h in hits]
        print(f"  handle range        : {min(handles)}..{max(handles)}")
        print(f"  ascending           : {handles == sorted(handles)}")
        gaps = [i for i in range(1, len(handles)) if handles[i] != handles[i - 1] + 1]
        print(f"  handle gaps         : {len(gaps)}")
        print()
        for h in hits[:4]:
            print(f"    @{h['offset']:>6} h={h['head'][0]:<5} {h['type']:<16} "
                  f"{h['address']:<12} {h['name']}")
        print("    ...")
        for h in hits[-4:]:
            print(f"    @{h['offset']:>6} h={h['head'][0]:<5} {h['type']:<16} "
                  f"{h['address']:<12} {h['name']}")
        n_word = [h["head"][4] for h in hits]
        print(f"\n  word[4] range       : {min(n_word)}..{max(n_word)}")
        print(f"  word[4] ascending   : {n_word == sorted(n_word)}")
        tails = [hits[i + 1]["offset"] - h["strings_end"] for i in range(len(hits) - 1)]
        distinct = sorted(set(tails))
        print(f"  tail lengths seen   : {distinct[:12]}{' ...' if len(distinct) > 12 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
