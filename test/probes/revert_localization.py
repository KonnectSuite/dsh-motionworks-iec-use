#!/usr/bin/env python3
"""Test the localization hypothesis EXACTLY - by line number and by record, never by pattern.

Round 51 tried to revert the localization and failed to test anything: it replaced every ``VAR``
line in the text with ``VAR_EXTERNAL``, including the legitimate blocks, and the writer rejected the
result. That said nothing about localization.

The precise method: the localizer changes exactly two things, and both are enumerable.

    TEXT   the two lines that read 'VAR_EXTERNAL' in the template now read 'VAR' - at 1-based
           line 4 and line 23, measured in round 43 and again in round 49
    GRID   five records whose declarations are project globals move from usage 5 to usage 1 and
           their 0xFFFFFFFF trailing marker is zeroed

Reverting those FIVE RECORDS AND TWO LINES and nothing else makes the clone identical to its
template except for its own name, which is the strongest form of the experiment: clone + append
versus template + append, differing only in the name.

    ARM 1  revert the localization, then append    -> if it compiles, localization is the trigger
    ARM 2  keep the localization, then append      -> the known failure, as the control
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
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402
from motionworks_iec_mcp import pou_writer as PW        # noqa: E402

# The declarations the template declares VAR_EXTERNAL. Restoring the section header for a block
# only makes sense for a block whose every member is one of these.
TEMPLATE_EXTERNALS = {
    "TopCutterCamTableID", "TopCutterCamReady", "TopCutterCamError",
    "TopCutterCamErrorID", "TopCutterEyeToKnifeDistance",
}

HEAD = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = m.__internals.defineTools().map(t => [t.name, t]);
const map = new Map(tools);
const run = (n, a = {}) => map.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
'''


def run_js(body: str, timeout: int = 420) -> str:
    script = INST / "test" / "_rev52.mjs"
    script.write_text(HEAD + body + "\ntry { await m.__internals.verb('stop', {}, 8000); } catch {}\n",
                      encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    try:
        r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True,
                           env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "TIMED OUT"
    out = (r.stdout or "").strip()
    if r.stderr.strip():
        out += "\n  stderr: " + r.stderr.strip().split("\n")[0][:150]
    return out


def revert_localization(pou: str) -> str:
    """Undo exactly what localize_variable_grid did - five records and the two block headers."""
    src = STAGE / "POE" / pou / "src.st1"
    cf = CompoundFile(src)
    vb = next(n for n in cf.stream_names() if n.endswith("V.VB"))
    vg = next(n for n in cf.stream_names() if n.endswith("V.VGR"))

    raw = bytearray(cf.read_stream(vg))
    restored, rows = 0, []
    off = 12
    while off + 24 <= len(raw):
        h, u, g, f, row, ff = struct.unpack_from("<6I", raw, off)
        if not (1000 <= h <= 99999 and u in (1, 5, 0x00040001) and g == 1 and f == 0):
            break
        tail = PW._record_tail_offset(raw, off)
        if tail is None:
            break
        cur, strs = off + 24, []
        for _ in range(4):
            n = struct.unpack_from("<I", raw, cur)[0]
            strs.append(raw[cur + 4:cur + 4 + n].decode("utf-16-le", "replace").rstrip("\x00"))
            cur += 4 + n
        name = strs[3] if len(strs) > 3 else ""
        if name in TEMPLATE_EXTERNALS and u == 1:
            struct.pack_into("<I", raw, off + 4, 5)                 # usage back to external
            struct.pack_into("<I", raw, tail + 8, 0xFFFFFFFF)       # marker back to external
            restored += 1
            rows.append(row)
        off = tail + 16

    # The TEXT: set the block header back to VAR_EXTERNAL for the block containing each restored
    # row, found by walking upwards from the row to the nearest VAR/VAR_EXTERNAL line. No pattern
    # replacement anywhere.
    text = cf.read_stream(vb).decode("latin1")
    lines = text.split("\n")
    fixed = 0
    for row in rows:
        i = row - 1                      # rows are 1-based line numbers
        while i >= 0:
            s = lines[i].strip()
            if s in ("VAR", "VAR_EXTERNAL", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_GLOBAL"):
                if s == "VAR":
                    lines[i] = lines[i].replace("VAR", "VAR_EXTERNAL", 1)
                    fixed += 1
                break
            i -= 1

    cf.replace_streams({vb: "\n".join(lines).encode("latin1"), vg: bytes(raw)})
    return f"reverted {restored} grid record(s) to external, {fixed} block header(s) to VAR_EXTERNAL"


def facts(pou: str) -> str:
    p = STAGE / "POE" / pou / "src.st1"
    if not p.is_file():
        return "no dir"
    try:
        cf = CompoundFile(p)
        vb = next(n for n in cf.stream_names() if n.endswith("V.VB"))
        vg = next(n for n in cf.stream_names() if n.endswith("V.VGR"))
        t = cf.read_stream(vb).decode("latin1")
        g = cf.read_stream(vg)
        declared = struct.unpack_from("<I", g, 8)[0] if len(g) > 12 else "?"
        return (f".VB={len(t)}B ext={t.count('VAR_EXTERNAL')} "
                f".VGR={len(g)}B declares={declared}")
    except Exception as e:
        return f"unreadable: {e}"


SETUP = '''
try { await run("mw_ide_close"); } catch {}
const fs = await import("node:fs");
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_code_pou_create", { name: "POUNAME", template: "TopCutterCamSetup", dry_run: false });
console.log("  created POUNAME");
'''

APPEND = '''
await run("mw_ide_close");
const a = await run("mw_code_var_add", { pou: "POUNAME", name: "nArm", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add: applied=" + (a.result?.applied ?? false));
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_code_pou_assign", { task: "SlowTsk", pou: "POUNAME", dry_run: false });
const b = await run("mw_ide_build");
console.log(`  BUILD: is_compiled=${b.is_compiled} stalled=${b.stalled}`);
'''


def arm(label: str, pou: str, revert: bool) -> None:
    print(f"\n  ===== {label} =====")
    print(run_js(SETUP.replace("POUNAME", pou)))
    print(f"  after create: {facts(pou)}")
    if revert:
        path = STAGE / "POE" / pou / "src.st1"
        if path.is_file():
            print(f"  {revert_localization(pou)}")
            print(f"  reverted   : {facts(pou)}")
    print(run_js(APPEND.replace("POUNAME", pou)))
    print(f"  after build: {facts(pou)}")


def main() -> int:
    print(f"  template for comparison: {facts('TopCutterCamSetup')}")
    arm("ARM 1. localization REVERTED (record by record), then append", "ZzRev52", revert=True)
    arm("ARM 2. localization KEPT - the known failure, as control", "ZzKeep52", revert=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
