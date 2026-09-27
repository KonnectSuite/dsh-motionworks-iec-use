/**
 * MotionWorks Use Ã¢â‚¬â€ a Cordis plugin for DeepSeek Harness.
 *
 * Gives the agent the ability to *operate* a running Yaskawa MotionWorks IEC 3 Pro
 * IDE: detect the live instance, stage and open a project in it, read the live
 * object model (POUs, variables), run the IDE's own compiler, and read the
 * verdict Ã¢â‚¬â€ plus see the IDE.
 *
 * WHY THERE ARE NO PACKAGE IMPORTS HERE
 * -------------------------------------
 * A profile plugin lives at `profiles/<p>/node_modules/@local/<name>/`. Node
 * resolves imports upward from that path, and `@deepseek-ai/*` is NOT reachable
 * from there Ã¢â‚¬â€ measured on this machine:
 *
 *     require.resolve('@deepseek-ai/dsh-tools', { paths: [.../@local/...] })
 *       -> MODULE_NOT_FOUND
 *
 * The bundle *entry* resolves (the loader finds it by name); imports inside it do
 * not. So this file imports only `node:` builtins, which always resolve.
 *
 * CONSEQUENCE: `parameters` and `output.schema` are PLAIN JSON SCHEMA.
 * `defineTool()` exists to convert the terse spec DSL (inline `required: true`)
 * into JSON Schema, and `ctx.tools.register` takes the converted form Ã¢â‚¬â€ a
 * ToolDefinition whose `parameters` is JSON Schema. Because `defineTool` is not
 * importable from here, the schemas below are written in JSON Schema directly:
 * `required` is an ARRAY of property names, never an inline boolean.
 *
 * WHY THE EFFECTOR IS COM, NOT CLICKS
 * -----------------------------------
 * MotionWorks registers an out-of-process COM automation server
 * (`Ade.Application.550`). Driving that is more reliable than synthetic input and
 * is unaffected both by the harness sandbox and by any computer-use DRY_RUN gate.
 * It must be driven from a 32-bit client, so the work is delegated to a 32-bit
 * Windows PowerShell bridge process that speaks req.json/res.json with this file.
 *
 * SAFETY (non-negotiable, enforced in code below)
 * ----------------------------------------------
 *  - Never download to a controller. Never command motion. No tool exists for it.
 *  - `mw_ide_open` refuses any path outside this plugin's own `stage/` directory,
 *    so a real project tree is never opened for editing.
 *  - `mw_ide_stage` only ever copies; it never moves or deletes a source project.
 *  - The bridge refuses to instantiate COM unless an IDE is already running,
 *    because instantiating it would launch a second IDE.
 *  - Nothing here calls Quit: the user's IDE is left as it was found.
 */

import { spawn } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'motionworks-iec-use';
export const inject = ['tools'];

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = join(HERE, 'bridge');
const BRIDGE_SCRIPT = join(BRIDGE_DIR, 'mw_bridge.ps1');
const LAUNCHER_CMD = join(BRIDGE_DIR, 'start_bridge.cmd');
const REQ = join(BRIDGE_DIR, 'req.json');
const RES = join(BRIDGE_DIR, 'res.json');
const LOG = join(BRIDGE_DIR, 'bridge.log');
const STAGE_ROOT = join(HERE, 'stage');

const PS32 = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
);

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ the code engine Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//
// Coding does NOT go through the IDE's automation API, because that API cannot
// touch POU code. Measured, all three candidate routes closed:
//   * no body accessor exists (_Pou has 35 members, none is Source/Body/Text);
//   * ExecuteCommand is a stub ("The method or operation is not implemented");
//   * the import/export providers are untyped IDispatch whose Execute() is a
//     no-op from automation (returned OK, wrote 0 files).
//
// So code is edited where it lives - the CFB container of the expanded project -
// by a Python helper wrapping the proven engine (motionworks_iec_mcp.writer).
// That engine writes only the textual streams, backs up first, and refuses while
// the IDE holds the project, so a write can never fight the IDE's cached state.
const CODE_DIR = join(HERE, 'code');
const CODE_HELPER = join(CODE_DIR, 'mw_code.py');
const CODE_REQ = join(CODE_DIR, 'req.json');
const CODE_RES = join(CODE_DIR, 'res.json');

/**
 * First working Python interpreter.
 *
 * The code path is stdlib-only Ã¢â‚¬â€ `win32com` is imported lazily inside one
 * function in ide.py Ã¢â‚¬â€ so any Python 3 will do. The one AryaAI already ships is
 * preferred, which keeps the plugin independent of any particular developer venv.
 * Override with MW_PYTHON.
 */
function pythonExe() {
  if (process.env.MW_PYTHON) return process.env.MW_PYTHON;
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'AryaAI', 'resources', 'runtime',
      'primary-runtime', 'dependencies', 'python', 'python.exe'),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return 'python';
}

/**
 * Root of the vendored `motionworks_iec_mcp` engine. MW_SRC overrides it for
 * developing against a different engine tree.
 */
function codeSrc() {
  return process.env.MW_SRC ?? join(CODE_DIR, 'engine');
}

/** Set once the bridge has been spawned by this host process. */
let bridgeSpawned = false;
/** Monotonic request id; replies are matched on it so a stale answer is never used. */
let nextId = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (t) => [{ type: 'text', text: t }];

