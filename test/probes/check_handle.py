#!/usr/bin/env python3
"""What handle does the appended grid record get on a CLONED POU?

Round 48 established the failure is a compiler CRASH, not an error: the Build pane reads

    --------- Compiling variables --------
    TopCutterFFCamSetupV ... EIP_ToCLXV
    ZzLog48V
    Global_Variables

and then stops, with Errors, Warnings and Infos all empty, while the files become .VB=0B and
.VGR=79,432,063B. A runaway write, not a rejected declaration.

The clone's grid records carry the TEMPLATE's handles - 1047..1053, exactly the template's - and
handles are shared across POUs in this project anyway (1046 appears in both EIP_ToCLX and
TopCutterFFCamSetup), so duplication alone is not the fault. But the APPENDED record needs a new
handle, and if the writer derives it from something that does not account for a clone, the new
record could collide WITHIN the same grid - which is a different thing from two POUs sharing a
number, and is exactly the shape of thing a compiler would walk off the end of.

So: clone, add, and read the grid's own header - which declares the record count and the last
handle - plus every record's handle, BEFORE the build can touch anything.
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
CLONE, CONTROL = "ZzH48", "TopCutterCamSetup"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402


def run(body: str, timeout: int = 420) -> str:
    script = INST / "test" / "_h48.mjs"
    script.write_text(body, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    try:
        r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True,
                           env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "TIMED OUT"
    return (r.stdout or "").strip() + (
        ("\n  stderr: " + r.stderr.strip().split("\n")[0][:130]) if r.stderr.strip() else "")


def grid(pou: str) -> str:
    """Header plus every record's handle, using the tail offset rather than a fixed stride."""
    p = STAGE / "POE" / pou / "src.st1"
    if not p.is_file():
        return "  no dir"
    cf = CompoundFile(p)
    vg = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    if not vg:
        return "  no grid"
    raw = cf.read_stream(vg)
    if len(raw) < 12:
        return f"  grid {len(raw)}B (too short)"
    magic, last_handle, declared = struct.unpack_from("<3I", raw, 0)
    out = [f"  grid {len(raw)}B   last_handle={last_handle}   declares={declared}"]
    off, idx, handles = 12, 0, []
    while off + 24 <= len(raw) and idx <= declared + 2:
        try:
            h, u, g, f, row, ff = struct.unpack_from("<6I", raw, off)
        except struct.error:
            break
        if not (1000 <= h <= 99999 and g == 1 and f == 0):
            break
        cur, strs, ok = off + 24, [], True
        for _ in range(4):
            if cur + 4 > len(raw):
                ok = False; break
            n = struct.unpack_from("<I", raw, cur)[0]
            if n > 400 or cur + 4 + n > len(raw):
                ok = False; break
            strs.append(raw[cur + 4:cur + 4 + n].decode("utf-16-le", "replace").rstrip("\x00"))
            cur += 4 + n
        if not ok:
            break
        handles.append(h)
        out.append(f"    handle={h:<6} usage={u:<7} row={row:<4} {strs[3] if len(strs) > 3 else '?'}")
        # a scalar record's tail is 16 bytes; structs are longer, so stop if the next
        # candidate does not look like a record
        nxt = cur + 16
        if nxt + 24 > len(raw):
            break
        off = nxt
        idx += 1
    dupes = {h for h in handles if handles.count(h) > 1}
    out.append(f"    {len(handles)} walked, {len(set(handles))} distinct"
               + (f"   *** DUPLICATE HANDLES: {sorted(dupes)} ***" if dupes else ""))
    return "\n".join(out)


def main() -> int:
    print("  ===== clone, add, and read the grid BEFORE any build =====\n")
    print(run('''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
try { await run("mw_ide_close"); } catch {}
const fs = await import("node:fs");
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_code_pou_create", { name: "ZzH48", template: "TopCutterCamSetup", dry_run: false });
const a = await run("mw_code_var_add", { pou: "ZzH48", name: "n48", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add: applied=" + (a.result?.applied ?? false) + " " + (a.result?.before_bytes ?? "?") + " -> " + (a.result?.after_bytes ?? "?"));
try { await m.__internals.verb('stop', {}, 8000); } catch {}
'''))

    print(f"\n  --- the CLONE ({CLONE}) ---")
    print(grid(CLONE))
    print(f"\n  --- the TEMPLATE ({CONTROL}), for comparison ---")
    print(grid(CONTROL))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
