"""Compare a clone's sidecar files against its template's.

mw_code_pou_create copies the template's directory and renames the files and the streams. The
capability matrix proves adding a declaration to a NORMAL POU works, and round 40 proved it stalls
and then truncates the .VB on a CLONED one - so something the clone carries is not what the IDE
expects.

The sidecar files are the obvious suspects, and none of them has ever been examined:

    <POU>.CCI                   a binary file per POU
    NodeProperties.xml
    <POU>V.cfb
    <POU>Translation.xml, <POU>VTranslation.xml
    pouReserve.prs

A .CCI that still names the TEMPLATE would be exactly the sort of mismatch that makes an editor
accept a file and then refuse to keep it - the same shape as the tree, where the IDE parsed a
generated node, kept its marker and GUID, and rebuilt everything else.

This prints each file's size for both POUs and, for the text ones, whether they still mention the
template's name. Read-only.
"""
import os
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
POE = INST / "stage" / "TopCutter" / "POE"


def ascii_runs(raw: bytes, minimum: int = 4, limit: int = 14):
    import re
    out = []
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % minimum, raw):
        out.append(m.group(0).decode("ascii", "replace"))
        if len(out) >= limit:
            break
    return out


def describe(label: str, name: str) -> None:
    d = POE / name
    print(f"  ===== {label}: {name} =====")
    if not d.is_dir():
        print("    missing")
        return
    for f in sorted(d.iterdir()):
        if f.name == "src.st1":
            continue
        raw = f.read_bytes()
        mentions_template = b"TopCutterCamSetup" in raw
        mentions_self = name.encode() in raw
        flag = ""
        if mentions_template and name != "TopCutterCamSetup":
            flag = "   <<< STILL NAMES THE TEMPLATE"
        print(f"    {f.name:<34} {len(raw):>7}B  template={mentions_template} "
              f"self={mentions_self}{flag}")
    # the .CCI in particular, since it is the one nobody has looked at
    cci = d / f"{name}.CCI"
    if cci.is_file():
        raw = cci.read_bytes()
        print(f"    --- {cci.name} first 96 bytes ---")
        print(f"        {raw[:96].hex(' ')}")
        print(f"        runs: {ascii_runs(raw)[:8]}")
    print()


describe("TEMPLATE", "TopCutterCamSetup")
describe("CLONE", "ZzFix")
