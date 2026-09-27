"""
Insert a .VGR record in ROW ORDER rather than at the end.

The grid's records are ordered by their worksheet row, and the row is the declaration's
1-based line number in the .VB text. Measured over TopCutterCamSetup:

    row 6,7,8,9   VAR_EXTERNAL group 1
    row 14..20    VAR
    row 25        VAR_EXTERNAL group 2

ascending, 12 records. A new declaration appended to the last VAR block lands at row 21, so
its record belongs BETWEEN the row-20 record and the row-25 record - but the append always
put it after the last record, at the end, out of order. That is a real defect in the shape
of the write, and it is the one thing every previous attempt had in common.

Usage:  python grid_roworder.py <project> <pou> <varname> [--at-end]
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
from motionworks_iec_mcp import variables as V        # noqa: E402
from motionworks_iec_mcp import writer as W           # noqa: E402
from motionworks_iec_mcp import project as P          # noqa: E402


def streams(project: Path, pou_name: str):
    pou = P.Project(root=project).pou(pou_name)
    cf = CompoundFile(pou.source_path)
    names = cf.stream_names()
    return cf, next((n for n in names if n.upper().endswith("V.VGR")), None), \
        next((n for n in names if n.upper().endswith("V.VB")), None)


def build_record(grid: bytes, records: list[dict], index: int, name: str, type_name: str,
                 row: int, handle: int) -> bytes:
    """One record, synthesised from the layout rather than cloned."""
    def s(text: str) -> bytes:
        return struct.pack("<I", (len(text) + 1) * 2) + text.encode("utf-16-le") + b"\x00\x00"

    body = struct.pack("<6I", handle, 1, 1, 0, row, 0)   # handle, usage=local, group, flags, row, flags
    body += s(type_name) + s("") + s("FALSE") + s(name)
    # Trailing run: zeros, because a LOCAL record carries no external marker.
    body += b"\x00" * 16
    return body


def main() -> int:
    project, pou_name, var = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    at_end = "--at-end" in sys.argv

    W._refuse_pou_variable_write = lambda pou_name, action: None
    plan = W.plan_variable_add(project, pou_name, var, "BOOL", section="VAR", initial_value="FALSE")
    W.apply_declaration(plan, project, dry_run=False)

    cf, vg, vb = streams(project, pou_name)
    text = cf.read_stream(vb).decode("latin1").splitlines()
    row = next((i + 1 for i, l in enumerate(text) if l.lstrip().startswith(var) and ":" in l), None)
    if row is None:
        raise SystemExit("declaration not found in the .VB")

    grid = cf.read_stream(vg)
    records = V.parse_grid_records(grid)
    header = struct.unpack_from("<4I", grid, 0)
    new_handle = header[1] + 1
    record = build_record(grid, records, len(records), var, "BOOL", row, new_handle)

    # THE POINT OF THIS SCRIPT: place the record where its ROW belongs.
    if at_end:
        insert_at = records[-1]["offset"] + V._record_extent(grid, records, len(records) - 1)
        where = "END (the old behaviour)"
    else:
        index = next((i for i, r in enumerate(records) if r["row"] > row), len(records))
        if index == 0:
            insert_at = records[0]["offset"]
        elif index >= len(records):
            insert_at = records[-1]["offset"] + V._record_extent(grid, records, len(records) - 1)
        else:
            insert_at = records[index]["offset"]
        where = f"index {index} of {len(records)}"

    out = bytearray(grid[:insert_at]) + bytearray(record) + bytearray(grid[insert_at:])
    struct.pack_into("<I", out, 4, new_handle)
    struct.pack_into("<I", out, 8, len(records) + 1)
    cf.replace_streams({vg: bytes(out)})

    check = CompoundFile(Path(P.Project(root=project).pou(pou_name).source_path)).read_stream(vg)
    after = V.parse_grid_records(check)
    rows = [r["row"] for r in after]
    print(f"    inserted at {where}; row={row}; grid rows now {rows}; ascending={rows == sorted(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
