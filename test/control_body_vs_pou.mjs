const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\stage\\TopCutter`;
const fs = await import("node:fs");

// THE SAME BODY, written into the TEMPLATE and into a CLONE. One variable: which POU.
const BODY = [
  "(* Type-correct: every assignment matches its declaration's type. *)",
  "TopCutterCamReady := NOT TopCutterCamReady;",
  "TopCutterCamTableID := TopCutterCamTableID + 1;",
  "IF TopCutterCamTableID > 100 THEN",
  "    TopCutterCamTableID := 0;",
  "END_IF;",
  "",
].join("\n");

async function fresh() {
  try { await run("mw_ide_close"); } catch {}
  for (let i = 0; i < 10; i++) { try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; } catch { await new Promise(r => setTimeout(r, 1500)); } }
  await run("mw_ide_stage", { source: "C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt" });
  await run("mw_ide_close");
  await run("mw_ide_start");
  await run("mw_ide_open", { path: `${DIR}.mwt` });
}

// BASELINE: does the untouched project build?
await fresh();
let b = await run("mw_ide_build");
console.log(`  baseline (nothing changed)          is_compiled=${b.is_compiled} stalled=${b.stalled}`);

// CONTROL 1: THE TEMPLATE, with MY body. It is assigned to BG already, so it compiles.
await run("mw_ide_close");
const w1 = await run("mw_code_write_st", { pou: "TopCutterCamSetup", body: BODY, dry_run: false });
console.log(`  wrote my body into the TEMPLATE      applied=${w1.result?.applied}`);
await run("mw_ide_start"); await run("mw_ide_open", { path: `${DIR}.mwt` });
b = await run("mw_ide_build");
console.log(`  TEMPLATE + my body                  is_compiled=${b.is_compiled} stalled=${b.stalled}`);

// CONTROL 2: A CLONE, with the SAME body, assigned to the same task.
await fresh();
await run("mw_code_pou_create", { name: "ZzC55", template: "TopCutterCamSetup", dry_run: false });
await run("mw_ide_start"); await run("mw_ide_open", { path: `${DIR}.mwt` });
console.log(`  clone created, builds?              is_compiled=${(await run("mw_ide_build")).is_compiled}`);
await run("mw_ide_close");
const w2 = await run("mw_code_write_st", { pou: "ZzC55", body: BODY, dry_run: false });
console.log(`  wrote the SAME body into the CLONE   applied=${w2.result?.applied}`);
await run("mw_ide_start"); await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_code_pou_assign", { task: "SlowTsk", pou: "ZzC55", dry_run: false });
b = await run("mw_ide_build");
console.log(`  CLONE    + my body                  is_compiled=${b.is_compiled} stalled=${b.stalled}`);

// CONTROL 3: the clone with its INHERITED body, assigned - the round 39 case.
await fresh();
await run("mw_code_pou_create", { name: "ZzC55b", template: "TopCutterCamSetup", dry_run: false });
await run("mw_ide_start"); await run("mw_ide_open", { path: `${DIR}.mwt` });
await run("mw_code_pou_assign", { task: "SlowTsk", pou: "ZzC55b", dry_run: false });
b = await run("mw_ide_build");
console.log(`  CLONE    + inherited body           is_compiled=${b.is_compiled} stalled=${b.stalled}`);
await run("mw_ide_close").catch(() => {});
