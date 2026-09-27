#!/usr/bin/env python3
"""Create a clone, then compare its PROJECT.TRE nodes against the template's.

Rounds 40 and 41 narrowed this to one question: a declaration added to a CLONED POU truncates the
.VB on the next open, while the same add to an existing POU survives. Everything else has been
eliminated by measurement - the four streams match, the grid localizes correctly, every sidecar
file matches, and the clone builds clean until a declaration is added.

What has NOT been compared is the clone's own TREE NODES against the template's. The create adds
four nodes (node_ids 58..61) and the tree is where this project has been bitten before: a
generated node the IDE parsed, kept its marker and GUID, and rebuilt everything else around.

So: create a POU, then dump both POUs' nodes field by field from PROJECT.TRE and diff them. The
template's nodes were written by the IDE and are known good; if the clone's differ in any field
other than the name, that difference is the answer.

Run:  python create_and_diff_nodes.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"
POU = "ZzNodes"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile            # noqa: E402


def read_tree() -> list[str]:
    return (CompoundFile(STAGE / "src.st1")
            .read_stream("PROJECT.TRE").decode("latin1").splitlines())


def nodes_for(lines: list[str], needle: str) -> list[tuple[int, list[str]]]:
    """Every node block whose name or path mentions `needle`, as (index, lines)."""
    out = []
    for i, line in enumerate(lines):
        fields = line.split("\t")[0].split()
        if len(fields) == 4 and fields[0].isdigit() and fields[1].isdigit():
            name = lines[i + 1].split("\t")[0] if i + 1 < len(lines) else ""
            path = lines[i + 2].split("\t")[0] if i + 2 < len(lines) else ""
            if needle.lower() in name.lower() or needle.lower() in path.lower():
                # the block starts at the MARKER line, one above the id line matched here
                start = i - 1 if i > 0 else i
                block = lines[start:start + 9]
                if start + 9 <= len(lines):
                    out.append((start + 1, block))
    return out


def prep() -> None:
    """Fresh stage and one created POU, through the plugin so the IDE is in a known state."""
    script = INST / "test" / "_prep_nodes.mjs"
    script.write_text(
        'const P = process.env.MW_PLUGIN;\n'
        'const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);\n'
        'const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));\n'
        'const run = (n, a = {}) => tools.get(n).execute(a, {});\n'
        'const fs = await import("node:fs");\n'
        'const DIR = `${P}\\\\stage\\\\TopCutter`;\n'
        'try { await run("mw_ide_close"); } catch {}\n'
        'for (let i = 0; i < 10; i++) {\n'
        '  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }\n'
        '  catch { await new Promise(r => setTimeout(r, 1500)); }\n'
        '}\n'
        'await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });\n'
        'await run("mw_ide_close");\n'
        f'const made = await run("mw_code_pou_create", '
        f'{{ name: "{POU}", template: "TopCutterCamSetup", dry_run: false }});\n'
        'console.log("  created:", JSON.stringify(made.result ?? made).slice(0, 200));\n',
        encoding="utf-8")
    import os
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    print(r.stdout.strip() or r.stderr.strip()[:400])


def main() -> int:
    if "--no-prep" not in sys.argv:
        prep()

    lines = read_tree()
    print(f"  PROJECT.TRE: {len(lines)} lines, node total {lines[1] if len(lines) > 1 else '?'}")
    print()

    tmpl = nodes_for(lines, "TopCutterCamSetup")
    clone = nodes_for(lines, POU)
    print(f"  template nodes: {len(tmpl)}    clone nodes: {len(clone)}")
    print()

    for label, group in (("TEMPLATE (IDE-written)", tmpl), ("CLONE (plugin-created)", clone)):
        print(f"  ===== {label} =====")
        for idx, block in group:
            print(f"    --- node at line {idx} ---")
            for j, l in enumerate(block):
                label2 = ["marker", "id/level/kids/flags", "name", "path",
                          "blank", "state", "blank", "guid", "state"][j] if j < 9 else str(j)
                print(f"      {label2:<22} {l[:96]!r}")
        print()

    # field-by-field, position by position
    print("  ===== positional comparison =====")
    n = min(len(tmpl), len(clone))
    for k in range(n):
        ti, tb = tmpl[k]
        ci, cb = clone[k]
        diffs = []
        for j in range(min(len(tb), len(cb))):
            a, b = tb[j].split("\t")[0], cb[j].split("\t")[0]
            if a != b:
                diffs.append((j, a, b))
        print(f"    node {k}: {len(diffs)} differing line(s)")
        for j, a, b in diffs:
            print(f"      line {j}: {a[:70]!r}")
            print(f"           -> {b[:70]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
