const P = process.env.MW_PLUGIN;
const m = await import(`file:///${P.replace(/\\/g, "/")}/index.js`);
const tools = new Map(m.__internals.defineTools().map(t => [t.name, t]));
const run = (n, a = {}) => tools.get(n).execute(a, {});
const DIR = `${P}\\stage\\TopCutter`;
const fs = await import("node:fs");
try { await run("mw_ide_close"); } catch {}
for (let i = 0; i < 10; i++) { try { fs.rmSync(DIR, {recursive:true,force:true}); fs.rmSync(`${DIR}.mwt`, {force:true}); break; } catch { await new Promise(r => setTimeout(r, 1500)); } }
await run("mw_ide_stage", { source: "C:\\Users\\KNPhu\\OneDrive\\Desktop\\Carpenter Foam\\MP2600iec Program\\TopCutter.mwt" });
await run("mw_ide_close");

// 1. create - should be recorded
await run("mw_code_pou_create", { name: "ZzG60", template: "TopCutterCamSetup", dry_run: false });
const rec = `${P}\\stage\\created-pous.json`;
console.log("  recorded: " + (fs.existsSync(rec) ? fs.readFileSync(rec, "utf8").replace(/\s+/g, "") : "NO FILE"));

// 2. var_add on the CREATED POU - should refuse
try {
  await run("mw_code_var_add", { pou: "ZzG60", name: "nG", type: "DINT", section: "VAR", dry_run: false });
  console.log("  *** var_add on a CREATED POU was ALLOWED - the guard did not fire ***");
} catch (e) {
  const msg = String(e.message).replace(/\s+/g, " ");
  console.log("  REFUSED: " + msg.slice(0, 200));
  console.log("           " + msg.slice(200, 400));
}

// 3. var_add on an EXISTING POU - must still work
try {
  const ok = await run("mw_code_var_add", { pou: "TopCutterCamSetup", name: "nG60", type: "DINT", section: "VAR", dry_run: false });
  console.log("  EXISTING POU: applied=" + (ok.result?.applied ?? false) + "   <- must be true");
} catch (e) {
  console.log("  *** WRONGLY REFUSED on an EXISTING POU ***: " + String(e.message).split("\n")[0].slice(0, 120));
}

// 4. dry_run is never blocked
try {
  const d = await run("mw_code_var_add", { pou: "ZzG60", name: "nDry", type: "DINT", dry_run: true });
  console.log("  dry_run on a created POU: allowed=" + (d.dry_run ?? "?") + "   <- planning still works");
} catch (e) {
  console.log("  *** dry_run wrongly refused ***");
}
await run("mw_ide_close").catch(() => {});