/** Bridge log tail, for honest diagnostics instead of a bare timeout. */
function logTail(lines = 6) {
  try {
    return readFileSync(LOG, 'utf8').trim().split(/\r?\n/).slice(-lines).join(' | ');
  } catch {
    return '(no bridge.log)';
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ bridge transport Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * One request/response round trip.
 *
 * The request is written to a temp name and renamed into place so the bridge can
 * never read a half-written file, and a reply is accepted only when its `id`
 * matches this call's Ã¢â‚¬â€ so an earlier call's answer is never mistaken for this one.
 */
async function call(verb, params = {}, timeoutMs = 30000) {
  const id = nextId++;
  const tmp = `${REQ}.tmp`;
  writeFileSync(tmp, JSON.stringify({ id, verb, ...params }), 'utf8');
  renameSync(tmp, REQ);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(120);
    let res;
    try {
      // Strip a UTF-8 BOM defensively. The bridge writes without one, but
      // PowerShell's `Set-Content -Encoding UTF8` (5.1) adds one, and JSON.parse
      // throws on a leading U+FEFF Ã¢â‚¬â€ which made a perfectly healthy bridge look
      // like a timeout.
      res = JSON.parse(readFileSync(RES, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      continue; // absent, mid-write, or unreadable; retry
    }
    if (res?.id !== id) continue;
    if (!res.ok) throw new Error(res.error || `bridge reported failure for ${verb}`);
    return res.data;
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for the bridge to answer '${verb}'. Log: ${logTail()}`,
  );
}

/** True when the bridge answers a ping, i.e. it is actually serving requests. */
async function bridgeAlive() {
  if (!existsSync(BRIDGE_SCRIPT)) return false;
  try {
    await call('ping', {}, 4000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the 32-bit bridge if it is not already serving.
 *
 * stdio is `ignore` deliberately: a confined harness cannot open named pipes, so a
 * piped child fails with EPERM. This bridge never carries data over stdio Ã¢â‚¬â€ it
 * uses req.json/res.json Ã¢â‚¬â€ so ignoring stdio costs nothing.
 */
async function ensureBridge() {
  if (await bridgeAlive()) return;
  if (!existsSync(BRIDGE_SCRIPT)) throw new Error(`bridge script missing: ${BRIDGE_SCRIPT}`);
  mkdirSync(BRIDGE_DIR, { recursive: true });
  // A leftover request would be consumed by the new bridge on startup, and the
  // `stop` verb exits Ã¢â‚¬â€ which is how a previous run's stale request killed a
  // freshly started bridge. Clear both files first.
  rmSync(REQ, { force: true });
  rmSync(RES, { force: true });

  const child = spawn(
    // Spawn the .cmd launcher through cmd.exe rather than handing
    // `-Command "& '<path>'"` to powershell.exe: Node's Windows argument quoting
    // mangles that form, and the child then starts and exits 0 without ever
    // running the script (measured). A single launcher path is unambiguous.
    process.env.ComSpec ?? 'cmd.exe',
    ['/c', LAUNCHER_CMD],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  bridgeSpawned = true;

  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    if (await bridgeAlive()) return;
  }
  throw new Error(
    `the 32-bit COM bridge did not come up within 10s. Check that ${PS32} and `
    + `${LAUNCHER_CMD} exist. Log: ${logTail()}`,
  );
}

/** Ask the bridge to exit (best effort; never throws). */
async function stopBridge() {
  try {
    if (bridgeSpawned || existsSync(REQ)) await call('stop', {}, 5000);
  } catch {
    /* already gone */
  }
  bridgeSpawned = false;
}

/** Run a verb with the bridge guaranteed up. */
async function verb(v, params, timeoutMs) {
  await ensureBridge();
  return call(v, params, timeoutMs);
}

/**
 * Run one code-engine verb.
 *
 * Files, not stdio: a confined harness cannot open named pipes, so a piped child
 * fails with EPERM. The child's stdio is ignored and the answer is read from
 * res.json, so this works under any sandbox mode.
 */
function runCode(codeVerb, request, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    if (!existsSync(CODE_HELPER)) {
      reject(new Error(`code helper missing: ${CODE_HELPER}`));
      return;
    }
    const py = pythonExe();
    if (!existsSync(py)) {
      reject(new Error(`python not found at ${py} Ã¢â‚¬â€ set MW_PYTHON to a Python 3 interpreter`));
    }
    mkdirSync(CODE_DIR, { recursive: true });
    rmSync(CODE_RES, { force: true });
    writeFileSync(CODE_REQ, JSON.stringify(request), 'utf8');

    const child = spawn(py, [CODE_HELPER, codeVerb, CODE_REQ, CODE_RES], {
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        MW_SRC: codeSrc(),
        PYTHONIOENCODING: 'utf-8',
        // Every write backs the file up first and the engine REFUSES the write if
        // it cannot create the backup location. Its default (~\.motionworks-iec-mcp)
        // is not writable here Ã¢â‚¬â€ measured: WinError 5 on the first real write Ã¢â‚¬â€ so
        // point it at the plugin's own directory. Without this, every write fails.
        MOTIONWORKS_MCP_BACKUP_DIR: join(HERE, 'backups'),
        MOTIONWORKS_MCP_ROOT: STAGE_ROOT,
        // Let a real write close the IDE itself rather than only refusing, so the
        // close/write sequence cannot be raced by the IDE caching project state.
        MOTIONWORKS_MCP_CLOSE_IDE: '1',
      },
    });

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error(`code engine timed out after ${timeoutMs}ms on '${codeVerb}'`));
    }, timeoutMs);

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', () => {
      clearTimeout(timer);
      let res;
      try {
        res = JSON.parse(readFileSync(CODE_RES, 'utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        reject(new Error(`code engine produced no readable result for '${codeVerb}': ${err.message}`));
        return;
      }
      if (!res.ok) {
        reject(new Error(res.error || `code engine failed '${codeVerb}'`));
        return;
      }
      // Drop the engine's envelope. A failure has already become a rejection, so
      // `ok` is always true here, and carrying it into the tool result forced every
      // output schema to declare a field that carries no information. That mismatch
      // is invisible to a Node test and fatal through the harness, which validates
      // tool output against the schema: mw_code_pous passed every test I ran and
      // failed the moment it was called for real.
      const { ok: _ok, error: _err, traceback: _tb, ...payload } = res;
      resolve(payload);
    });
  });
}

/** Refuse any path that is not inside this plugin's staging root. */
function assertStaged(p) {
  const full = resolve(p);
  const root = resolve(STAGE_ROOT);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(
      `REFUSED: '${full}' is outside the staging root '${root}'. `
      + 'Stage a copy with mw_ide_stage first; the real project trees are never opened.',
    );
  }
  return full;
}

/** Recursive copy (copyFileSync has no recursive mode). */
function copyTree(from, to, onFile) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst, onFile);
    else { copyFileSync(src, dst); onFile(); }
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ schemas (plain JSON Schema: `required` is an array) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'ide_window', 'is_project_open'],
  properties: {
    version: { type: 'string', description: 'Automation server version reported by the IDE.' },
    ide_window: { type: 'string', description: 'Window handle of the live IDE, e.g. 0x4A0A12.' },
    is_project_open: { type: 'boolean' },
    active_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'accepted', 'settled', 'is_compiled', 'elapsed_s'],
  properties: {
    mode: { type: 'string', description: 'make | build | patch | worksheet | datatypes.' },
    compile_type: { oneOf: [{ type: 'integer' }, { type: 'null' }], description: 'The AdeCompileType passed to Compile().' },
    accepted: { type: 'boolean', description: 'The IDE accepted the compile request.' },
    settled: {
      type: 'boolean',
      description: 'A second compile was accepted, proving the previous one finished.',
    },
    stalled: {
      oneOf: [{ type: 'boolean' }, { type: 'null' }],
      description:
        'The compiler never finished. is_compiled=false with is_modified=TRUE is a STALL, '
        + 'not a rejection: the compiler is still working, so the Errors pane proves nothing '
        + 'and hunting it for messages wastes the turn. Only is_modified=false means the '
        + 'compiler finished and REJECTED the code.',
    },
    is_compiled: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    is_modified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    elapsed_s: { type: 'number' },
  },
};

/**
 * Report the verdict without overclaiming: a compile that never ran must not read
 * like a project that does not compile.
 *
 * Compile types come from Ade.tlb. The commonly repeated 1=Build / 2=Rebuild
 * guess is wrong Ã¢â‚¬â€ 1 is Make, 2 is Build, and there is no Rebuild compile type
 * at all (Rebuild is a command, and ExecuteCommand is a stub in this build).
 */
function renderBuild(_a, v) {
  if (!v.accepted) return text(`${v.mode}: the IDE never accepted the compile request.`);
  if (v.stalled) {
    return text(
      `${v.mode}: COMPILER DID NOT FINISH (is_compiled=false, is_modified=true, ${v.elapsed_s}s). `
      + 'This is a STALL, not a rejection - the compiler is still running, so the Errors '
      + 'pane proves nothing. Re-check with mw_ide_compile_state, and do NOT go hunting '
      + 'the Errors pane for messages that were never produced.',
    );
  }
  return text(
    v.is_compiled
      ? `${v.mode}: compiled cleanly (is_compiled=true, ${v.elapsed_s}s).`
      : `${v.mode}: COMPILE FAILED (is_compiled=false, ${v.elapsed_s}s). `
        + 'The automation API returns the verdict but never the messages Ã¢â‚¬â€ call mw_ide_errors to '
        + 'bring the IDE Errors pane up and capture it.',
  );
}

/** Output of the code-engine write verbs (dry-run preview or a real apply). */
const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    dry_run: { type: 'boolean' },
    result: { type: 'object', additionalProperties: true },
    plan: { type: 'object', additionalProperties: true },
  },
};

function renderWrite(_a, v) {
  const r = (v && v.result) || {};
  const p = (v && v.plan) || {};
  if (v && v.dry_run) {
    if (p.pou_name) {
      return text(`DRY RUN Ã¢â‚¬â€ nothing changed. Plan for POU '${p.pou_name}'`
        + (p.template_name ? ` from template '${p.template_name}'` : '')
        + (p.files ? `; would touch ${p.files.length} file(s)` : '')
        + (p.referenced_by && p.referenced_by.length
          ? `; referenced by ${p.referenced_by.join(', ')}` : '')
        + (p.assigned_to && p.assigned_to.length
          ? `; assigned to tasks ${p.assigned_to.join(', ')}` : ''));
    }
    return text(`DRY RUN Ã¢â‚¬â€ nothing changed.`
      + (r.target ? ` Would write ${r.target}` : '')
      + (r.stream ? ` (stream ${r.stream})` : ''));
  }
  if (r.applied) {
    return text(
      `APPLIED to ${r.target} (stream ${r.stream}); ${r.before_bytes} -> ${r.after_bytes} bytes, `
      + `${r.siblings_verified} sibling streams verified unchanged.`
      + (Array.isArray(r.backups) && r.backups.length ? ` Backup: ${r.backups[0]}` : ''),
    );
  }
  const body = Object.keys(r).length ? r : p;
  return text(`Result: ${JSON.stringify(body).slice(0, 400)}`);
}

/**
 * The project directory a code tool should act on.
 *
 * Defaults to the newest staged project, and always passes through assertStaged,
 * so a code tool can never be pointed at a real project tree.
 */
function projectOf(args) {
  const given = args?.project;
  if (given) return assertStaged(String(given));
  if (!existsSync(STAGE_ROOT)) {
    throw new Error(`no staged project: ${STAGE_ROOT} does not exist Ã¢â‚¬â€ stage one first`);
  }
  // A staged PROJECT is a directory with a sibling `<name>.mwt`. Requiring that
  // matters: writing a POU creates stage/backups, and a plain "newest directory"
  // pick then selected the BACKUP FOLDER as the project, so the next call failed
  // with "no POE directory under stage\backups".
  const dirs = readdirSync(STAGE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(STAGE_ROOT, e.name))
    .filter((d) => existsSync(`${d}.mwt`))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (dirs.length === 0) throw new Error(`no staged project directory under ${STAGE_ROOT}`);
  return dirs[0];
}

function defineTools() {
  return [
    {
      name: 'mw_ide_status',
      description:
        'Detect the running MotionWorks IEC 3 Pro IDE and report its automation version, '
        + 'window handle, and whether a project is open in it. Call this first: every other '
        + 'mw_ide_* tool needs a live IDE, and this says whether one exists.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: STATUS_SCHEMA,
        render: (_a, v) => text(
          v.is_project_open
            ? `MotionWorks IEC ${v.version} is running (window ${v.ide_window}) with '${v.active_project}' open.`
            : `MotionWorks IEC ${v.version} is running (window ${v.ide_window}), no project open.`,
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'MotionWorks IDE status', kind: 'read' }),
      execute: () => verb('status', {}, 20000),
    },

    {
      name: 'mw_ide_stage',
      description:
        'Copy a MotionWorks project into this plugin\'s staging area so it can be opened '
        + 'without touching the original. Accepts a project folder or its .mwt file, and copies '
        + 'both the .mwt and its sibling expanded directory. This only ever copies; the source '
        + 'is never modified, moved or deleted.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['source'],
        properties: {
          source: {
            type: 'string',
            description: 'Absolute path to the project folder or to its .mwt file.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['staged_mwt', 'files_copied'],
          properties: {
            staged_mwt: { type: 'string' },
            files_copied: { type: 'integer' },
          },
        },
        render: (_a, v) => text(`Staged ${v.files_copied} files. Open with: ${v.staged_mwt}`),
      },
      presentCall: (a) => ({
        card: 'generic', title: 'Stage project copy', kind: 'other', rawInput: a.source,
      }),
      execute: (args) => {
        const source = resolve(String(args.source));
        if (!existsSync(source)) throw new Error(`source not found: ${source}`);
        const isMwt = source.toLowerCase().endsWith('.mwt');
        const mwt = isMwt ? source : `${source}.mwt`;
        const dir = isMwt ? source.slice(0, -4) : source;
        if (!existsSync(mwt)) throw new Error(`no .mwt found at ${mwt}`);

        const base = mwt.slice(mwt.lastIndexOf(sep) + 1, -4);
        mkdirSync(STAGE_ROOT, { recursive: true });
        const targetMwt = join(STAGE_ROOT, `${base}.mwt`);
        const targetDir = join(STAGE_ROOT, base);

        // REPLACE, do not merge. Copying onto an existing staged copy left POUs and
        // edits from the previous run in place, so "re-stage" did not produce a
        // clean copy Ã¢â‚¬â€ a repeat test then ran against a dirty project.
        const stageRoot = resolve(STAGE_ROOT);
        for (const target of [targetMwt, targetDir]) {
          if (resolve(target).startsWith(stageRoot + sep)) {
            rmSync(target, { recursive: true, force: true });
          }
        }

        let copied = 0;
        copyFileSync(mwt, targetMwt);
        copied += 1;
        if (existsSync(dir) && statSync(dir).isDirectory()) {
          copyTree(dir, targetDir, () => { copied += 1; });
        }
        return Promise.resolve({ staged_mwt: targetMwt, files_copied: copied });
      },
    },

    {
      name: 'mw_ide_open',
      description:
        'Open a staged project inside the running MotionWorks IDE, so its Project Tree and '
        + 'editors populate with the real project. The path must be inside this plugin\'s stage '
        + 'directory; use mw_ide_stage first. The conversion prompt is suppressed so this cannot '
        + 'block on a modal dialog.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string', description: 'Staged .mwt path.' } },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['requested', 'is_project_open'],
          properties: {
            requested: { type: 'string' },
            is_project_open: { type: 'boolean' },
            active_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          v.is_project_open
            ? `The IDE now has '${v.active_project}' open.`
            : 'OpenProject returned but IsProjectOpen never became true.',
        ),
      },
      presentCall: (a) => ({
        card: 'generic', title: 'Open project in IDE', kind: 'other', rawInput: a.path,
      }),
      // The bridge retries OpenProject for up to 90s while a freshly started IDE
      // initialises its project services, answers any modal prompt it raises on the
      // way, and then waits for the project to appear Ã¢â‚¬â€ so the budget here has to
      // cover all three, not just the first retry window.
      execute: (args) => verb('open', { path: assertStaged(String(args.path)) }, 300000),
    },

    {
      name: 'mw_ide_pous',
      description:
        'List the POUs of the project open in the IDE, read from the IDE\'s live object model '
        + '(not from files). Language codes: 1=IL, 2=ST, 3=FBD, 4=LD, 5=SFC, 6=MSFC, 7=FFLD.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'pous'],
          properties: {
            count: { type: 'integer' },
            pous: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'name', 'language'],
                properties: {
                  index: { type: 'integer' },
                  name: { type: 'string' },
                  language: { type: 'string', description: '1=IL 2=ST 3=FBD 4=LD 5=SFC 6=MSFC 7=FFLD.' },
                },
              },
            },
          },
        },
        render: (_a, v) => text(
          `${v.count} POUs: ${v.pous.map((p) => `${p.name} (lang ${p.language})`).join(', ')}`,
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Read POUs from IDE', kind: 'read' }),
      execute: () => verb('pous', {}, 20000),
    },

    {
      name: 'mw_ide_variables',
      description:
        'Read the live variable model of the project open in the IDE: name, data type, initial '
        + 'value and IEC address per declaration, grouped as the IDE groups them. Optionally '
        + 'restrict to one POU. This is the IDE\'s own model, so it needs no knowledge of the '
        + 'on-disk container format.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pou: { type: 'string', description: 'Optional POU name; omit to read every POU.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pous'],
          properties: {
            pous: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pou', 'count', 'variables', 'groups'],
                properties: {
                  pou: { type: 'string' },
                  count: { type: 'integer' },
                  variables: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['name'],
                      properties: {
                        name: { type: 'string' },
                        data_type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                        initial_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                        iec_address: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                      },
                    },
                  },
                  groups: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['name', 'count', 'variables'],
                      properties: {
                        name: { type: 'string' },
                        count: { type: 'integer' },
                        variables: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        render: (_a, v) => text(
          v.pous.map((p) => `${p.pou} (${p.count}): `
            + p.variables.map((x) => `${x.name}:${x.data_type}`).join(', ')).join('\n'),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Read variables from IDE', kind: 'read' }),
      execute: (args) => {
        const params = {};
        if (args.pou !== undefined && args.pou !== null && String(args.pou).length > 0) {
          params.pou = String(args.pou);
        }
        return verb('variables', params, 60000);
      },
    },

    {
      name: 'mw_ide_make',
      description:
        'Run Make in the IDE (ActiveProject.Compile(1) = adeCtMake) and report the verdict. '
        + 'Make links the already-built parts; prefer mw_ide_build after a code change, because '
        + 'a plain Make can reuse stale symbol data.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: BUILD_SCHEMA, render: renderBuild },
      presentCall: () => ({ card: 'generic', title: 'Make in MotionWorks IEC', kind: 'execute' }),
      execute: () => verb('make', {}, 400000),
    },

    {
      name: 'mw_ide_build',
      description:
        'Run Build in the IDE (ActiveProject.Compile(2) = adeCtBuild) and report the verdict. '
        + 'This is the compile-verification step for code the agent wrote: it waits until a '
        + 'second compile is accepted, which proves the first one finished, then reads '
        + 'IsCompiled. `accepted` and `settled` distinguish "compiled and failed" from '
        + '"never ran". Note there is no Rebuild compile type Ã¢â‚¬â€ Rebuild is an IDE command, and '
        + 'ExecuteCommand is a stub in this build.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: BUILD_SCHEMA, render: renderBuild },
      presentCall: () => ({ card: 'generic', title: 'Build in MotionWorks IEC', kind: 'execute' }),
      execute: () => verb('build', {}, 400000),
    },
    {
      name: 'mw_ide_compile_state',
      description:
        'Report whether the open project is COMPILED and whether it has MODIFIED since, without '
        + 'building anything. Cheap and side-effect free, so it is the right check before deciding '
        + 'whether a build is needed, and after a build whose verdict looks surprising. '
        + 'is_modified=true with is_compiled=true means there are edits that have not been '
        + 'compiled yet.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['is_compiled', 'is_modified'],
          properties: {
            is_compiled: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            is_modified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          `compiled=${v.is_compiled}  modified=${v.is_modified}`
          + (v.is_compiled === true && v.is_modified === true
            ? '  â€” there are edits that have not been compiled yet'
            : ''),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Check compile state', kind: 'read' }),
      execute: () => verb('compile_state', {}, 30000),
    },
    {
      name: 'mw_ide_save',
      description:
        'Save the project open in the IDE (ActiveProject.Save). The agent could already '
        + 'modify a project file by file, but not persist the state the IDE itself holds - '
        + 'and that matters most for the one step only the user can perform: after they add '
        + 'a program to a task in the Project Tree (mw_code_pou_assign explains why that '
        + 'cannot be automated), a save is what makes it stick. Also worth calling after a '
        + 'build when the user wants the compiled state written back. Reports elapsed_s and '
        + 'the project is_modified and is_compiled afterwards, so the caller confirms rather '
        + 'than assumes. Refuses when no project is open. This is the one operation here '
        + 'that needs the IDE RUNNING, because it is the IDE own save rather than a file '
        + 'write.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            saved: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            elapsed_s: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            is_modified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            is_compiled: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          `saved in ${v.elapsed_s}s  modified=${v.is_modified}  compiled=${v.is_compiled}`,
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Save the open project', kind: 'write' }),
      execute: () => verb('save', {}, 60000),
    },


    {
      name: 'mw_ide_errors',
      description:
        'Read the IDE compiler messages AS TEXT. Call this after any build that did not compile '
        + 'cleanly: the automation API returns the verdict but never the messages, so this reads '
        + 'the Message Window list control through MSAA and returns each line verbatim, e.g. '
        + '"No matching global variable found for \'x:y\' in resource \'Resource\'!". Panes: '
        + 'Errors (default), Warnings, Build, Info. The Errors pane also carries INFORMATIONAL lines - structure padding notes, required-memory totals, redundant-variable counts - so read them before calling a build broken. A pane with zero lines is a CLEAN result, not '
        + 'a failure. Set screenshot:true to also capture the pane, and limit to raise the cap.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pane: {
            type: 'string',
            description: 'Output pane to read: Errors (default), Warnings, Build, or Info.',
          },
          limit: { type: 'integer', description: 'Maximum lines to return. Defaults to 200.' },
          screenshot: {
            type: 'boolean',
            description: 'Also capture the pane to a PNG and return its path. Defaults to false.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pane', 'count', 'lines'],
          properties: {
            pane: { type: 'string' },
            count: { type: 'integer' },
            lines: { type: 'array', items: { type: 'string' } },
            note: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            screenshot: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => {
          if (v.count === 0) {
            return text(`The '${v.pane}' pane is EMPTY - nothing to report.`
              + (v.screenshot ? `\nScreenshot: ${v.screenshot}` : ''));
          }
          return text(`'${v.pane}': ${v.count} message(s)\n`
            + v.lines.map((l) => `  ${l}`).join('\n')
            + (v.screenshot ? `\nScreenshot: ${v.screenshot}` : ''));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'Read MotionWorks errors', kind: 'read' }),
      execute: async (args) => {
        const pane = args?.pane ? String(args.pane) : 'Errors';
        const limit = Number.isInteger(args?.limit) ? args.limit : 200;
        const read = await verb('read_output', { pane, limit }, 60000);
        let shotPath = null;
        if (args?.screenshot) {
          const out = join(HERE, 'shots', `pane-${pane.replace(/\W+/g, '')}-${Date.now()}.png`);
          mkdirSync(dirname(out), { recursive: true });
          try {
            const shot = await verb('screenshot', { path: out }, 30000);
            shotPath = shot.path;
          } catch { shotPath = null; }
        }
        return {
          pane,
          count: read.count ?? 0,
          lines: read.lines ?? [],
          note: read.note ?? null,
          screenshot: shotPath,
        };
      },
    },

    {
      name: 'mw_ide_start',
      description:
        'Start MotionWorks IEC (a bare Mwt.exe launch, no project). Needed after mw_ide_close, '
        + 'which is required before code writes. Follow it with mw_ide_open to load a project: a '
        + 'freshly launched IDE has no project services until one is opened.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exe: { type: 'string', description: 'Override the Mwt.exe path.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ide_window'],
          properties: {
            already_running: { type: 'boolean' },
            ide_window: { type: 'string' },
            version: { type: 'string' },
            launched_exe: { type: 'string' },
            trial_dialog: {
              type: 'boolean',
              description: 'A licence/trial dialog appeared during startup and was answered.',
            },
            trial_answered: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          `MotionWorks IEC ${v.version} running at ${v.ide_window}`
          + (v.already_running ? ' (was already up)' : ' (launched)'),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Start MotionWorks IEC', kind: 'execute' }),
      // The bridge waits up to 300s for the window (IDE startup can exceed two
      // minutes here), so the client must allow longer than that or it gives up
      // while the bridge is still legitimately waiting.
      execute: (args) => verb('start_ide', args?.exe ? { exe: String(args.exe) } : {}, 330000),
    },

    {
      name: 'mw_ide_trial',
      description:
        'Check for Ã¢â‚¬â€ and optionally answer Ã¢â‚¬â€ the MotionWorks licence/trial dialog. An '
        + 'unlicensed build shows a modal dialog ("Use Trial" / "Activate Online" / '
        + '"Activate by Phone") BEFORE the IDE creates any window of its own, and until '
        + 'it is answered the IDE has no project services, so every OpenProject fails '
        + 'with "Internal error". mw_ide_start already answers it when it appears; call '
        + 'this to inspect the state or to retry. It reports honestly when the dialog '
        + 'could not be dismissed: the dialog belongs to another process (mwctVerify.exe), '
        + 'so clicking it is best-effort and may need one manual click.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attempt: {
            type: 'boolean',
            description: 'Try to dismiss it with "Use Trial". Defaults to false (report only).',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            dialog_present: { type: 'boolean' },
            dismissed: { type: 'boolean' },
            method: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            dialog_hwnd: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            use_trial_hwnd: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            ide_window: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          v.dialog_present
            ? (v.dismissed
              ? `Licence dialog was present and is now answered (via ${v.method}).`
              : 'LICENCE DIALOG IS UP and could not be dismissed automatically. Click '
                + '"Use Trial" once by hand, or activate a licence. This affects only the '
                + 'mw_ide_* tools Ã¢â‚¬â€ the mw_code_* tools work without the IDE and without a licence.')
            : 'No licence dialog is present.',
        ),
      },
      presentCall: (a) => ({
        card: 'generic',
        title: a?.attempt ? 'Answer licence dialog' : 'Check licence dialog',
        kind: 'read',
      }),
      execute: (args) => verb(args?.attempt ? 'dismiss_trial' : 'trial_state', {}, 240000),
    },

    {
      name: 'mw_ide_state',
      description:
        'Report what the IDE is ACTUALLY doing right now, including modal dialogs the '
        + 'automation API cannot see. **Call this after every mw_ide_* step.** While a '
        + 'dialog is up, the COM API returns nothing useful: IsProjectOpen reports false '
        + 'or throws, so "no project open" or a bare failure must NOT be read as "the IDE '
        + 'closed". Returns whether the IDE is blocked, and for each dialog its exact '
        + 'message text and button labels Ã¢â‚¬â€ read with WM_GETTEXT from the standard Win32 '
        + 'dialog, so it is exact rather than an OCR guess. Set screenshot:true to also '
        + 'capture the IDE when a dialog is owner-drawn and has no readable text (the .NET '
        + 'licence dialog is one such case).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screenshot: {
            type: 'boolean',
            description: 'Also capture the IDE to a PNG and return its path. Defaults to false.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ide_running', 'blocked', 'dialog_count', 'dialogs'],
          properties: {
            ide_running: { type: 'boolean' },
            ide_window: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            window_title: { type: 'string' },
            ide_enabled: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            blocked: { type: 'boolean' },
            dialog_count: { type: 'integer' },
            dialogs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['handle', 'title', 'message', 'buttons'],
                properties: {
                  handle: { type: 'string' },
                  title: { type: 'string' },
                  message: { type: 'string' },
                  enabled: { type: 'boolean' },
                  buttons: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'label'],
                      properties: {
                        id: { type: 'integer' },
                        label: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            hint: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            screenshot: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => {
          if (!v.ide_running) return text('No MotionWorks IDE is running.');
          const lines = [
            `MotionWorks is running (${v.ide_window}), ${v.blocked ? 'BLOCKED' : 'not blocked'}.`,
          ];
          for (const d of v.dialogs) {
            const btns = d.buttons.map((b) => b.label).join(' / ');
            lines.push(`Dialog ${d.handle}${d.enabled ? '' : ' (behind)'}: ${d.message} [${btns}]`);
          }
          if (v.blocked && v.dialogs.length) {
            lines.push('The IDE is waiting for a button. The COM API cannot proceed until it is '
              + 'answered Ã¢â‚¬â€ use mw_ide_dialog.');
          }
          if (v.screenshot) lines.push(`Screenshot: ${v.screenshot}`);
          return text(lines.join('\n'));
        },
      },
      presentCall: (a) => ({
        card: 'generic',
        title: a?.screenshot ? 'Check IDE state + screenshot' : 'Check IDE state',
        kind: 'read',
      }),
      execute: async (args) => {
        const state = await verb('ide_state', {}, 30000);
        if (args?.screenshot) {
          const out = join(HERE, 'shots', `state-${Date.now()}.png`);
          mkdirSync(dirname(out), { recursive: true });
          try {
            const shot = await verb('screenshot', { path: out }, 30000);
            return { ...state, screenshot: shot.path };
          } catch {
            return { ...state, screenshot: null };
          }
        }
        return { ...state, screenshot: null };
      },
    },

    {
      name: 'mw_ide_dialog',
      description:
        'Answer a modal dialog that MotionWorks is waiting on. The IDE asks questions '
        + '(defragment this project?, load a project that was not closed cleanly?, licence '
        + 'notices) in standard Win32 dialogs, and while one is up the automation API is '
        + 'silent Ã¢â‚¬â€ which is what makes a healthy IDE look closed. Name the button to press '
        + '("Yes", "No", "OK", ...) and it is clicked with BM_CLICK, no synthetic input. '
        + 'mw_ide_open already answers the safe, recurring ones by itself; this is for '
        + 'anything else. Only ever relevant to a STAGED COPY: the plugin never opens your '
        + 'original project, so answering "Yes, load anyway" cannot endanger real work.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['button'],
        properties: {
          button: {
            type: 'string',
            description: 'Button label to press, e.g. "Yes", "No", "OK". Case-insensitive.',
          },
          handle: {
            type: 'string',
            description: 'Dialog handle from mw_ide_state; omit to use the front-most dialog.',
          },
          button_id: {
            type: 'integer',
            description: 'Win32 control id, when the label alone is ambiguous.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['answered'],
          properties: {
            answered: { type: 'boolean' },
            dialog: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            pressed: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            pressed_id: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
            dialog_closed: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            message: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          v.answered
            ? `Pressed "${v.pressed}" on dialog ${v.dialog}${v.dialog_closed ? ' Ã¢â‚¬â€ it closed.' : ' Ã¢â‚¬â€ the dialog is still open.'}`
              + (v.message ? `\nIt said: ${v.message}` : '')
            : `Nothing to answer: ${v.reason ?? 'no dialog is up'}`,
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Answer MotionWorks dialog', kind: 'other' }),
      execute: (args) => verb('answer_dialog', {
        button: String(args.button),
        ...(args.handle ? { handle: String(args.handle) } : {}),
        ...(Number.isInteger(args.button_id) ? { button_id: args.button_id } : {}),
      }, 60000),
    },

    {
      name: 'mw_ide_close',
      description:
        'Close MotionWorks IEC and wait until it is really gone. Required before writing code: '
        + 'the write engine refuses while the IDE holds the project, because the IDE caches '
        + 'project state and rewrites whole files, which would discard an external edit.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['closed'],
          properties: {
            closed: { type: 'boolean' },
            killed_pids: { type: 'array', items: { type: 'integer' } },
            window_remaining: { type: 'boolean' },
          },
        },
        render: (_a, v) => text(v.closed
          ? `MotionWorks closed (pids ${JSON.stringify(v.killed_pids)}). Code writes can proceed.`
          : 'MotionWorks is STILL running Ã¢â‚¬â€ do not write code yet.'),
      },
      presentCall: () => ({ card: 'generic', title: 'Close MotionWorks IEC', kind: 'execute' }),
      execute: () => verb('close_ide', {}, 60000),
    },

    // Ã¢â€â‚¬Ã¢â€â‚¬ code Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    {
      name: 'mw_code_pous',
      description:
        'List the POUs of a staged project with each one\'s language and body stream, read '
        + 'straight from the project files. `has_st_body` is the editability test: Structured '
        + 'Text POUs are editable, while graphical LD/FBD POUs are proprietary binary and are '
        + 'refused. Defaults to the staged project.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'pous'],
          properties: {
            count: { type: 'integer' },
            // The engine reports which project it read. Declared because these
            // schemas are additionalProperties:false and the harness validates tool
            // output against them, so an undeclared field is a hard tool failure.
            project: { type: 'string' },
            pous: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  language: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  body_stream: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  has_st_body: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
                },
              },
            },
          },
        },
        render: (_a, v) => text(
          `${v.count} POUs:\n` + v.pous.map((p) => `  ${p.name} [${p.language ?? '?'}]`
            + (p.has_st_body ? ' editable (ST)' : ' not ST-editable')).join('\n'),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'List POUs from files', kind: 'read' }),
      execute: (args) => runCode('pous', { project: projectOf(args), ...(args ?? {}) }),
    },
    {
      name: 'mw_code_types',
      description:
        'Read the project\'s user-defined data types (UDTs) from DT/Tyllist.typ - the member '
        + 'names and types an agent needs to write correct Structured Text. Without this you '
        + 'are writing code against types you cannot see: a POU here declares CamData : '
        + 'CamSegmentStruct and CamTable : Y_MS_CAM_STRUCT, and touching either needs its '
        + 'members. Omit name to list every type the project defines (297 in the measured '
        + 'project, matching the file\'s own NDTE header exactly); pass name to get one type '
        + 'in full, with members, types and array bounds. Types used by POUs but absent from '
        + 'the list (CamGenerator, Y_CamStructSelect) come from an installed LIBRARY rather '
        + 'than the project and are reported as not defined here - they are not missing, they '
        + 'are elsewhere.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'One type to read in full; omit to list all.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            project: { type: 'string' },
            defined: { type: 'integer' },
            header_counts: { type: 'object', additionalProperties: true },
            types: { type: 'array', items: { type: 'object', additionalProperties: true } },
            name: { type: 'string' },
            kind: { type: 'string' },
            type_id: { type: 'integer' },
            container: { type: 'string' },
            declared_members: { type: 'integer' },
            element_type: { type: 'string' },
            members: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (r) => {
          if (r.name) {
            const ms = (r.members ?? []).map((m) => `${m.name}${m.array_size ? `[${m.array_size}]` : ''} : ${m.type}`).join(', ');
            return `${r.name} [${r.kind}] ${(r.members ?? []).length} members: ${ms}`;
          }
          const kinds = {};
          for (const t of r.types ?? []) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
          const summary = Object.entries(kinds).map(([k, v]) => `${v} ${k || 'other'}`).join(', ');
          return `${r.defined} data types defined in this project (${summary})`;
        },
      },
      execute: async (args) => runCode('types', {
        project: projectOf(args),
        ...(args?.name ? { name: String(args.name) } : {}),
      }),
    },
    {
      name: 'mw_code_library',
      description:
        'Read the LIBRARY side of the project: which blocks it uses, and what one block '
        + 'offers. This is the other half of writing code against things you cannot see - a '
        + 'POU here declares fbCamGen : CamGenerator, and calling that block needs its '
        + 'member names. Omit name to list every block the dependency manifest names, with '
        + 'its kind and what it calls (measured: CalcSpline <- CalcSplineMatrix, CamGenerator '
        + '<- CalcSpline, CalcBezier, MasterIndex_Lookup, TopCutterCamSetup <- CamGenerator). '
        + 'Pass name for one block, read from its compiled .NET assembly. IMPORTANT: the '
        + 'identifier list does NOT record input/output DIRECTION - Execute and Done are '
        + 'distinguishable by convention, not by evidence - so read the declaration in the '
        + 'calling POU with mw_code_read_st to tell an input from an output. Compiler '
        + 'temporaries (__temp_1..50, s1..s7) are filtered out rather than reported as part '
        + 'of the interface.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'One block to read; omit to list all.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            project: { type: 'string' },
            count: { type: 'integer' },
            blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            name: { type: 'string' },
            assembly: { type: 'string' },
            runtime: { type: 'string' },
            identifiers: { type: 'array', items: { type: 'string' } },
            filtered_out: { type: 'integer' },
            note: { type: 'string' },
          },
        },
        render: (r) => {
          if (Array.isArray(r.blocks)) {
            const libs = r.blocks.filter((b) => b.library).length;
            return `${r.count} blocks (${libs} library): `
              + r.blocks.map((b) => `${b.name}${b.depends_on?.length ? ` <- ${b.depends_on.join(', ')}` : ''}`).join(' | ');
          }
          return `${r.name} (${r.assembly}) ${(r.identifiers ?? []).length} identifiers: `
            + (r.identifiers ?? []).join(', ');
        },
      },
      execute: async (args) => runCode('library', {
        project: projectOf(args),
        ...(args?.name ? { name: String(args.name) } : {}),
      }),
    },
    {
      name: 'mw_code_globals',
      description:
        'List the project VAR_GLOBAL declarations - the tags every POU can see, with type, '
        + 'group, IEC address, initial value and description. Read this BEFORE writing code that '
        + 'references a shared tag, and after mw_code_var_add without a `pou` to confirm the '
        + 'global landed. The automation API exposes NO project-level variable collection '
        + '(project.Variables, project.Globals and project.VariableGroups are all absent or '
        + 'empty), so the live variable model cannot show globals at all - this reads them from '
        + 'the resource declaration stream instead.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'variables'],
          properties: {
            project: { type: 'string' },
            count: { type: 'integer' },
            source_stream: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            warnings: { type: 'array', items: { type: 'string' } },
            variables: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  type: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  section: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  group: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  address: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  initial_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  description: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                },
              },
            },
          },
        },
        render: (_a, v) => text(
          `${v.count} global declaration(s)`
          + (v.source_stream ? ` from ${v.source_stream}` : '')
          + ':\n'
          + v.variables.slice(0, 40).map((x) => `  ${x.name} : ${x.type ?? '?'}`
            + (x.address ? `  ${x.address}` : '')
            + (x.group ? `  [${x.group}]` : '')).join('\n')
          + (v.variables.length > 40 ? `\n  â€¦ and ${v.variables.length - 40} more` : ''),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'List global variables', kind: 'read' }),
      execute: (args) => runCode('globals', { project: projectOf(args) }),
    },

    {
      name: 'mw_code_read_st',
      description:
        'Read one POU\'s Structured Text body, exactly as the container holds it, plus its '
        + 'variable declarations. This is how the agent sees the code it is about to change.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pou'],
        properties: {
          pou: { type: 'string', description: 'POU name.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pou', 'body'],
          properties: {
            pou: { type: 'string' },
            language: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            body_error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            variables: { type: 'array', items: { type: 'object', additionalProperties: true } },
            // Informational blob straight from the engine's summary(); left
            // unconstrained on purpose so a new field there cannot make this tool
            // fail again. An empty schema node is a valid member of the subset.
            summary: {},
          },
        },
        render: (_a, v) => text(`POU ${v.pou} (${v.language ?? '?'}):\n${v.body ?? '(no ST body)'}`),
      },
      presentCall: (a) => ({ card: 'generic', title: `Read ${a.pou}`, kind: 'read' }),
      execute: (args) => runCode('read_st', { ...(args ?? {}), project: projectOf(args) }),
    },
    {
      name: 'mw_code_export_pou',
      description:
        'Export one POU to a readable file: its Structured Text body followed by its '
        + 'declarations, with the POU name, language and source path in a short header. '
        + 'This is the practical form of "export" for this IDE - the automation API also '
        + 'advertises plc_open_xml_export and iec_61131-3_file_export, but those providers '
        + 'take no arguments and are driven by IDE dialogs only, so they cannot be called '
        + 'headlessly (see docs/import-export.md). Use this to hand a POU to the user, to '
        + 'keep a copy before rewriting it, or to diff two versions. The inverse is '
        + 'mw_code_pou_create + mw_code_var_add + mw_code_write_st.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pou'],
        properties: {
          pou: { type: 'string', description: 'POU to export.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          path: {
            type: 'string',
            description: 'File to write. Defaults to <plugin>/exports/<POU>.st',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pou', 'path', 'bytes', 'lines'],
          properties: {
            pou: { type: 'string' },
            path: { type: 'string' },
            bytes: { type: 'integer' },
            lines: { type: 'integer' },
            declarations: { type: 'integer' },
          },
        },
        render: (_a, v) => text(
          `Exported '${v.pou}' to ${v.path}\n`
          + `  ${v.bytes} bytes, ${v.lines} lines, ${v.declarations} declaration(s)`,
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Export POU source', kind: 'read' }),
      execute: async (args) => {
        const pou = String(args.pou);
        const wantExport = args?.format === 'export';
        const read = await runCode('read_st', { pou, project: projectOf(args) });
        const decls = read.variables ?? [];

        let text_;
        if (wantExport) {
          // The IEC 61131-3 EXPORT format, which is what MotionWorks' own
          // `iec_61131-3_file_import` provider reads. Verified against the Extended
          // IEC 61131-2 Export that ships with the IDE: properties banner, description,
          // PROGRAM, group, declaration blocks, then the worksheet between its markers.
          //
          // This matters because it is the one supported route to a NEW DECLARATION.
          // Writing the `.VGR` grid directly is refused - a record MotionWorks disagrees
          // with makes it silently rewrite the POU - but an imported export file lets the
          // IDE build that grid itself. So: export, edit the declarations, import.
          const bySection = new Map();
          for (const v of decls) {
            const key = v.section || 'VAR';
            if (!bySection.has(key)) bySection.set(key, []);
            bySection.get(key).push(v);
          }
          const blocks = [];
          for (const [section, items] of bySection) {
            blocks.push(section);
            for (const v of items) {
              const addr = v.address ? `\tAT ${v.address} ` : '\t';
              const init = v.initial_value ? ` := ${v.initial_value}` : '';
              const desc = v.description ? `(*${v.description}*)` : '';
              blocks.push(`\t${v.name}${addr} :\t${v.type ?? '?'}${init};${desc}`);
            }
            blocks.push('END_VAR');
            blocks.push('');
            blocks.push('');
          }
          text_ = [
            '(*@PROPERTIES_EX@',
            'TYPE: POU',
            'LOCALE: 0',
            `IEC_LANGUAGE: ${read.language === 'ST' ? 'ST' : (read.language ?? 'ST')}`,
            'PLC_TYPE: independent',
            'PROC_TYPE: independent',
            '*)',
            '(*@KEY@:DESCRIPTION*)',
            '',
            '(*@KEY@:END_DESCRIPTION*)',
            `PROGRAM ${pou}`,
            '',
            '(*Group:Default*)',
            '',
            '',
            ...blocks,
            '(*@KEY@: WORKSHEET',
            `NAME: ${pou}`,
            `IEC_LANGUAGE: ${read.language === 'ST' ? 'ST' : (read.language ?? 'ST')}`,
            '*)',
            (read.body ?? '').replace(/\s+$/, ''),
            '',
            '(*@KEY@: END_WORKSHEET *)',
            'END_PROGRAM',
            '',
          ].join('\r\n');
        } else {
          // A plain readable listing: header, declarations with types and descriptions,
          // then the body. Easier for a person to read than the export format.
          text_ = [
            `(* POU: ${pou}  language: ${read.language ?? 'ST'} *)`,
            read.source_path ? `(* source: ${read.source_path} *)` : null,
            '(* --- declarations --- *)',
            ...decls.map((v) => {
              const bits = [`\t${v.name}\t:\t${v.type ?? '?'}`];
              if (v.address) bits.push(` AT ${v.address}`);
              if (v.initial_value) bits.push(` := ${v.initial_value}`);
              bits.push(';');
              if (v.description) bits.push(` (*${v.description}*)`);
              return bits.join('');
            }),
            '',
            '(* --- body --- *)',
            (read.body ?? '').replace(/\s+$/, ''),
            '',
          ].filter((l) => l !== null).join('\r\n');
        }

        const ext = wantExport ? '.ST' : '.st';
        const out = args?.path
          ? String(args.path)
          : join(HERE, 'exports', `${pou.replace(/[^\w.-]+/g, '_')}${ext}`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, text_, 'utf8');
        return {
          pou,
          path: out,
          bytes: Buffer.byteLength(text_, 'utf8'),
          lines: text_.split('\n').length,
          declarations: decls.length,
        };
      },
    },

    {
      name: 'mw_code_write_st',
      description:
        'Replace a POU\'s Structured Text body Ã¢â‚¬â€ this is how the agent writes code. Backs the '
        + 'file up first and verifies the untouched sibling streams are byte-identical. '
        + '**dry_run defaults to true**: the first call returns a preview and changes nothing. '
        + 'The IDE must be closed (mw_ide_close), because the IDE\'s cached state would '
        + 'otherwise discard the edit. After writing, reopen the project and call mw_ide_build.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pou', 'body'],
        properties: {
          pou: { type: 'string', description: 'POU name (must be a Structured Text POU).' },
          body: { type: 'string', description: 'The complete new ST body.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          dry_run: { type: 'boolean', description: 'Preview only. Defaults to true.' },
          run_lint: { type: 'boolean', description: 'Lint the body first. Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Write ${a.pou}`, kind: 'edit' }),
      execute: (args) => runCode('write_st', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_var_add',
      description:
        'GLOBAL variables work too: omit pou and the declaration goes into the resource Global_Variables.VB. The .VGR grid header is NOT updated by that write, so mw_code_globals will report a declaration-count mismatch - that is expected and harmless, verified: a .VB-only global add builds cleanly with 0 reference problems. Read globals back with mw_code_globals.'
        + 
        'The declaration is written to BOTH stores: the .VB text and the POU binary .VGR grid, at the record position its worksheet row belongs. The second store is what makes the variable USABLE - the compiler resolves variables from the grid, so a text-only declaration could be read back but never used. Verified end to end: declare, use it in the body, build clean.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', description: 'IEC data type, e.g. BOOL, INT, AXIS_REF.' },
          pou: { type: 'string', description: 'Owning POU; omit for a global variable.' },
          section: { type: 'string', description: 'VAR, VAR_INPUT, VAR_OUTPUT, VAR_GLOBAL, ...' },
          address: { type: 'string', description: 'IEC address, e.g. %IX0.0.' },
          initial_value: { type: 'string' },
          description: { type: 'string' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Add variable ${a.name}`, kind: 'edit' }),
      execute: (args) => runCode('var_add', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_var_edit',
      description:
        'Edit an existing variable declaration in place: rename it, change its type, address, '
        + 'initial value or description. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Current variable name.' },
          pou: { type: 'string', description: 'Owning POU; omit for a global variable.' },
          new_name: { type: 'string' },
          type: { type: 'string', description: 'New IEC data type.' },
          address: { type: 'string' },
          initial_value: { type: 'string' },
          description: { type: 'string' },
          clear_address: { type: 'boolean', description: 'Remove the IEC address.' },
          force: { type: 'boolean', description: 'Override the reference check.' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Edit variable ${a.name}`, kind: 'edit' }),
      execute: (args) => runCode('var_edit', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_var_delete',
      description:
        'Delete a variable declaration. Refuses while any POU body still references it, because '
        + 'that leaves a dangling reference and a failed build Ã¢â‚¬â€ pass `force` to override. '
        + '**dry_run defaults to true.** ALWAYS follow this with mw_ide_build and mw_ide_errors - a cloned POU inherits the external variable records of its template, and assigning it is what first makes the compiler check them. Measured: create, declare and add-a-global were all clean, and the ASSIGN alone turned a compiling project into 125 No-matching-global-variable errors.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
          pou: { type: 'string', description: 'Owning POU; omit for a global variable.' },
          force: { type: 'boolean' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Delete variable ${a.name}`, kind: 'delete' }),
      execute: (args) => runCode('var_delete', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_pou_create',
      description:
        'Create a new POU by cloning a template POU that already exists in the project Ã¢â‚¬â€ '
        + 'creation clones that POU\'s directory and renames its streams, so a POU cannot be '
        + 'authored from nothing. The new POU starts with the template\'s body and variables; '
        + 'use mw_code_write_st to replace the body. **dry_run defaults to true** and returns '
        + 'the plan (files it would touch, GUIDs, warnings) without changing anything.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'template'],
        properties: {
          name: { type: 'string', description: 'Name for the new POU.' },
          template: {
            type: 'string',
            description: 'Existing POU to clone. Use an ST POU (e.g. Instructions) for an ST POU.',
          },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Create POU ${a.name}`, kind: 'edit' }),
      execute: (args) => runCode('pou_create', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_pou_delete',
      description:
        'Delete a POU together with its task assignments and registry entries. The POU directory '
        + 'is moved to an archive rather than removed, so the deletion is recoverable. Refuses '
        + 'when another POU still calls it unless `force` is set. '
        + '**dry_run defaults to true** and returns the plan without changing anything.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
          force: { type: 'boolean', description: 'Delete even if another POU references it.' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Delete POU ${a.name}`, kind: 'delete' }),
      execute: (args) => runCode('pou_delete', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_tasks',
      description:
        'List the project\'s tasks and which POU is assigned to each, plus the POUs that are '
        + 'assigned to NOTHING. **Call this before claiming a new POU works.** A POU that exists '
        + 'but is assigned to no task never runs, and Ã¢â‚¬â€ measured Ã¢â‚¬â€ the build does not catch it '
        + 'either: a POU containing an undeclared variable compiled cleanly while it was '
        + 'unassigned. So a clean build is not evidence that an unassigned POU is correct. '
        + 'Assign it with mw_code_pou_assign.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['tasks', 'task_count', 'unassigned'],
          properties: {
            project: { type: 'string' },
            task_count: { type: 'integer' },
            // task name -> list of assigned POU names
            tasks: { type: 'object', additionalProperties: true },
            unassigned: { type: 'array', items: { type: 'string' } },
            unassigned_note: { type: 'string' },
          },
        },
        render: (_a, v) => {
          const lines = [`${v.task_count} task(s):`];
          for (const [task, programs] of Object.entries(v.tasks ?? {})) {
            lines.push(`  ${task}: ${programs.join(', ') || '(nothing assigned)'}`);
          }
          if ((v.unassigned ?? []).length) {
            lines.push(`NOT ASSIGNED (never run, not compile-checked): ${v.unassigned.join(', ')}`);
          }
          return text(lines.join('\n'));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'List tasks and assignments', kind: 'read' }),
      execute: (args) => runCode('tasks', { project: projectOf(args) }),
    },

    {
      name: 'mw_code_pou_assign',
      description:
        'Assign a POU to a task so it actually RUNS and is compile-checked. A POU created by '
        + 'mw_code_pou_create is not assigned to anything, so without this it is inert: nothing '
        + 'calls it and a clean build says nothing about whether it is correct. Task names come '
        + 'from mw_code_tasks (for example Start, FastTsk, MedTsk, SlowTsk, BG). '
        + '**dry_run defaults to true.**'
        + 'REFUSED - and here is what to do instead, because the agent still needs to get this done. In the MotionWorks Project Tree: right-click the task and add the program. Then call mw_code_tasks to confirm it landed; that tool reads assignments from the tree, so a successful one appears there. WHY IT IS REFUSED: writing the instance node into PROJECT.TRE makes the IDE rewrite the tree at open - Start, Global_Variables and IO_Configuration each lose a line, and the build then reports 125 No-matching-global-variable errors because the Globals node is gone. NODES.LST alone avoids the damage but the IDE discards the assignment, so the tool would report success for an effect that does not persist. RULED OUT by test, so not worth retrying: the node content, its length (9 and 10 lines), its position (before and after the children), the program compiled state, and the cycle field. The IDE keeps the marker and GUID and rebuilds the layout, so it parses the node and cannot read its fields.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'pou'],
        properties: {
          task: { type: 'string', description: 'Task to assign to, e.g. "SlowTsk".' },
          pou: { type: 'string', description: 'POU to assign.' },
          cycle: { type: 'string', description: 'Task cycle; defaults to the task\'s own style (CYCLIC).' },
          controller: { type: 'string', description: 'Controller name; defaults to MP2600iec.' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Assign ${a.pou} to ${a.task}`, kind: 'edit' }),
      execute: (args) => runCode('assign', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_pou_unassign',
      description:
        'Remove a POU\'s task assignment, so it stops being called. The POU itself stays in the '
        + 'project. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'pou'],
        properties: {
          task: { type: 'string', description: 'Task the POU is currently assigned to.' },
          pou: { type: 'string' },
          project: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Unassign ${a.pou}`, kind: 'delete' }),
      execute: (args) => runCode('unassign', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }),
    },

    {
      name: 'mw_code_unsupported',
      description:
        'Name the POUs whose bodies cannot be edited safely Ã¢â‚¬â€ graphical LD/FBD (proprietary '
        + 'binary) and compressed declaration streams. Call this before promising a change, so '
        + 'the agent never claims work it cannot do.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { project: { type: 'string' } },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'blocked'],
          properties: {
            count: { type: 'integer' },
            blocked: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_a, v) => text(v.count === 0
          ? 'Every POU has an editable ST body.'
          : `${v.count} POUs are not ST-editable:\n`
            + v.blocked.map((b) => `  ${b.name}: ${b.reason}`).join('\n')),
      },
      presentCall: () => ({ card: 'generic', title: 'Check editability', kind: 'read' }),
      execute: (args) => runCode('unsupported', { project: projectOf(args) }),
    },

    {
      name: 'mw_ide_screenshot',
      description:
        'Capture the MotionWorks IDE window to a PNG and return its path, so you can see what '
        + 'the IDE is actually showing Ã¢â‚¬â€ a dialog, the Project Tree, or the Message Window error '
        + 'list. Read the returned path with the image-reading tool.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'width', 'height'],
          properties: {
            path: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
        },
        render: (_a, v) => text(`IDE screenshot: ${v.path} (${v.width}x${v.height})`),
      },
      presentCall: () => ({ card: 'generic', title: 'Screenshot MotionWorks IDE', kind: 'read' }),
      execute: () => {
        const out = join(HERE, 'shots', `ide-${Date.now()}.png`);
        mkdirSync(dirname(out), { recursive: true });
        return verb('screenshot', { path: out }, 30000);
      },
    },
  ];
}

/**
 * Register the MotionWorks tools and own the bridge lifetime.
 *
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx) {
  for (const definition of defineTools()) {
    // `defineTool()` Ã¢â‚¬â€ which we cannot import here Ã¢â‚¬â€ wraps execute in an async
    // function, so a validation throw becomes a rejection rather than a
    // synchronous throw out of the registry's dispatch. Registering directly, we
    // must do that ourselves; otherwise an argument error like the staging guard
    // escapes the tool pipeline instead of surfacing as a tool error.
    ctx.tools.register({
      ...definition,
      async execute(args, exec) { return definition.execute(args, exec); },
    });
  }
  // Spawned lazily on first use and stopped on dispose, so unloading the plugin
  // leaves no orphan bridge process behind.
  ctx.on?.('dispose', () => { void stopBridge(); });
}

/** Exported for tests: the bridge and code helpers, without needing a Cordis context. */
export const __internals = {
  call, ensureBridge, stopBridge, verb, assertStaged, defineTools,
  runCode, pythonExe, codeSrc,
  STAGE_ROOT, BRIDGE_DIR, BRIDGE_SCRIPT, CODE_DIR, CODE_HELPER,
};
