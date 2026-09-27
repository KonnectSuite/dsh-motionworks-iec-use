#!/usr/bin/env python3
"""Is there a working path to "write me a program" despite the declaration bug?

Established over rounds 40-42, all by measurement:

    mw_code_pou_create produces a POU with correct streams, a correctly localized grid, matching
    sidecar files, IDE-marker tree nodes, and a .VB whose ONLY difference from the template's is
    the two VAR_EXTERNAL -> VAR renames. It builds clean.

    Adding a declaration to it reports applied=true and the count rises, and then the .VB is
    truncated to 0 bytes the next time the IDE opens the project, so the build stalls.
    Adding a declaration to an EXISTING POU survives the reopen and compiles.

    It fails on EVERY template tried - 1, 3, 4, 6 and 8 externals - so it is not the externals.

So create-then-declare is broken. But create CLONES THE TEMPLATE'S DECLARATIONS, and the matrix
proves create-then-write-a-body works. If a POU can be authored using the declarations it
inherited, then there IS a usable path: pick a template whose variables fit, write only the body,
and never add a declaration to a fresh clone.

That is worth proving, because it turns "the workflow is broken" into "here is the workflow that
works, and here is the one that does not". This creates a POU, writes a body that uses the
CLONED declarations, assigns it, and builds.
"""
import os
import subprocess
import sys
from pathlib import Path

INST = Path(r"C:\Users\KNPhu\profiles\desktop\node_modules\dsh-motionworks-iec-use")
NODE = Path(r"C:\Users\KNPhu\ProjectAryaAI\resources\aryaai\dsh-runtime\node\node.exe")
SRC = Path(r"C:\Users\KNPhu\OneDrive\Desktop\Carpenter Foam\MP2600iec Program\TopCutter.mwt")

SCRIPT = r'''
const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const fs = await import("node:fs");
const DIR = `${P}\\stage\\TopCutter`;

try { await run("mw_ide_close"); } catch {}
for (let i = 0; i < 10; i++) {
  try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; }
  catch { await new Promise(r => setTimeout(r, 1500)); }
}
await run("mw_ide_stage", { source: process.env.MW_SRC_PATH });
await run("mw_ide_close");
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });

// Create from a template, then use the declarations it INHERITED - no var_add at all.
const POU = "ZzInherit";
await run("mw_ide_close");
console.log("create: " + JSON.stringify((await run("mw_code_pou_create",
  { name: POU, template: "TopCutterCamSetup", dry_run: false })).result ?? {}).slice(0, 60));
await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });

const before = await run("mw_code_read_st", { pou: POU });
const names = (before.variables ?? []).map(v => v.name);
console.log("inherited declarations: " + names.length + " -> " + names.slice(0, 6).join(", "));

// A body that uses the CLONED declarations, so the build has to resolve them.
const body = [
  "(* Uses declarations inherited from the template, not newly added ones. *)",
  "TopCutterCamTableID := 7;",
  "TopCutterCamReady := TRUE;",
  "",
].join("\n");
await run("mw_ide_close");
const w = await run("mw_code_write_st", { pou: POU, body, dry_run: false });
console.log("write body: " + JSON.stringify(w.result ?? w).slice(0, 80));

await run("mw_ide_start");
await run("mw_ide_open", { path: `${DIR}.mwt` });
const after = await run("mw_code_read_st", { pou: POU });
console.log("after reopen: " + (after.variables ?? []).length + " declarations, "
  + "body " + (after.body ?? "").length + " chars");

const asg = await run("mw_code_pou_assign", { task: "SlowTsk", pou: POU, dry_run: false });
console.log("assign: " + JSON.stringify(asg).slice(0, 70));

const b = await run("mw_ide_build");
console.log("BUILD: is_compiled=" + b.is_compiled + " stalled=" + b.stalled);
const e = await run("mw_ide_errors", { pane: "Errors", limit: 8 });
console.log("errors: " + e.count);
for (const l of (e.lines ?? []).slice(0, 4)) console.log("   " + String(l).slice(0, 90));
await run("mw_ide_close").catch(() => {});
'''


def main() -> int:
    script = INST / "test" / "_workaround.mjs"
    script.write_text(SCRIPT, encoding="utf-8")
    env = dict(os.environ, MW_PLUGIN=str(INST), MW_SRC_PATH=str(SRC))
    env.pop("MW_SRC", None); env.pop("MW_PYTHON", None)
    r = subprocess.run([str(NODE), str(script)], capture_output=True, text=True, env=env)
    print(r.stdout.rstrip())
    if r.stderr.strip():
        print("  stderr:", r.stderr.strip().split("\n")[0][:160])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
