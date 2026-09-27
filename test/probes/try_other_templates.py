#!/usr/bin/env python3
"""Does creating a POU from a DIFFERENT template avoid the truncation?

Everything about the clone has now been measured and found correct, against a template that
carries VAR_EXTERNAL declarations:

    the .VB differs from the template's in exactly two lines - VAR_EXTERNAL -> VAR - and in
    nothing else, with the same 28 lines and the 18-byte delta accounted for by that rename
    the grid localizes both halves (usage and the 0xFFFFFFFF marker)
    every sidecar file matches
    the tree nodes carry the IDE's own markers 7, 42, 8, 23
    adding a declaration to an EXISTING POU survives the reopen and compiles

yet adding one to a clone truncates its .VB to 0 bytes on the next open. So the remaining
suspect is something about what the localize step CHANGES rather than gets wrong: those two
variables are project globals, and the clone now declares them local, shadowing them.

If that is the trigger, a template with no externals should clone and accept declarations
normally - and that gives a working path, which matters more right now than the diagnosis. It also
predicts the failure precisely, which is worth as much as the fix.

Candidates in this project, by how many externals they carry:

    TopCutterCamSetup   2 VAR_EXTERNAL blocks   <- the one that fails
    ServoTaskSlow, EIP_ToCLX, ServoHoming, TopCutterCutControl, TopCutterFFCamSetup, ...

Run:  python try_other_templates.py
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
from motionworks_iec_mcp.cfb import CompoundFile        # noqa: E402

# The templates to try, and how many externals each carries.
TEMPLATES = ["ServoTaskSlow", "EIP_ToCLX", "ServoHoming",
             "TopCutterCutControl", "TopCutterFFCamSetup"]


def externals_of(pou: str) -> int:
    src = STAGE / "POE" / pou / "src.st1"
    if not src.is_file():
        return -1
    cf = CompoundFile(src)
    name = next((n for n in cf.stream_names() if n.endswith("V.VB")), None)
    return cf.read_stream(name).decode("latin1").count("VAR_EXTERNAL") if name else -1


def run_plugin(script_body: str) -> str:
    script = INST / "test" / "_try_templates.mjs"
    script.write_text(script_body, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    return (r.stdout or "").strip() + (("\n" + r.stderr.strip()[:300]) if r.stderr.strip() else "")


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
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
console.log("staged");
'''


def main() -> int:
    print(run_plugin(PREP))
    print()
    for template in TEMPLATES:
        pou = "Zz" + template[:10]
        ext = externals_of(template)
        body = PREP.replace("console.log(\"staged\");", "")
        body += f'''
const DIR2 = `${{P}}\\\\stage\\\\TopCutter`;
const POU = "{pou}", TPL = "{template}";
await run("mw_ide_close");
const made = await run("mw_code_pou_create", {{ name: POU, template: TPL, dry_run: false }});
const add = await run("mw_code_var_add", {{ pou: POU, name: "nProbe", type: "DINT", section: "VAR", initial_value: "0", dry_run: false }});
await run("mw_ide_start");
await run("mw_ide_open", {{ path: `${{DIR2}}.mwt` }});
const b = await run("mw_ide_build");
const r = await run("mw_code_read_st", {{ pou: POU }});
console.log(`{template}|${{(made.result??made).pou ? "created" : "FAILED"}}|${{add.result?.applied ?? false}}|${{b.is_compiled}}|${{(r.variables??[]).length}}`);
await run("mw_ide_close").catch(() => {{}});
'''
        out = run_plugin(body)
        line = next((l for l in out.split("\n") if l.startswith(template + "|")), out[:200])
        parts = line.split("|")
        if len(parts) == 5:
            _, created, applied, compiled, nvars = parts
            verdict = "OK" if compiled == "true" and int(nvars) > 0 else "BROKEN"
            print(f"  {template:<22} externals={ext:<3} created={created:<8} "
                  f"add={applied:<6} build={compiled:<6} vars={nvars:<4} {verdict}")
        else:
            print(f"  {template:<22} externals={ext:<3} -> {line[:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
