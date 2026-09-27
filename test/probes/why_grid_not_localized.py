"""Why does the clone's grid keep usage=5 when the text says VAR?

The pieces are all present and each looks right:

    _localize_pou_variables (pou_writer:1029) is CALLED from apply_pou_creation (line 888)
    it renames VAR_EXTERNAL -> VAR in the text          (1066-1070)
    it calls localize_variable_grid on the grid          (1072-1079)
    and refuses to guess at an unexpected layout         (1080-1083)

Measured on a real clone, the text IS renamed - the clone's first block reads 'VAR' where the
template read 'VAR_EXTERNAL' - and the grid is NOT localized, so the two stores disagree: the text
calls the symbols local and the binary records still mark them external. That contradiction is
what stalls the build, and it is the same text-versus-grid disagreement round 27 found in the
opposite direction.

So this runs the localizer directly on the template's own grid and reports what it says, which
separates "the localizer cannot do it" from "the localizer is not being reached" from "it runs and
its answer is discarded".
"""
import sys
from pathlib import Path

INST = Path(
    r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use"
)
sys.path.insert(0, str(INST / "code" / "engine"))

from motionworks_iec_mcp.cfb import CompoundFile                 # noqa: E402
from motionworks_iec_mcp import variables as V                   # noqa: E402

STAGE = INST / "stage" / "TopCutter" / "POE"


def usage_profile(stream: bytes) -> list:
    """Every record's usage, via the plugin's own parser."""
    try:
        records = V.parse_grid_records(stream)
    except Exception as e:
        return [f"parse failed: {e}"]
    out = []
    for r in records:
        u = getattr(r, "usage", None)
        n = getattr(r, "name", None)
        out.append((u, n))
    return out


def main() -> int:
    template = STAGE / "TopCutterCamSetup" / "src.st1"
    clone = STAGE / "ZzInspect" / "src.st1"

    for label, src in (("template", template), ("clone", clone)):
        if not src.is_file():
            print(f"  {label}: missing {src}")
            continue
        cf = CompoundFile(src)
        grid = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
        vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
        print(f"  ===== {label} =====")
        if vb:
            text = cf.read_stream(vb).decode("latin1")
            print(f"    text sections: VAR_EXTERNAL={text.count('VAR_EXTERNAL')} "
                  f"VAR={text.count('VAR') - text.count('VAR_EXTERNAL')}")
        if grid:
            raw = cf.read_stream(grid)
            prof = usage_profile(raw)
            print(f"    grid: {len(raw)}B, {len(prof)} record(s)")
            for u, n in prof[:14]:
                print(f"      usage={u}  {n}")

    print()
    print("  ===== the localizer, run on the template's grid =====")
    cf = CompoundFile(template)
    grid = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    raw = cf.read_stream(grid)
    try:
        new_bytes, localized, fb = V.localize_variable_grid(raw)
        print(f"    localized={localized}  fb_instances={fb}  {len(raw)}B -> {len(new_bytes)}B")
        if localized:
            before = {str(u) for u, _ in usage_profile(raw)}
            after = {str(u) for u, _ in usage_profile(new_bytes)}
            print(f"    usages before: {sorted(before)}")
            print(f"    usages after : {sorted(after)}")
        else:
            print("    IT REPORTED ZERO - so it either found nothing to localize or gave up")
            print(f"    usages in the template grid: "
                  f"{sorted({str(u) for u, _ in usage_profile(raw)})}")
    except Exception as e:
        print(f"    raised {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
