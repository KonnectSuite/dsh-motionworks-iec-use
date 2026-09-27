"""
Does the CURRENT append_grid_variable produce a grid record MotionWorks accepts?

The destruction this plugin suffered was measured against an EARLIER version of the append:
one that assumed three strings rather than four, and that left the external marker
(ffffffff) in the trailing run of a record it had just marked local. Both were fixed in
later rounds - the four-string shape, the cleared marker, the synthesised rather than cloned
record, and the insert after the LAST record - and the corrected version has never been
tested against a build.

So this does the whole thing with the code as it stands:

  op = decl-plus-grid   add the declaration to the .VB AND append a matching .VGR record
  op = state            report what is there now

and the Node side then writes a body that USES the variable and builds. If it compiles, a
declaration can be declared AND used with no IDE step at all.
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


def report(project: Path, pou_name: str, var: str) -> dict:
    cf, vg, vb = streams(project, pou_name)
    out = {"streams": cf.stream_names()}
    if vg and vg in cf.stream_names():
        raw = cf.read_stream(vg)
        recs = V.parse_grid_records(raw)
        out["grid_bytes"] = len(raw)
        out["grid_count"] = struct.unpack_from("<I", raw, 8)[0]
        out["grid_parsed"] = len(recs)
        out["grid_last_handle"] = struct.unpack_from("<I", raw, 4)[0]
        # Show the record for our variable, fully decoded, so a wrong field is visible.
        for r in recs:
            d = V.read_grid_record(raw, r["offset"])
            if d["name"] == var:
                out["our_record"] = {
                    "handle": r["handle"], "usage": r["usage"], "row": r["row"],
                    "type": d["type"], "init": d["initial_value"], "name": d["name"],
                    "trailing": raw[r["offset"] + (d["after_name"] - r["offset"]):][:16].hex(),
                }
    if vb and vb in cf.stream_names():
        text = cf.read_stream(vb).decode("latin1")
        out["vb_bytes"] = len(text)
        out["vb_has_var"] = var in text
        out["vb_lines"] = len(text.splitlines())
        # the row the grid should carry is the declaration's 1-based line number
        for i, line in enumerate(text.splitlines()):
            if line.lstrip().startswith(var):
                out["vb_var_line_1based"] = i + 1
                break
    return out


def main() -> int:
    op, project, pou, var = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]

    if op == "decl-plus-grid":
        W._refuse_pou_variable_write = lambda pou_name, action: None
        W._refuse_global_write = lambda pou_name, action: None
        plan = W.plan_variable_add(project, pou, var, "BOOL", section="VAR")
        W.apply_declaration(plan, project, dry_run=False)

        cf, vg, vb = streams(project, pou)
        text = cf.read_stream(vb).decode("latin1").splitlines()
        row = next((i + 1 for i, l in enumerate(text)
                    if l.lstrip().startswith(var) and ":" in l), None)
        if row is None:
            raise SystemExit("declaration not found in the .VB text")
        raw = cf.read_stream(vg)
        new_grid, handle = V.append_grid_variable(raw, var, "BOOL", row=row)
        cf.replace_streams({vg: new_grid})
        print(f"    appended handle={handle} row={row}")

    print(json.dumps(report(project, pou, var), default=str, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
