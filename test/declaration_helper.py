"""
Helper for test/declaration_only.mjs.

Runs in the 32-bit-free engine environment the plugin uses. Two operations, invoked as
`python declaration_helper.py <op> <project> <pou> <varname>`:

  grids  - report the declaration stream's state and every record the .VGR grid decodes to
  add    - add one declaration: the .VB text AND a matching .VGR record, nothing else

Keeping this out of the Node test avoids the nested-quoting mess that stopped the earlier
attempt from running at all.
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
    vg = next((n for n in names if n.upper().endswith("V.VGR")), None)
    vb = next((n for n in names if n.upper().endswith("V.VB")), None)
    return cf, vg, vb


def report(project: Path, pou_name: str, var: str) -> dict:
    cf, vg, vb = streams(project, pou_name)
    out = {"streams": cf.stream_names()}
    if vg:
        raw = cf.read_stream(vg)
        records = V.parse_grid_records(raw)
        decoded = []
        for r in records:
            try:
                info = V.read_grid_record(raw, r["offset"])
                decoded.append({"handle": r["handle"], "usage": r["usage"],
                                "type": info["type"], "name": info["name"]})
            except Exception as exc:                          # noqa: BLE001
                decoded.append({"handle": r["handle"], "error": str(exc)})
        out["grid_count"] = struct.unpack_from("<I", raw, 8)[0]
        out["grid_parsed"] = len(records)
        out["grid_bytes"] = len(raw)
        out["records"] = decoded
    if vb:
        text = cf.read_stream(vb).decode("latin1")
        out["text_has_var"] = var in text
        out["text_lines"] = len(text.splitlines())
    return out


def add(project: Path, pou_name: str, var: str, type_name: str) -> dict:
    # This harness exists to TEST the declaration path, so it bypasses the refusal that
    # guards the shipped tool. The refusal stands for agents; it must not stop the
    # experiment that will decide whether it can be lifted.
    W._refuse_pou_variable_write = lambda pou_name, action: None
    W._refuse_global_write = lambda pou_name, action: None
    plan = W.plan_variable_add(project, pou_name, var, type_name, section="VAR")
    W.apply_declaration(plan, project, dry_run=False)
    cf, vg, vb = streams(project, pou_name)
    raw = cf.read_stream(vg)
    new_grid, handle = V.append_grid_variable(raw, var, type_name)
    cf.replace_streams({vg: new_grid})
    # Re-read from disk so the result reflects what was actually written.
    return {"added": var, "handle": handle, **report(project, pou_name, var)}


def main() -> int:
    op, project, pou, var = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]
    if op == "grids":
        result = report(project, pou, var)
    elif op == "add":
        type_name = sys.argv[5] if len(sys.argv) > 5 else "BOOL"
        result = add(project, pou, var, type_name)
    else:
        raise SystemExit(f"unknown op {op!r}")
    # ascii=True so a surprising decode shows up rather than crashing the console codec.
    print(json.dumps(result, default=str, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
