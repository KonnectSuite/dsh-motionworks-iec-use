"""Calibrate the compiler against code the VENDOR compiler already accepts.

The problem this solves. ironplc rejected a POU body that MotionWorks compiles clean:

    CASE iState OF
        INT#0:                  <- a typed literal as a CASE label
            ...

That is legal MotionWorks ST and a dialect difference, not an error. A checker that refuses code the
vendor compiler accepts is worse than no checker, because it blocks work that is fine - and it did:
four capability-matrix operations began throwing.

The principle. This project's POU bodies COMPILE. So any diagnostic ironplc raises against them is
wrong about this codebase. Measure which codes those are, and treat only the rest as trustworthy.
That is not a guess about ironplc's quality; it is a measurement of its agreement with the compiler
that actually matters, on the code that actually has to build.

The output is a set of codes to IGNORE, derived from evidence, and a set that remains - which is what
a caller can safely act on.
"""
import sys
from collections import Counter
from pathlib import Path

SRC = Path(r"C:\Users\KNPhu\OneDrive\Documents\deepseek-harness\default-workspace\motionworks-iec-use")
INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
sys.path.insert(0, str(SRC / "code" / "engine"))
from motionworks_iec_mcp import iec  # noqa: E402
from motionworks_iec_mcp import project as P  # noqa: E402

ROOT = INST / "stage" / "TopCutter"
proj = P.Project(root=ROOT)

seen: Counter = Counter()
per_pou: list[tuple[str, int, list[str]]] = []
total = 0

for pou in proj.pous():
    try:
        body = pou.st_body()
    except Exception:
        body = ""
    if not body:
        continue
    total += 1
    try:
        table = pou.declarations()
    except Exception:
        continue
    source = iec.build_source(pou.name, table, body)
    found = iec.check_source(source)
    if found is None:
        print("  compiler unavailable")
        break
    real = [d for d in found if not d.vendor_type]
    codes = sorted({d.code for d in real})
    for c in codes:
        seen[c] += 1
    per_pou.append((pou.name, len(real), codes))

print(f"  POUs with a body that the IDE compiles: {total}\n")
print("  POU                          diagnostics   codes the vendor compiler disagrees with")
print("  " + "-" * 88)
for name, n, codes in per_pou:
    print(f"  {name:<28} {n:>11}   {', '.join(codes) if codes else '(none)'}")

print("\n  every code that fired on code the IDE accepts:")
if not seen:
    print("    (none - ironplc agrees with the vendor compiler on this project)")
for code, n in seen.most_common():
    print(f"    {code:<8} fired on {n} of {total} POUs")

print("\n  a code that fires on code the IDE compiles CANNOT be used to refuse a write.")
