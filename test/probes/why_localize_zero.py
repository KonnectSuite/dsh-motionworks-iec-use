"""Why does localize_variable_grid return 0 for the template's own grid?

Everything is in place:

    pou_writer.py:605   def localize_variable_grid(raw) -> (bytes, int, int)
    pou_writer.py:716   the TRANSPLANT path calls it
    pou_writer.py:1075  the CREATE path calls it, via _localize_pou_variables
    pou_writer.py:1078  but only applies the result `if localized:`

Measured on a real clone: the text WAS renamed (VAR_EXTERNAL 2 -> 0) and the grid was NOT changed
(1565 bytes, identical). So the call ran and reported zero, and the replacement was skipped -
leaving the text calling those symbols local while the binary records still mark them external.

That is the contradiction. Round 27 found the same disagreement the other way round: a
VAR_EXTERNAL declaration whose grid record said LOCAL stalled the build with an empty Errors pane.
Two stores describing different things is the failure, whichever direction it runs in.

So: run the localizer on the template's grid and report what it actually sees. parse_grid_records
returns DICTS, not objects - an earlier probe used attribute access and reported usage=None for
every record, which was the probe's error and looked like a finding.

Then the same for the clone's grid, to see whether the records differ at all.
"""
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(INST / "code" / "engine"))

from motionworks_iec_mcp.cfb import CompoundFile          # noqa: E402
from motionworks_iec_mcp import variables as V            # noqa: E402
from motionworks_iec_mcp import pou_writer as PW          # noqa: E402

STAGE = INST / "stage" / "TopCutter" / "POE"


def profile(raw: bytes) -> list:
    recs = V.parse_grid_records(raw)
    out = []
    for r in recs:
        if isinstance(r, dict):
            out.append((r.get("usage"), r.get("name"), r.get("row")))
        else:
            out.append((getattr(r, "usage", None), getattr(r, "name", None), None))
    return out


def show(label: str, src: Path) -> None:
    if not src.is_file():
        print(f"  {label}: missing")
        return
    cf = CompoundFile(src)
    grid = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    print(f"  ===== {label} =====")
    if vb:
        t = cf.read_stream(vb).decode("latin1")
        print(f"    text: VAR_EXTERNAL={t.count('VAR_EXTERNAL')}")
    if not grid:
        print("    no grid")
        return
    raw = cf.read_stream(grid)
    p = profile(raw)
    print(f"    grid {len(raw)}B, {len(p)} records")
    for u, n, row in p:
        print(f"      usage={u!r:<6} row={row!r:<5} {n}")


show("template (TopCutterCamSetup)", STAGE / "TopCutterCamSetup" / "src.st1")
show("clone (ZzInspect)", STAGE / "ZzInspect" / "src.st1")

print()
print("  ===== localize_variable_grid on the template's grid =====")
cf = CompoundFile(STAGE / "TopCutterCamSetup" / "src.st1")
grid = next(n for n in cf.stream_names() if n.endswith("V.VGR"))
raw = cf.read_stream(grid)
before = profile(raw)
print(f"    usages before: {[u for u, _, _ in before]}")
try:
    new_bytes, localized, fb = PW.localize_variable_grid(raw)
    print(f"    localized={localized}  fb_instances={fb}  {len(raw)}B -> {len(new_bytes)}B")
    if localized:
        print(f"    usages after : {[u for u, _, _ in profile(new_bytes)]}")
    else:
        print("    reported ZERO - nothing it recognised as external")
except Exception as e:
    print(f"    raised {type(e).__name__}: {e}")

print()
print("  ===== the localizer's source, to see what it looks for =====")
import inspect
src = inspect.getsource(PW.localize_variable_grid)
for i, line in enumerate(src.split("\n")[:44]):
    print(f"    {i:>2} | {line[:100]}")
