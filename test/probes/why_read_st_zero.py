"""Pin down why mw_code_read_st returns 0 declarations for a cloned POU.

The routing is:

    proj = _project(req["project"])
    info = proj.pou(req["pou"])
    table = info.declarations()
    for v in getattr(table, "variables", []) or []: ...

and the same bytes decode to 12 declarations when handed to decode_declarations directly. So the
loss is in one of three places: proj.pou() not finding the clone, info.declarations() returning an
empty table for it, or the variables attribute being named something else on that table.

This asks each question in turn for the clone and for a POU that works, so the difference shows.
"""
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(INST / "code" / "engine"))

from motionworks_iec_mcp import project as P            # noqa: E402
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402
from motionworks_iec_mcp import variables as V          # noqa: E402

ROOT = INST / "stage" / "TopCutter"


def probe(name: str) -> None:
    print(f"  ===== {name} =====")
    proj = P.Project(root=ROOT)

    # 1. does the project find the POU at all?
    try:
        info = proj.pou(name)
        print(f"    proj.pou()        -> {type(info).__name__}")
    except Exception as e:
        print(f"    proj.pou()        -> {type(e).__name__}: {e}")
        return

    for attr in ("name", "path", "source_stream", "declaration_stream", "grid_stream"):
        try:
            print(f"      .{attr:<20} = {getattr(info, attr)!r}")
        except Exception as e:
            print(f"      .{attr:<20} -> {type(e).__name__}")

    # 2. what does declarations() give?
    try:
        table = info.declarations()
        print(f"    declarations()    -> {type(table).__name__}")
        for attr in ("variables", "warnings", "source_stream"):
            try:
                val = getattr(table, attr)
                n = len(val) if hasattr(val, "__len__") else val
                print(f"      .{attr:<20} = {n!r}")
            except Exception as e:
                print(f"      .{attr:<20} -> {type(e).__name__}: {e}")
    except Exception as e:
        print(f"    declarations()    -> {type(e).__name__}: {e}")

    # 3. and the raw stream, decoded by hand, for the same POU
    try:
        cf = CompoundFile(ROOT / info.path / "src.st1") if hasattr(info, "path") else None
        if cf:
            for s in cf.stream_names():
                if s.endswith("V.VB"):
                    raw = cf.read_stream(s)
                    t = V.decode_declarations(raw)
                    print(f"    by hand: {s} {len(raw)}B -> "
                          f"{len(getattr(t, 'variables', []) or [])} declaration(s)")
    except Exception as e:
        print(f"    by hand           -> {type(e).__name__}: {e}")
    print()


print(f"  project root: {ROOT}")
print()
probe("TopCutterCamSetup")
probe("ZzInspect")
