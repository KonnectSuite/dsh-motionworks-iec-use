#!/usr/bin/env python3
"""Read the IDE's BUILD LOG while the build is failing.

Round 47 pinned the timing: the POU is valid through the create, the add and a full reopen -
.VB=1113B, .VGR=1645B, 13 declarations readable from disk - and is destroyed only when the ASSIGNED
POU IS COMPILED, ending at .VB=0B and .VGR=79,432,063B. So the build fails for a reason, and that
failure is what damages the files. Round 24 saw the same thing from the other side: a failed build
truncated NODES.LST from 802 to 499 bytes.

Every attempt so far has read the ERRORS pane, which for this failure is empty - the stall signature.
But the bridge also has read_output, which reads the IDE's Message Window, and that is a different
pane with the compiler's own log rather than the error list. It has never been read during this
failure.

So: reproduce the sequence, and read every output pane the bridge offers BEFORE and AFTER the build,
plus the Errors and Build panes, and compare. If the compiler says why, it will be here.
"""
import os
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"
POU = "ZzLog48"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402

HEAD = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
'''
TAIL = "\ntry { await m.__internals.verb('stop', {}, 8000); } catch {}\n"


def step(body: str, timeout: int = 420) -> str:
    script = INST / "test" / "_log48.mjs"
    script.write_text(HEAD + body + TAIL, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    try:
        r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True,
                           env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "TIMED OUT"
    out = (r.stdout or "").strip()
    if r.stderr.strip():
        out += "\n  stderr: " + r.stderr.strip().split("\n")[0][:140]
    return out


def sizes() -> str:
    p = STAGE / "POE" / POU / "src.st1"
    if not p.is_file():
        return "no dir"
    cf = CompoundFile(p)
    vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    vg = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    if not vb or not vg:
        return "streams missing"
    return f".VB={len(cf.read_stream(vb))}B .VGR={len(cf.read_stream(vg))}B"


READ_ALL = '''
async function dumpPanes(tag) {
  for (const pane of ["Build", "Errors", "Warnings", "Infos"]) {
    try {
      const e = await run("mw_ide_errors", { pane, limit: 40 });
      const lines = (e.lines ?? []).map(String);
      console.log(`  [${tag}] ${pane}: ${e.count} line(s)`);
      for (const l of lines.slice(0, 10)) console.log("      " + l.slice(0, 118));
    } catch (err) { console.log(`  [${tag}] ${pane}: ${String(err.message).split("\\n")[0].slice(0,80)}`); }
  }
  try {
    const o = await m.__internals.verb("read_output", { limit: 60 }, 60000);
    console.log(`  [${tag}] Message Window: ` + JSON.stringify(o).slice(0, 700));
  } catch (err) { console.log(`  [${tag}] read_output: ` + String(err.message).split("\\n")[0].slice(0,100)); }
}
'''


def main() -> int:
    print("  ===== capturing the build log during the failure =====\n")

    print(step('''
try { await run("mw_ide_close"); } catch {}
const fs = await import("node:fs");
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_ide_close");
await run("mw_code_pou_create", { name: "POUNAME", template: "TopCutterCamSetup", dry_run: false });
await run("mw_code_var_add", { pou: "POUNAME", name: "nLog", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_code_pou_assign", { task: "SlowTsk", pou: "POUNAME", dry_run: false });
console.log("  prepared: created, declared, reopened, assigned");
'''.replace("POUNAME", POU)))
    print(f"  on disk before the build: {sizes()}\n")

    print("  --- panes BEFORE the build ---")
    print(step(READ_ALL + '\nawait dumpPanes("before");'))
    print()

    print("  --- the build, then the panes IMMEDIATELY after ---")
    print(step(READ_ALL + '''
const b = await run("mw_ide_build");
console.log(`  BUILD: is_compiled=${b.is_compiled} stalled=${b.stalled} mode=${b.mode ?? "-"}`);
await dumpPanes("after");
'''))
    print(f"\n  on disk after the build: {sizes()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
