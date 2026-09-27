"""Read AdeObjectType's members out of the type library.

GetObjectByLogicalName takes (string, AdeObjectType) and the enum's values are what the probes
have been guessing at. A type library stores its names as plain strings and its enum values as
integers in the type-info records, so both can be read without a TLB reader: pull the printable
strings, find the one that says AdeObjectType, and print its neighbourhood. Enum members are
typically stored together and in declaration order, which also gives the values when the order
starts at zero.

The same trick answers the other question this round has: the shape of a LOGICAL NAME, because
whatever the application builds those from is named somewhere in the library too.
"""
import re
import sys
from pathlib import Path


def printable_runs(raw: bytes, minimum: int = 3):
    """Every run of printable bytes, with its offset."""
    out = []
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % minimum, raw):
        out.append((m.start(), m.group(0).decode("ascii", "replace")))
    return out


def main() -> int:
    path = Path(sys.argv[1])
    raw = path.read_bytes()
    runs = printable_runs(raw)
    print(f"  {path.name}: {len(raw)} bytes, {len(runs)} printable runs")

    for term in ("AdeObjectType", "GetObjectByLogicalName", "ImportExport", "LogicalName"):
        idx = [i for i, (_, s) in enumerate(runs) if term in s]
        print(f"\n  {'=' * 70}\n  {term}: {len(idx)} occurrence(s)")
        for i in idx[:2]:
            lo, hi = max(0, i - 4), min(len(runs), i + 40)
            print(f"  --- around run {i} ---")
            for (off, s) in runs[lo:hi]:
                mark = " <<<" if term in s else ""
                print(f"    @{off:>7}  {s[:88]!r}{mark}")

    # Names that look like enum members: short identifiers, capitalised, no path separators.
    print(f"\n  {'=' * 70}\n  identifier-shaped names near the top of the library")
    seen = set()
    for _off, s in runs[:2000]:
        for tok in re.findall(r"\b[A-Z][A-Za-z]{3,24}\b", s):
            if tok not in seen:
                seen.add(tok)
    interesting = sorted(t for t in seen if re.search(r"(?i)object|type|pou|task|resource|config|name|node|sheet", t))
    print(f"    {len(interesting)} candidates:")
    for t in interesting[:70]:
        print(f"      {t}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
