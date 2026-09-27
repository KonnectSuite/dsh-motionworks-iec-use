"""Diff a clone's declaration stream against its template's, completely.

Everything around the file has been eliminated by measurement:

    the four streams are present and the right sizes
    the grid localizes correctly (usage AND marker now move together)
    every sidecar file is byte-identical or correctly renamed
    the tree nodes carry the IDE's own markers - 7, 42, 8, 23 - not one marker repeated
    adding a declaration to an EXISTING POU survives the reopen and compiles
    adding one to a CLONE truncates the .VB to 0 bytes on the next open

So the difference has to be inside the .VB itself. This prints both files in full, aligned, and
marks every line that differs - so the answer is visible rather than inferred. 18 bytes separate
them (1112 vs 1094) and the POU name is 10 characters shorter, so most of that is expected; what
is not expected is anything else.
"""
import difflib
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(INST / "code" / "engine"))

from motionworks_iec_mcp.cfb import CompoundFile      # noqa: E402

POE = INST / "stage" / "TopCutter" / "POE"


def vb(pou: str) -> str:
    src = POE / pou / "src.st1"
    if not src.is_file():
        return ""
    cf = CompoundFile(src)
    name = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    return cf.read_stream(name).decode("latin1") if name else ""


def main() -> int:
    a = vb("TopCutterCamSetup")
    b = vb("ZzNodes")
    print(f"  template .VB: {len(a)}B     clone .VB: {len(b)}B     delta {len(b) - len(a):+d}")
    print()

    al = a.split("\n")
    bl = b.split("\n")
    print(f"  template has {len(al)} lines, clone has {len(bl)} lines")
    print()

    print("  ===== unified diff (template -> clone) =====")
    for line in difflib.unified_diff(al, bl, fromfile="TopCutterCamSetup",
                                     tofile="ZzNodes", lineterm="", n=1):
        print(f"    {line[:104]!r}")

    print()
    print("  ===== every differing line, with its neighbours =====")
    sm = difflib.SequenceMatcher(None, al, bl)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        print(f"    {tag}: template[{i1}:{i2}] vs clone[{j1}:{j2}]")
        for k in range(max(0, i1 - 1), min(len(al), i2 + 1)):
            print(f"      T{k:>3} | {al[k][:96]!r}")
        for k in range(max(0, j1 - 1), min(len(bl), j2 + 1)):
            print(f"      C{k:>3} | {bl[k][:96]!r}")
        print()

    # Anything mentioning the template inside the clone would be a smoking gun.
    print("  ===== does the clone's .VB still mention the template? =====")
    for needle in ("TopCutterCamSetup", "TOPCUTTERCAMSETUP"):
        print(f"    {needle!r}: {b.count(needle)} occurrence(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
