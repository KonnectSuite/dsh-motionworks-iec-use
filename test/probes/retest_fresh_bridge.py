#!/usr/bin/env python3
"""Re-test create-then-declare with the bridge restarted at every step.

Round 45 found that Connect-App caches $script:App and serves the project it FIRST saw. Across a
session that stages and reopens a project repeatedly, that cache goes stale and mutation verbs fail
with errors that name the operation instead of the cause - the same class of bug that made round 37
chase "unknown verb" for verbs plainly present in the bridge file.

Every create-then-declare test in rounds 40 to 44 ran through a long-lived bridge across many
re-stages. If a stale Application reference also affects what the IDE does to the project on open -
and the failure was precisely the IDE rewriting files during a build - then the "landmine"
documented in round 44 may have been the plumbing, not the format.

That is worth testing properly, because if it passes, six rounds of elimination were chasing a bug
that a cache fix already removed, and the tool description currently tells agents not to use a
feature that works.

The method: restart the bridge before EVERY plugin call, so no cached COM object can survive across
steps. Then run the sequence that failed -

    create -> add a declaration -> reopen -> assign -> build

- and check both that the build is clean and that the .VB is intact.
"""
import os
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")
STAGE = INST / "stage" / "TopCutter"

sys.path.insert(0, str(INST / "code" / "engine"))
from motionworks_iec_mcp.cfb import CompoundFile      # noqa: E402


def kill_bridge() -> None:
    """Stop only the bridge, leaving the IDE. A fresh one reconnects on the next call.

    Done through the bridge's OWN stop verb. An earlier version killed powershell.exe
    processes from a child shell whose $PID was the CHILD's, so it killed the session
    running it and produced no output at all.
    """
    script = INST / "test" / "_stopbridge.mjs"
    script.write_text(
        "const P = process.env.MW_PLUGIN;\n"
        "const m = await import(ile:///${P.replace(/\\\\/g, "/")}/index.js);\n"
        "try { await m.__internals.verb('stop', {}, 8000); } catch {}\n",
        encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST))
    subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env, timeout=60)
    for f in ("res.json", "req.json"):
        try:
            (INST / "bridge" / f).unlink()
        except OSError:
            pass


def run_js(body: str, fresh: bool) -> str:
    if fresh:
        kill_bridge()
    script = INST / "test" / "_freshstep.mjs"
    script.write_text(body, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env,
                       timeout=600)
    out = (r.stdout or "").strip()
    if r.stderr.strip():
        out += "\n     stderr: " + r.stderr.strip().split("\n")[0][:140]
    return out


HEAD = '''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const fs = await import("node:fs");
const DIR = `${P}\\\\stage\\\\TopCutter`;
'''


def vb_size(pou: str) -> str:
    p = STAGE / "POE" / pou / "src.st1"
    if not p.is_file():
        return "no dir"
    cf = CompoundFile(p)
    vb = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    vgr = next((n for n in cf.stream_names() if n.endswith("V.VGR")), None)
    return (f".VB={len(cf.read_stream(vb))}B .VGR={len(cf.read_stream(vgr))}B"
            if vb and vgr else "streams missing")


def main() -> int:
    fresh = "--stale" not in sys.argv      # --stale reproduces the old behaviour
    label = "STALE bridge (as rounds 40-44 ran)" if not fresh else "FRESH bridge at every step"
    print(f"  ===== {label} =====\n")

    print(run_js(HEAD + '''
try { await run("mw_ide_close"); } catch {}
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
console.log("  staged and opened");
''', fresh))

    print(run_js(HEAD + '''
await run("mw_ide_close");
const made = await run("mw_code_pou_create", { name: "ZzFresh", template: "TopCutterCamSetup", dry_run: false });
console.log("  create : " + JSON.stringify(made.result ?? made).slice(0, 70));
const add = await run("mw_code_var_add", { pou: "ZzFresh", name: "nAdded", type: "DINT", section: "VAR", initial_value: "0", dry_run: false });
console.log("  add    : applied=" + (add.result?.applied ?? false) + " " + (add.result?.before_bytes ?? "?") + " -> " + (add.result?.after_bytes ?? "?"));
''', fresh))
    print(f"  on disk after the add: {vb_size('ZzFresh')}")

    print(run_js(HEAD + '''
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
const r = await run("mw_code_read_st", { pou: "ZzFresh" });
console.log("  reopen : " + (r.variables ?? []).length + " declarations, body " + (r.body ?? "").length + " chars");
''', fresh))
    print(f"  on disk after the reopen: {vb_size('ZzFresh')}")

    print(run_js(HEAD + '''
const asg = await run("mw_code_pou_assign", { task: "SlowTsk", pou: "ZzFresh", dry_run: false });
console.log("  assign : " + JSON.stringify(asg).slice(0, 70));
const b = await run("mw_ide_build");
console.log(`  BUILD  : is_compiled=${b.is_compiled} stalled=${b.stalled}`);
''', fresh))
    print(f"  on disk after the build: {vb_size('ZzFresh')}")

    print(run_js(HEAD + '''
const r = await run("mw_code_read_st", { pou: "ZzFresh" });
console.log("  final  : " + (r.variables ?? []).length + " declarations");
await run("mw_ide_close").catch(() => {});
''', fresh))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
