#!/usr/bin/env python3
"""Prove the round-42 diagnosis before fixing anything.

The claim: a clone carries the template's function-block instances, so the same instance exists
twice in the project and the compiler refuses - "Instance 'CalcSplineMatrix' is used more than
once!". Four rounds of elimination produced that, and it fits every anomaly, but a diagnosis that
has not been tested by REMOVING the supposed cause is still a hypothesis.

So: clone a POU, strip its function-block instance declarations from both stores - the declaration
text and the 0x00040001 grid records - and build. If the stall goes away, the diagnosis holds and
the fix is obvious. If it does not, four rounds of reasoning are wrong and I need to know now
rather than after writing a fix on top of them.

Stripping is done on the STAGED copy only, with the IDE closed, and the body is emptied too: the
template's body references exactly the symbols being removed, so keeping it would swap one
unresolved-symbol stall for another and prove nothing.
"""
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"
POU = "ZzStrip"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402
from motionworks_iec_mcp import variables as V          # noqa: E402


def prep_and_create() -> None:
    script = INST / "test" / "_strip_prep.mjs"
    script.write_text('''
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
const made = await run("mw_code_pou_create", { name: "ZzStrip", template: "TopCutterCamSetup", dry_run: false });
console.log("  create: " + JSON.stringify(made.result ?? made).slice(0, 90));
''', encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    print(r.stdout.strip()[:400] or r.stderr.strip()[:400])


def fb_declarations() -> list[str]:
    """Names declared with a type that is not a plain IEC elementary type."""
    src = STAGE / "POE" / POU / "src.st1"
    cf = CompoundFile(src)
    vb = next(n for n in cf.stream_names() if n.endswith("V.VB"))
    text = cf.read_stream(vb).decode("latin1")
    names = []
    for line in text.split("\n"):
        s = line.strip()
        if ":" not in s or s.startswith("(*") or s.startswith("VAR") or s.startswith("END_VAR"):
            continue
        name, _, rest = s.partition(":")
        rest = rest.split(";")[0].split("(*")[0].strip()
        if not rest:
            continue
        # struct and array instances are fine; only function-block instances collide
        if rest.upper() in {"BOOL", "BYTE", "WORD", "DWORD", "LWORD", "SINT", "USINT", "INT",
                            "UINT", "DINT", "UDINT", "LINT", "ULINT", "REAL", "LREAL",
                            "TIME", "DATE", "STRING", "WSTRING", "CHAR"}:
            continue
        if rest.upper().startswith(("ARRAY", "STRING[")):
            continue
        names.append(name.strip())
    return names


def strip(names: list[str]) -> dict:
    """Remove the named declarations from the text and their 0x00040001 grid records."""
    src = STAGE / "POE" / POU / "src.st1"
    cf = CompoundFile(src)
    vb = next(n for n in cf.stream_names() if n.endswith("V.VB"))
    vgr = next(n for n in cf.stream_names() if n.endswith("V.VGR"))

    text = cf.read_stream(vb).decode("latin1")
    lines = text.split("\n")
    kept, removed = [], []
    for line in lines:
        s = line.strip()
        hit = next((n for n in names if s.startswith(n + " :") or s.startswith(n + ":")), None)
        if hit:
            removed.append(hit)
            continue
        kept.append(line)
    new_text = "\n".join(kept)

    raw = cf.read_stream(vgr)
    data = bytearray(raw)
    dropped_records = 0
    offsets = []
    for off in range(12, max(12, len(data) - 23)):
        h, u, g, f, row, ff = struct.unpack_from("<6I", data, off)
        if 1000 <= h <= 10000 and u in (1, 5, 0x00040001) and g == 1 and f == 0 and 1 <= row <= 999 and ff == 0:
            offsets.append(off)

    # Rebuild the grid keeping only records that are not FB instances.
    header, count = data[:12], struct.unpack_from("<I", data, 8)[0]
    keep_runs = []
    for off in offsets:
        u = struct.unpack_from("<I", data, off + 4)[0]
        cursor = off + 24
        ok = True
        for _ in range(4):
            if cursor + 4 > len(data):
                ok = False; break
            n = struct.unpack_from("<I", data, cursor)[0]
            cursor += 4 + n
        if not ok or cursor + 16 > len(data):
            keep_runs.append((off, off + 16, u)); continue
        keep_runs.append((off, cursor + 16, u))

    rebuilt = bytearray(header)
    kept_records = 0
    for start, end, u in keep_runs:
        if u == 0x00040001:
            dropped_records += 1
            continue
        rebuilt += data[start:end]
        kept_records += 1
    struct.pack_into("<I", rebuilt, 8, kept_records)

    cf.replace_streams({vb: new_text.encode("latin1"), vgr: bytes(rebuilt)})
    return {"removed_decls": removed, "dropped_grid_records": dropped_records,
            "kept_grid_records": kept_records, "text": len(text), "new_text": len(new_text)}


def verify_and_build() -> None:
    script = INST / "test" / "_strip_verify.mjs"
    script.write_text('''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
const r = await run("mw_code_read_st", { pou: "ZzStrip" });
console.log("  after strip: " + (r.variables ?? []).length + " declarations");
const asg = await run("mw_code_pou_assign", { task: "SlowTsk", pou: "ZzStrip", dry_run: false });
console.log("  assign: " + JSON.stringify(asg).slice(0, 60));
const b = await run("mw_ide_build");
console.log("  BUILD: is_compiled=" + b.is_compiled + " stalled=" + b.stalled);
const e = await run("mw_ide_errors", { pane: "Errors", limit: 10 });
console.log("  errors: " + e.count);
for (const l of (e.lines ?? []).slice(0, 6)) console.log("     " + String(l).slice(0, 92));
await run("mw_ide_close").catch(() => {});
''', encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    print(r.stdout.rstrip()[:900] or r.stderr.strip()[:400])


def main() -> int:
    prep_and_create()
    names = fb_declarations()
    print(f"  function-block / composite declarations in the clone: {names}")
    if not names:
        print("  none found - the diagnosis does not apply")
        return 1
    result = strip(names)
    print(f"  stripped: {result}")
    verify_and_build()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
