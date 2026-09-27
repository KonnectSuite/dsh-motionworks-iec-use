"""
Does MotionWorks rebuild a .VGR grid it considers EMPTY from the .VB text?

The grid cannot be removed - CompoundFile has read/replace/rename but no delete - so this
zeroes it instead: the 12-byte header is kept and its record count set to 0, leaving no
records at all. If the IDE treats that as "no variables cached" and rebuilds from the text,
the declaration path opens with no binary surgery at all.

Paired with a declaration added to the .VB, on a freshly staged copy, judged by a build.

Usage:  python grid_zero_helper.py <op> <project> <pou> <varname>
  op = add             add the declaration to the .VB only
  op = add-zero-grid   add it, then set the grid's record count to 0
  op = state           report what is there now
"""
import json
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


def state(project: Path, pou_name: str, var: str) -> dict:
    cf, vg, vb = streams(project, pou_name)
    out = {"streams": cf.stream_names()}
    if vg:
        raw = cf.read_stream(vg)
        out["grid_bytes"] = len(raw)
        out["grid_header"] = list(struct.unpack_from("<3I", raw, 0)) if len(raw) >= 12 else None
        out["grid_count"] = struct.unpack_from("<I", raw, 8)[0] if len(raw) >= 12 else -1
        out["grid_parsed"] = len(V.parse_grid_records(raw))
    if vb:
        text = cf.read_stream(vb).decode("latin1")
        out["vb_bytes"] = len(text)
        out["vb_has_var"] = var in text
        out["vb_lines"] = len(text.splitlines())
    return out


def main() -> int:
    op, project, pou, var = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]

    if op in ("add", "add-zero-grid"):
        W._refuse_pou_variable_write = lambda pou_name, action: None
        W._refuse_global_write = lambda pou_name, action: None
        plan = W.plan_variable_add(project, pou, var, "BOOL", section="VAR")
        W.apply_declaration(plan, project, dry_run=False)
        if op == "add-zero-grid":
            cf, vg, vb = streams(project, pou)
            raw = bytearray(cf.read_stream(vg))
            struct.pack_into("<I", raw, 8, 0)          # record count -> 0
            cf.replace_streams({vg: bytes(raw)})
            print("    grid record count set to 0")

    print(json.dumps(state(project, pou, var), default=str, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
