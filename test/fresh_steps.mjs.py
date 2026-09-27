#!/usr/bin/env python3
"""Does the stale-App fix also cure create-then-declare?

Round 45 found Connect-App caching $script:App and serving the project it FIRST saw, which made
mutation verbs fail with errors naming the operation instead of the cause. Round 46 recorded the
consequence: every create-then-declare test in rounds 40 to 44 ran through a long-lived bridge
across many restages, and the failure was the IDE REWRITING files during a build. If a stale
Application reference reaches the IDE's own writes, then the landmine documented in round 44 - and
the description now telling agents NOT to add declarations to a created POU - may describe a bug
that no longer exists.

METHOD. Each step is its own node process, and each one ends by calling the bridge's own `stop`
verb, so the bridge is recreated for the next step and no cached COM object can survive. Nothing is
killed by process name - round 46 established that killing node or powershell by name takes out the
harness itself.

    create -> add a declaration -> reopen -> assign -> build

and the .VB and .VGR sizes are read from disk at every step, so a silent truncation cannot hide.

If the build is clean AND both streams are intact, the warning comes out of mw_code_pou_create.
If not, the warning stays and the problem is a real format issue rather than a stale handle.
"""
import os
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"
POU = "ZzFresh47"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile      # noqa: E402

HEAD = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\\\stage\\\\TopCutter`;
'''
TAIL = '''
try { await m.__internals.verb('stop', {}, 8000); } catch {}
'''


def step(label: str, body: str) -> str:
    """Run one step in its own process, then stop the bridge so the next starts fresh."""
    script = INST / "test" / "_step47.mjs"
    script.write_text(HEAD + body + TAIL, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    try:
        r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True,
                           env=env, timeout=420)
    except subprocess.TimeoutExpired:
        return f"  {label} -> TIMED OUT"
    out = (r.stdout or "").strip()
    if r.stderr.strip():
        out += "\n     stderr: " + r.stderr.strip().split("\n")[0][:130]
    return out or f"  {label} -> (no output)"


def sizes() -> str:
    p = STAGE / "POE" / POU / "src.st1"
    if not p.is_file():
        return "no dir"
    try:
        cf = CompoundFile(p)
        vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
        vg = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
        if not vb or not vg:
            return "streams missing"
        return f".VB={len(cf.read_stream(vb))}B  .VGR={len(cf.read_stream(vg))}B"
    except Exception as e:
        return f"unreadable: {e}"


def main() -> int:
    print("  ===== create-then-declare, bridge restarted at every step =====\n")

    print(step("setup", '''
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
const p = await run("mw_ide_pous");
console.log("  setup: staged and opened, POUs = " + (Array.isArray(p)?p:(p.pous??[])).length);
'''))

    print(step("create", '''
await run("mw_ide_close");
const made = await run("mw_code_pou_create", { name: "POUNAME", template: "TopCutterCamSetup", dry_run: false });
console.log("  create: " + JSON.stringify(made.result ?? made).slice(0, 80));
'''.replace("POUNAME", POU)))
    print(f"     on disk: {sizes()}")

    print(step("add", '''
const add = await run("mw_code_var_add", { pou: "POUNAME", name: "n47", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add: applied=" + (add.result?.applied ?? false) + "  " + (add.result?.before_bytes ?? "?") + " -> " + (add.result?.after_bytes ?? "?"));
'''.replace("POUNAME", POU)))
    print(f"     on disk: {sizes()}")

    print(step("reopen", '''
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
const r = await run("mw_code_read_st", { pou: "POUNAME" });
console.log("  reopen: " + (r.variables ?? []).length + " declarations, body " + (r.body ?? "").length + " chars");
'''.replace("POUNAME", POU)))
    print(f"     on disk: {sizes()}")

    print(step("assign+build", '''
const asg = await run("mw_code_pou_assign", { task: "SlowTsk", pou: "POUNAME", dry_run: false });
console.log("  assign: " + JSON.stringify(asg).slice(0, 70));
const b = await run("mw_ide_build");
console.log(`  BUILD: is_compiled=${b.is_compiled} stalled=${b.stalled}`);
'''.replace("POUNAME", POU)))
    print(f"     on disk: {sizes()}")

    print(step("final", '''
const r = await run("mw_code_read_st", { pou: "POUNAME" });
console.log("  final: " + (r.variables ?? []).length + " declarations");
const b = await run("mw_ide_build");
console.log(`  rebuild: is_compiled=${b.is_compiled}`);
await run("mw_ide_close").catch(() => {});
'''.replace("POUNAME", POU)))
    print(f"     on disk: {sizes()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
