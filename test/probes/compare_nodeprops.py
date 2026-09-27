#!/usr/bin/env python3
"""Compare NodeProperties.xml by CONTENT, and every other per-POU file, byte for byte.

Round 43 left this as the next step. Everything else has been eliminated by measurement:

    the four streams        identical structure and sizes to the template's
    the .VB content         exactly two differing lines, the VAR_EXTERNAL -> VAR renames
    the grid                localizes both halves; appended rows match their declarations
    the .CCI and others     byte-identical or correctly renamed
    the tree nodes          the IDE's own markers 7, 42, 8, 23
    NODES.LST, the .mwt     an assignment registry and a 4 KB container; neither lists POUs
    the FB instances        the clone builds CLEAN with them duplicated - they are warnings
    the body                emptying it changes nothing
    assignment first        the clone compiles cleanly while assigned

and the failure, stated precisely: mw_code_var_add succeeds on a created POU, leaves a grid that
reads back correctly, and then the IDE OPENS the project and destroys the POU - .VB to 0 bytes,
grid to 79,432,063 bytes. The same call on an existing POU survives.

NodeProperties.xml is the obvious remaining per-POU file and only its SIZE has ever been compared
(3326 bytes in both). Sizes matching is not content matching, and _rewrite_node_properties is a
step the create performs - so it is the one file the plugin actively EDITS rather than copies.

This writes nothing. It dumps both files and diffs them line by line.
"""
import difflib
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
POE = INST / "stage" / "TopCutter" / "POE"

# Find whatever created POUs are on disk right now.
CANDIDATES = [d.name for d in POE.iterdir() if d.is_dir()] if POE.is_dir() else []
CLONES = [n for n in CANDIDATES if n.startswith("Zz")]
TEMPLATES = [n for n in CANDIDATES if not n.startswith("Zz")]

print(f"  POE directories: {sorted(CANDIDATES)}")
print(f"  created: {CLONES or '(none - run a create first)'}")
print()


def text_of(pou: str, name: str) -> str | None:
    p = POE / pou / name
    if not p.is_file():
        return None
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "utf-16", "latin1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("latin1")


def compare(name: str) -> None:
    if not CLONES:
        return
    clone = CLONES[-1]
    # compare against every template and report the closest, which is the one it was cloned from
    rows = []
    for t in TEMPLATES:
        a = text_of(t, name)
        b = text_of(clone, name)
        if a is None or b is None:
            rows.append((t, None, None))
            continue
        sm = difflib.SequenceMatcher(None, a, b)
        rows.append((t, len(a), len(b), round(sm.ratio(), 4)))
    print(f"  ===== {name} =====")
    for r in rows:
        if len(r) == 4:
            t, la, lb, ratio = r
            mark = "  <<< closest" if ratio == max(x[3] for x in rows if len(x) == 4) else ""
            print(f"    {t:<24} {la:>7}B -> {lb:>7}B   similarity={ratio}{mark}")
        else:
            print(f"    {r[0]:<24} missing in one of them")
    print()

    # and the closest pair, line by line
    valid = [r for r in rows if len(r) == 4]
    if not valid:
        return
    best = max(valid, key=lambda r: r[3])
    a = text_of(best[0], name)
    b = text_of(clone, name)
    print(f"  --- {best[0]} vs {clone}, line by line ---")
    diff = list(difflib.unified_diff(a.split("\n"), b.split("\n"),
                                     fromfile=best[0], tofile=clone, lineterm="", n=1))
    if not diff:
        print("    IDENTICAL")
    for line in diff[:60]:
        print(f"    {line[:110]}")
    print()


for name in ("NodeProperties.xml", "pouReserve.prs"):
    compare(name)
