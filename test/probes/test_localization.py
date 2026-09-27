#!/usr/bin/env python3
"""Is the LOCALIZATION the thing that breaks an append?

Ten rounds have eliminated everything else. The facts, all measured:

    template POU + add a declaration     builds clean
    clone      + no add                  builds clean
    clone      + add a declaration       the compiler CRASHES during "Compiling variables"
                                         (.VB -> 0 bytes, .VGR -> 79 MB)

and the clone differs from the template in exactly two places: the declaration text has
VAR_EXTERNAL renamed to VAR, and the grid has five records moved from usage 5 to usage 1 with their
0xFFFFFFFF markers zeroed. Round 40 proved that move was half-applied before the fix - usage moved
but the marker did not - and the fix made both move together, which is correct for a LOCAL variable.

But the normal POU is not localized at all, and it accepts an append. So the hypothesis this round
tests is: LOCALIZED GRID + APPEND = CRASH, independent of anything else about clones.

THE TEST. Create a clone, then put it back the way the template is - restore the five grid records
to usage 5 WITH their 0xFFFFFFFF markers, and rename VAR back to VAR_EXTERNAL in the text - so the
clone becomes a faithful copy of the template that merely has a different name. Then append a
declaration and build.

    if it compiles   -> the localization is the trigger, and the fix is to stop localizing
    if it crashes    -> the clone is different in some way still not identified

A third arm keeps the localization in place and appends, as the control that reproduces the known
failure, so a pass in the first arm cannot be a fluke of this run.
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
from motionworks_iec_mcp.cfb import CompoundFile          # noqa: E402
from motionworks_iec_mcp import pou_writer as PW          # noqa: E402

HEAD = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
'''


def run(body: str, stop: bool = True, timeout: int = 420) -> str:
    script = INST / "test" / "_loc51.mjs"
    script.write_text(HEAD + body + ("\ntry { await m.__internals.verb('stop', {}, 8000); } catch {}\n"
                                     if stop else ""), encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    try:
        r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True,
                           env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "TIMED OUT"
    out = (r.stdout or "").strip()
    if r.stderr.strip():
        out += "\n  stderr: " + r.stderr.strip().split("\n")[0][:130]
    return out


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


def unlocalize(pou: str) -> str:
    """Put the grid records back to usage 5 with their markers, and the text back to VAR_EXTERNAL."""
    src = STAGE / "POE" / pou / "src.st1"
    cf = CompoundFile(src)
    vb = next(n for n in cf.stream_names() if n.endswith("V.VB"))
    vg = next(n for n in cf.stream_names() if n.endswith("V.VGR"))

    raw = bytearray(cf.read_stream(vg))
    offsets, off = [], 12
    while off + 24 <= len(raw):
        h, u, g, f, row, ff = struct.unpack_from("<6I", raw, off)
        if not (1000 <= h <= 99999 and u in (1, 5, 0x00040001) and g == 1 and f == 0):
            break
        tail = PW._record_tail_offset(raw, off)
        if tail is None:
            break
        offsets.append((off, tail))
        off = tail + 16
    restored = 0
    for o, tail in offsets:
        u = struct.unpack_from("<I", raw, o + 4)[0]
        if u == 5 or (u == 1 and struct.unpack_from("<I", raw, tail + 8)[0] == 0):
            # only touch the records that USED to be external: those whose declaration is a
            # global. Restore usage and marker together, exactly as the localizer moved them.
            pass
    # Simpler and exact: the localizer moved N records from 5 to 1. Move the first N back.
    externals = 0
    for o, tail in offsets:
        if struct.unpack_from("<I", raw, o + 4)[0] == 1 and row_is_global(raw, o, tail):
            struct.pack_into("<I", raw, o + 4, 5)
            struct.pack_into("<I", raw, tail + 8, 0xFFFFFFFF)
            externals += 1

    text = cf.read_stream(vb).decode("latin1")
    text = text.replace("VAR\r\n", "VAR_EXTERNAL\r\n")
    cf.replace_streams({vb: text.encode("latin1"), vg: bytes(raw)})
    return f"restored {externals} record(s) to external"


def row_is_global(raw: bytes, off: int, tail: int) -> bool:
    """A record whose name matches one of the template's VAR_EXTERNAL declarations."""
    try:
        cur, strs = off + 24, []
        for _ in range(4):
            n = struct.unpack_from("<I", raw, cur)[0]
            strs.append(raw[cur + 4:cur + 4 + n].decode("utf-16-le", "replace").rstrip("\x00"))
            cur += 4 + n
        return strs[3] in ("TopCutterCamTableID", "TopCutterCamReady", "TopCutterCamError",
                           "TopCutterCamErrorID", "TopCutterEyeToKnifeDistance")
    except Exception:
        return False


def sizes(pou: str) -> str:
    p = STAGE / "POE" / pou / "src.st1"
    if not p.is_file():
        return "no dir"
    try:
        cf = CompoundFile(p)
        vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
        vg = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
        return f".VB={len(cf.read_stream(vb))}B .VGR={len(cf.read_stream(vg))}B"
    except Exception as e:
        return f"unreadable: {e}"


APPEND_AND_BUILD = '''
await run("mw_ide_close");
const a = await run("mw_code_var_add", { pou: "POUNAME", name: "nArm", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add: applied=" + (a.result?.applied ?? false));
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_code_pou_assign", { task: "SlowTsk", pou: "POUNAME", dry_run: false });
const b = await run("mw_ide_build");
console.log(`  BUILD: is_compiled=${b.is_compiled} stalled=${b.stalled}`);
'''


def arm(label: str, pou: str, restore: bool) -> None:
    print(f"\n  ===== {label} =====")
    print(run(SETUP.replace("POUNAME", pou)))
    if restore:
        path = STAGE / "POE" / pou / "src.st1"
        if path.is_file():
            print(f"  {unlocalize(pou)}")
            print(f"  before add: {sizes(pou)}")
    print(run(APPEND_AND_BUILD.replace("POUNAME", pou)))
    print(f"  after build: {sizes(pou)}")


def main() -> int:
    arm("ARM 1. localization REVERTED, then append", "ZzUnloc", restore=True)
    arm("ARM 2. localization KEPT (the known failure)", "ZzLoc", restore=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
