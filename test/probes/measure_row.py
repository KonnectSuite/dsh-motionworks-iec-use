#!/usr/bin/env python3
"""Measure the grid the instant after the ADD, before the IDE can open the project.

Round 43's isolation showed the sequence precisely:

    clone, assign, build                    is_compiled=true   clean
    clone, empty body, assign, build        is_compiled=true   clean
    clone, ADD one declaration, assign      is_compiled=false  stalled
      and after the IDE had opened it:      .VB = 0 bytes,  grid = 79 MB

So the add itself leaves a grid the IDE then destroys on open. The 79 MB figure is the one this
project first saw when a record was appended out of ROW order, and round 40's localizer fix does
not explain it because the localizer runs at CREATE time, not at ADD time.

Everything therefore points at the record the add appends. A grid record's `row` is the 1-based
line number of its declaration in the .VB - that was established in round 26 and it is what makes
grid writes work at all - so the question is whether the appended record's row matches where the
declaration actually landed.

This clones, adds, and measures the grid with the IDE CLOSED, so the numbers are the writer's and
not the IDE's reaction to them. It prints every record's row against the line its name occupies,
for the clone and for a normal POU, and reports the first disagreement.
"""
import os
import struct
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile      # noqa: E402

CLONE = "ZzRow"

PREP = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const fs = await import("node:fs");
const DIR = `${P}\\\\stage\\\\TopCutter`;
try { await run("mw_ide_close"); } catch {}
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_code_pou_create", { name: "ZzRow", template: "TopCutterCamSetup", dry_run: false });
// add while the IDE is still closed, so nothing can rewrite the result
const a = await run("mw_code_var_add", { pou: "ZzRow", name: "nAppended", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add applied=" + (a.result?.applied ?? false) + " bytes " + (a.result?.before_bytes ?? "?") + " -> " + (a.result?.after_bytes ?? "?"));
const b = await run("mw_code_var_add", { pou: "TopCutterCamSetup", name: "nAppended2", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  control add applied=" + (b.result?.applied ?? false));
'''


def run_prep() -> None:
    script = INST / "test" / "_row_prep.mjs"
    script.write_text(PREP, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    print(r.stdout.strip()[:400] or r.stderr.strip()[:400])


def measure(pou: str, needle: str) -> None:
    src = STAGE / "POE" / pou / "src.st1"
    if not src.is_file():
        print(f"  {pou}: missing")
        return
    cf = CompoundFile(src)
    vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    vgr = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    text = cf.read_stream(vb).decode("latin1")
    lines = text.split("\n")
    print(f"  ===== {pou} =====")
    print(f"    .VB {len(text)}B, {len(lines)} lines")

    line_of = {}
    for i, l in enumerate(lines):
        s = l.strip()
        if ":" in s and not s.startswith(("(*", "VAR", "END_VAR", "//")):
            nm = s.split(":")[0].strip()
            if nm:
                line_of[nm] = i + 1

    raw = cf.read_stream(vgr)
    declared = struct.unpack_from("<I", raw, 8)[0]
    print(f"    grid {len(raw)}B, declares {declared} record(s)")
    off, idx, bad = 12, 0, []
    while off + 24 <= len(raw) and idx <= declared + 1:
        h, u, g, f, row, ff = struct.unpack_from("<6I", raw, off)
        if not (1000 <= h <= 10000 and g == 1 and f == 0):
            break
        cur = off + 24
        strs = []
        try:
            for _ in range(4):
                n = struct.unpack_from("<I", raw, cur)[0]
                strs.append(raw[cur + 4:cur + 4 + n].decode("utf-16-le", "replace").rstrip("\x00"))
                cur += 4 + n
        except Exception:
            break
        name = strs[3]
        actual = line_of.get(name)
        flag = ""
        if actual is not None and actual != row:
            flag = f"   <<< row says {row}, name is on line {actual}"
            bad.append((name, row, actual))
        if needle in name or flag:
            print(f"      [{idx:>2}] row={row:<5} {name:<18} at line {actual}{flag}")
        off = cur + 16
        idx += 1
    print(f"    records walked: {idx}")
    if bad:
        print(f"    *** {len(bad)} record(s) disagree with the text ***")
    else:
        print("    every record's row matches the line its name is on")
    print()


def main() -> int:
    run_prep()
    print()
    measure(CLONE, "nAppended")
    measure("TopCutterCamSetup", "nAppended2")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
