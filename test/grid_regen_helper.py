"""
Does MotionWorks REGENERATE a POU's .VGR grid from the .VB text?

The one thing this plugin cannot do safely is write a .VGR record MotionWorks agrees with:
a record it disagrees with makes it silently rewrite the POU (the .VB emptied from 1112
bytes to 0, the grid inflated from 1565 bytes to 79 MB, nothing in the Errors pane).

But the IDE clearly CAN build a grid from text - that is exactly what
`iec_61131-3_file_import` does with an exported .ST file. Which raises the question this
answers: if the grid is stale, or missing entirely, does the IDE rebuild it from the text?

Three cases, each on a freshly staged copy, each judged by a build:

  A  add a declaration to the .VB and DELETE the .VGR    -> does the IDE recreate it?
  B  add a declaration to the .VB and leave the .VGR stale (the known-bad case, control)
  C  add a declaration to the .VB, delete the .VGR, then add a member declaration too

If A regenerates the grid, the declaration path opens without any of the binary surgery.
"""
import json
import shutil
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

STAGE = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use\stage")
DIR = STAGE / "TopCutter"
POU = "TopCutterCamSetup"
VAR = "ZZRegenProbe"


def pou_streams():
    pou = P.Project(root=DIR).pou(POU)
    cf = CompoundFile(pou.source_path)
    names = cf.stream_names()
    return cf, next((n for n in names if n.upper().endswith("V.VGR")), None), \
        next((n for n in names if n.upper().endswith("V.VB")), None)


def state() -> dict:
    cf, vg, vb = pou_streams()
    out = {"streams": cf.stream_names()}
    if vg and vg in cf.stream_names():
        raw = cf.read_stream(vg)
        out["grid_bytes"] = len(raw)
        out["grid_count"] = struct.unpack_from("<I", raw, 8)[0] if len(raw) >= 12 else -1
        out["grid_parsed"] = len(V.parse_grid_records(raw))
    else:
        out["grid_bytes"] = None
    if vb and vb in cf.stream_names():
        out["vb_bytes"] = len(cf.read_stream(vb))
    return out


def add_declaration() -> dict:
    W._refuse_pou_variable_write = lambda pou_name, action: None
    W._refuse_global_write = lambda pou_name, action: None
    plan = W.plan_variable_add(DIR, POU, VAR, "BOOL", section="VAR")
    return W.apply_declaration(plan, DIR, dry_run=False)


def drop_grid() -> str:
    cf, vg, vb = pou_streams()
    if not vg:
        return "no grid to drop"
    cf.delete_stream(vg) if hasattr(cf, "delete_stream") else None
    return vg


def main() -> int:
    case = sys.argv[1]
    print(f"  case {case} on {DIR}")
    if case == "add":
        add_declaration()
    elif case == "add-stale":
        add_declaration()
    elif case == "add-dropgrid":
        add_declaration()
        # Remove the .VGR stream so the IDE has nothing stale to trust.
        cf, vg, vb = pou_streams()
        names = cf.stream_names()
        if vg:
            # replace_streams cannot delete, so rewrite the container without it via the
            # CFB writer's own directory rebuild.
            try:
                cf.remove_stream(vg)
                print(f"    removed {vg}")
            except AttributeError:
                print("    CompoundFile has no remove_stream; trying delete_stream")
                try:
                    cf.delete_stream(vg)
                    print(f"    deleted {vg}")
                except AttributeError:
                    print("    NO removal API on CompoundFile - cannot drop the grid this way")
    print("  " + json.dumps(state(), default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
