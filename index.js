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
 * IDE-FIRST EDITING AND THE COM VERIFICATION BRIDGE
 * -----------------------------------
 * MotionWorks registers an out-of-process COM automation server
 * (`Ade.Application.550`). The bridge handles guarded inspection, project operations
 * and compilation. Coding defaults to visible native editors via the companion
 * computer-use MCP. Offline code editor tools are retired, not a UI fallback.
 * It must be driven from a 32-bit client, so the work is delegated to a 32-bit
 * Windows PowerShell bridge process that speaks req.json/res.json with this file.
 *
 * SAFETY (non-negotiable, enforced in code below)
 * ----------------------------------------------
 *  - Never download to a controller. Never command motion. No tool exists for it.
 *  - `mw_ide_open` refuses any path outside this workspace's `.motionworks/stage/` directory,
 *    so a real project tree is never opened for editing.
 *  - `mw_ide_stage` only ever copies; it never moves or deletes a source project.
 *  - The bridge refuses to instantiate COM unless an IDE is already running,
 *    because instantiating it would launch a second IDE.
 *  - Graceful close/replacement requires explicit consent tied to the open project.
 */

import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAcceptance } from './verification.js';

export const name = 'motionworks-iec-use';
export const inject = ['tools'];

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = join(HERE, 'bridge');
const BRIDGE_SCRIPT = join(BRIDGE_DIR, 'mw_bridge.ps1');
const LAUNCHER_CMD = join(BRIDGE_DIR, 'start_bridge.cmd');
const REQ = join(BRIDGE_DIR, 'req.json');
const RES = join(BRIDGE_DIR, 'res.json');
const LOG = join(BRIDGE_DIR, 'bridge.log');
function stageRoot() {
  const workspace = workspaceRoot();
  const root = join(workspace, '.motionworks', 'stage');
  if (!isInside(root, workspace)) throw new Error('REFUSED: workspace stage points outside the workspace.');
  return root;
}
// ── where this plugin is allowed to work ─────────────────────────────────────────
//
// MotionWorks projects belong in the workspace. Reaching outside it should be a decision the caller
// makes on purpose, because the alternative - which happened in use - is an agent opening a project
// on someone's Desktop that the task never mentioned.

//: The host context, kept so a tool can ask which SESSION is calling. Set once in apply().
let hostCtx = null;

//: The tool call in progress. Its agent is the session this call belongs to. Set by the
//: register wrapper and cleared when the call returns. Reading it here is how a helper
//: called deep inside a tool still knows which session asked.
const toolContext = new AsyncLocalStorage();

//: How the workspace was found, for reporting. An agent that is told "the workspace is X" can tell
//: whether X looks like its session, which is what would have caught the wrong-root bug immediately.
let workspaceSource = 'process cwd (no host lookup attempted)';

function hostGet(name) {
  // Property access on the sandbox ctx throws for any service the plugin did not
  // declare in inject. get() is the lookup that is allowed. A throw here used to
  // abort the whole search and leave the profile directory as the workspace.
  try {
    return hostCtx?.get?.(name);
  } catch {
    return undefined;
  }
}

function attachedAgent() {
  if (toolContext.getStore()?.agent) return toolContext.getStore().agent;
  try {
    return hostGet('agents')?.currentInitiator?.() ?? null;
  } catch {
    return null;
  }
}

function headerCwd(session) {
  const cwd = session?.header?.cwd ?? session?.meta?.cwd;
  return typeof cwd === 'string' && isAbsolute(cwd) ? cwd : null;
}

function idsMatch(left, right) {
  const a = String(left);
  const b = String(right);
  return a === b;
}

/**
 * The workspace THIS SESSION is working in.
 *
 * process.cwd() is the DSH process directory (the profile root). It is not a session
 * workspace. Using it made every project in the real workspace look "outside" and get
 * refused. The tool call already carries the agent, and that agent's session header cwd
 * is the folder the session was opened in. That wins. The registry is the same fact
 * when the session is a member of a workspace record. The profile directory is used
 * only when no session is attached (tests, and a direct call).
 */
function workspaceRoot() {
  const agent = attachedAgent();
  if (agent?.id) {
    const id = String(agent.id);
    const direct = headerCwd(agent.session);
    if (direct) {
      workspaceSource = `session ${id.slice(0, 12)}`;
      return direct;
    }
    try {
      const registry = hostGet('workspaceRegistry');
      const workspaces = typeof registry?.list === 'function' ? registry.list() : [];
      const owned = workspaces.find((w) => (w.sessionIds ?? []).some((s) => idsMatch(s, id)));
      if (owned?.path && isAbsolute(owned.path)) {
        workspaceSource = `workspace ${owned.title ?? owned.path}`;
        return owned.path;
      }
      const stored = headerCwd(hostGet('sessions')?.get?.(agent.id) ?? hostGet('sessions')?.get?.(id));
      if (stored) {
        workspaceSource = `session ${id.slice(0, 12)}`;
        return stored;
      }
    } catch {
      // a dead registry must not be reported as "the workspace is the profile root"
    }
    workspaceSource = `session ${id.slice(0, 12)} (no workspace path)`;
    throw new Error(
      `REFUSED: session ${id} has no workspace path. The DSH profile directory is not `
      + 'the workspace, so this call will not stage or open anything against it.',
    );
  }

  const override = process.env.MOTIONWORKS_MCP_WORKSPACE;
  if (override && isAbsolute(override) && !toolContext.getStore()) {
    workspaceSource = 'MOTIONWORKS_MCP_WORKSPACE (no session attached)';
    return override;
  }

  throw new Error('REFUSED: no session workspace is available. Attach this chat to a workspace; direct callers must set MOTIONWORKS_MCP_WORKSPACE.');
}

/** Resolve through the last existing ancestor so a junction cannot disguise an outside path. */
function canonical(p) {
  let cursor = resolve(p);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(p);
    suffix.push(cursor.slice(parent.length));
    cursor = parent;
  }
  try {
    cursor = realpathSync(cursor);
  } catch {
    return resolve(p);
  }
  for (let i = suffix.length - 1; i >= 0; i -= 1) cursor += suffix[i];
  return cursor;
}

function isInside(child, parent) {
  const root = canonical(parent).toLowerCase();
  const full = canonical(child).toLowerCase();
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep);
}

function isInsideWorkspace(target) {
  try {
    return isInside(target, workspaceRoot());
  } catch {
    return false;
  }
}

//: Directories that never hold a user's project and are expensive to walk.
const SKIP_DIRS = new Set(['node_modules', '.git', 'stage', 'backups', '__pycache__',
                           'chm_out', 'help_extract', '.dsh']);

/**
 * MotionWorks projects inside a root: a `.mwt` file is the project, and its directory is what
 * mw_ide_stage wants.
 */
function findProjects(root, maxDepth = 5) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= 50) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= 50) return;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.mwt')) {
        const full = join(dir, entry.name);
        if (!isInsideWorkspace(full)) continue;
        let bytes = 0;
        let modified = null;
        try {
          const st = statSync(full);
          bytes = st.size;
          modified = st.mtime.toISOString().slice(0, 19);
        } catch { /* unreadable is not fatal */ }
        found.push({
          name: entry.name.replace(/\.mwt$/i, ''),
          mwt: full,
          directory: dir,
          bytes,
          modified,
        });
      }
    }
  };
  walk(root, 0);
  return found;
}

// ── POUs this plugin created ─────────────────────────────────────────────────────
//
// Created POU names are diagnostic metadata only.
const createdFile = () => join(stageRoot(), 'created-pous.json');

function createdPous() {
  try {
    const raw = readFileSync(createdFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberCreated(name) {
  if (!name) return;
  try {
    mkdirSync(stageRoot(), { recursive: true });
    const known = createdPous();
    if (!known.includes(name)) known.push(name);
    writeFileSync(createdFile(), JSON.stringify(known, null, 2));
  } catch {
    // best effort: failing to record must never fail the creation itself
  }
}

function forgetCreated(name) {
  try {
    const known = createdPous().filter((n) => n !== name);
    writeFileSync(createdFile(), JSON.stringify(known, null, 2));
  } catch {
    // best effort
  }
}


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
// Current source edits use the visible IDE through the separate computer MCP.
// The Python helper supplies read-only native inspection and guarded staging/
// verification infrastructure. Historical container writers are private fixtures,
// not a public source-editing fallback.
const CODE_DIR = join(HERE, 'code');
const CODE_HELPER = join(CODE_DIR, 'mw_code.py');

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
    join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes',
      'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
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
let bridgeQueue = Promise.resolve();
function call(verb, params = {}, timeoutMs = 30000) {
  const scope = ['ping', 'stop'].includes(verb) ? {} : {
    workspace: workspaceRoot(), stage_root: stageRoot(),
  };
  const pending = bridgeQueue.then(() => callBridge(verb, { ...params, ...scope }, timeoutMs));
  bridgeQueue = pending.catch(() => {});
  return pending;
}

async function callBridge(verb, params = {}, timeoutMs = 30000) {
  const id = randomUUID();
  const tmp = `${REQ}.tmp`;
  // A new process starts ids at 1, and a previous bridge's res.json can still
  // hold id 1. Accepting that file makes a dead bridge look alive, and the
  // real request then waits out its whole timeout. Drop the old reply first.
  rmSync(RES, { force: true });
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
async function bridgeAlive(timeoutMs = 4000) {
  if (!existsSync(BRIDGE_SCRIPT)) return false;
  try {
    const reply = await call('ping', {}, timeoutMs);
    if (reply?.workspace_protocol !== 3) {
      throw new Error('OUTDATED_BRIDGE: restart the MotionWorks bridge before using workspace-bound tools.');
    }
    return true;
  } catch (error) {
    if (error.message.startsWith('OUTDATED_BRIDGE:')) throw error;
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
  if (await bridgeAlive(1500)) return;
  if (!existsSync(BRIDGE_SCRIPT)) throw new Error(`bridge script missing: ${BRIDGE_SCRIPT}`);
  mkdirSync(BRIDGE_DIR, { recursive: true });
  // A leftover request would be consumed by the new bridge on startup, and the
  // `stop` verb exits — which is how a previous run's stale request killed a
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

  // A failed ping used to wait 4s, and this loop ran 40 times, so "within 10s"
  // was really closer to three minutes. Short pings keep the budget honest.
  const started = Date.now();
  const budgetMs = 12000;
  while (Date.now() - started < budgetMs) {
    await sleep(250);
    if (await bridgeAlive(700)) return;
  }
  const waited = Math.round((Date.now() - started) / 1000);
  throw new Error(
    `the 32-bit COM bridge did not come up within ${waited}s. Check that ${PS32} and `
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
    const requestId = randomUUID();
    const codeReq = join(CODE_DIR, `req-${requestId}.json`);
    const codeRes = join(CODE_DIR, `res-${requestId}.json`);
    const cleanup = () => {
      rmSync(codeReq, { force: true });
      rmSync(codeRes, { force: true });
    };
    if (!existsSync(CODE_HELPER)) {
      reject(new Error(`code helper missing: ${CODE_HELPER}`));
      return;
    }
    const py = pythonExe();
    if (py !== 'python' && !existsSync(py)) {
      reject(new Error(`python not found at ${py} Ã¢â‚¬â€ set MW_PYTHON to a Python 3 interpreter`));
      return;
    }
    mkdirSync(CODE_DIR, { recursive: true });
    writeFileSync(codeReq, JSON.stringify(request), 'utf8');

    const child = spawn(py, [CODE_HELPER, codeVerb, codeReq, codeRes], {
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
        MOTIONWORKS_MCP_BACKUP_DIR: join(workspaceRoot(), '.motionworks', 'backups'),
        MOTIONWORKS_MCP_ROOT: stageRoot(),
        // Writes must refuse an open IDE, including an unrelated workspace project.
        MOTIONWORKS_MCP_CLOSE_IDE: '0',
        MOTIONWORKS_MCP_WORKSPACE: workspaceRoot(),
        MOTIONWORKS_MCP_STAGE: stageRoot(),
      },
    });

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error(`code engine timed out after ${timeoutMs}ms on '${codeVerb}'`));
    }, timeoutMs);

    child.on('error', (err) => { clearTimeout(timer); cleanup(); reject(err); });
    child.on('exit', () => {
      clearTimeout(timer);
      let res;
      try {
        res = JSON.parse(readFileSync(codeRes, 'utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        reject(new Error(`code engine produced no readable result for '${codeVerb}': ${err.message}`));
        return;
      } finally {
        cleanup();
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
  const root = stageRoot();
  if (!isInside(full, root)) {
    throw new Error(
      `REFUSED: '${full}' is outside the staging root '${root}'. `
      + 'Stage a copy with mw_ide_stage first; the real project trees are never opened.',
    );
  }
  return full;
}

const IDENTITY_SUFFIX = '.identity.json';

function identityPathFor(baseName) {
  return join(stageRoot(), `${baseName}${IDENTITY_SUFFIX}`);
}

function writeIdentity(record) {
  mkdirSync(stageRoot(), { recursive: true });
  writeFileSync(identityPathFor(record.name), JSON.stringify(record, null, 2));
}

function readIdentityFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The staged project whose .mwt or directory is `activePath`, if we staged it. */
/** Refuse to compile unless the open project is a staged copy of this workspace. */
async function assertIdeProjectProven() {
  const status = await verb('status', {}, 20000);
  if (!status?.is_project_open || !status.active_project) {
    throw new Error(
      'REFUSED: no project is open. Stage the workspace project and open that copy. '
      + 'Do not build whatever MotionWorks restored on startup.',
    );
  }
  assertProven(status.active_project);
  return status;
}

/** Name the project a compile ran on. Call assertIdeProjectProven before the compile. */
function tagProject(verdict, status) {
  const id = identityMatching(status.active_project);
  return {
    ...verdict,
    active_project: status.active_project,
    identity_name: id?.name ?? null,
    identity_source: id?.source ?? null,
  };
}

function identityMatching(activePath) {
  if (!activePath) return null;
  const want = resolve(String(activePath)).toLowerCase();
  let names;
  try {
    names = readdirSync(stageRoot());
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(IDENTITY_SUFFIX)) continue;
    const id = readIdentityFile(join(stageRoot(), name));
    if (!id) continue;
    const mwt = id.staged_mwt ? resolve(id.staged_mwt).toLowerCase() : '';
    const dir = id.staged_directory ? resolve(id.staged_directory).toLowerCase() : '';
    if (want === mwt || want === dir || (dir && want.startsWith(dir + sep))) return id;
  }
  return null;
}

function identityFields(id) {
  return {
    identity_name: id?.name ?? null,
    identity_source: id?.source ?? null,
    identity_workspace: id?.workspace ?? null,
  };
}

/** A .mwt or its sibling directory, for a read that must not stage or open anything. */
function resolveProjectDir(p) {
  const full = resolve(p);
  if (!existsSync(full)) throw new Error(`project not found: ${full}`);
  if (full.toLowerCase().endsWith('.mwt')) {
    const dir = full.slice(0, -4);
    if (!existsSync(dir)) throw new Error(`${full} has no project directory beside it`);
    return dir;
  }
  return full;
}

/**
 * The project a code tool should read.
 *
 * `reference: true` reads whatever path the caller names, including one outside
 * the workspace, and does not stage or open it. Every other call stays on the
 * staged copy.
 */
function projectRequest(args, extra = {}) {
  if (args?.reference === true) {
    if (!args.project) {
      throw new Error(
        'A reference read needs project set to the .mwt or the project folder. '
        + 'It only reads. It does not stage, open, or edit.',
      );
    }
    return {
      ...extra,
      project: resolveProjectDir(String(args.project)),
      reference: true,
      workspace: workspaceRoot(),
    };
  }
  return { ...extra, project: projectOf(args) };
}

const REFERENCE_PARAM = {
  type: 'boolean',
  description:
    'Read a project that is not the staged workspace copy, including one outside '
    + 'the workspace. Read-only: nothing is staged, opened, or modified.',
};

/** Check the complete tree before copying; junctions must not import another project. */
function validateCopyTree(dir) {
  if (!isInsideWorkspace(dir)) throw new Error(`REFUSED: project member outside workspace: ${dir}`);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`REFUSED: linked project member: ${path}`);
    if (!isInsideWorkspace(path)) throw new Error(`REFUSED: project member outside workspace: ${path}`);
    if (entry.isDirectory()) validateCopyTree(path);
  }
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
    in_stage: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    identity_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    identity_source: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    identity_workspace: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

// ── diagnosing a build ───────────────────────────────────────────────────────────
//
// Three of this project's worst failures were silent. This turns each into a named cause, so a
// caller that gets is_compiled=false is told what happened instead of being left with a verdict.

//: Real POU containers on this project run 1.5 KB to 60 KB. A blown resource grid is 79 MB and a
//: truncated .VB leaves the container under 1 KB, so both thresholds sit far outside the real range.
const DESTROYED_BYTES = 1_000_000;
const TRUNCATED_BYTES = 1024;

function scanPouContainers() {
  const damaged = [];
  let projects;
  try {
    projects = readdirSync(stageRoot(), { withFileTypes: true });
  } catch {
    return damaged;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const poe = join(stageRoot(), project.name, 'POE');
    let pous;
    try {
      pous = readdirSync(poe, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const pou of pous) {
      if (!pou.isDirectory()) continue;
      const file = join(poe, pou.name, 'src.st1');
      let size;
      try {
        size = statSync(file).size;
      } catch {
        continue;
      }
      if (size > DESTROYED_BYTES) damaged.push({ pou: pou.name, bytes: size, kind: 'blown' });
      else if (size < TRUNCATED_BYTES) damaged.push({ pou: pou.name, bytes: size, kind: 'truncated' });
    }
  }
  return damaged;
}

function diagnoseBuild(verdict) {
  if (verdict?.is_compiled === true) return null;

  const damaged = scanPouContainers();
  if (damaged.length) {
    const names = damaged.map((d) => `${d.pou} (${d.bytes} bytes)`).join(', ');
    return {
      kind: 'poe-damaged',
      damaged,
      explain:
        `A POU container is not a plausible size: ${names}. Real containers on this project run ` +
        '1.5 KB to 60 KB. This is the signature of the compiler DESTROYING a POU - the .VB goes to ' +
        '0 bytes and the resource grid grows to 79,432,063 bytes. This is historical evidence, ' +
        'not proof of the cause in this project. Inspect the current native sources and IDE ' +
        'diagnostics before considering approved recovery from a verified backup.',
      next: 'inspect the named POU in the IDE; obtain approval before restoring a verified backup',
    };
  }

  if (verdict?.stalled) {
    return { kind: 'stall', explain: 'Completion was not verified for this request. The IDE may be busy, blocked by a dialog, failed, or reporting a cached result.', next: 'Inspect mw_ide_state and mw_ide_errors; do not treat this as success or repair files while the IDE is open.' };
  }

  return {
    kind: 'rejected',
    explain:
      'The compiler finished and REFUSED the code. The Errors pane has messages for this - unlike ' +
      'a stall - so read it with mw_ide_errors.',
    next: 'call mw_ide_errors to read the compiler messages',
  };
}

// The engine returns `{ dry_run, result: {...} }`, and every field below describes the INSIDE of
// that `result`. With `additionalProperties: false` the wrapper itself was undeclared, so the
// harness rejected every call with `"value.result" is not a declared property` before render ran -
// the tool could not succeed at all. `additionalProperties: true` is the fix that cannot drift
// again: the engine owns the result shape and this schema documents it rather than policing it.
// `required` is gone for the same reason - it asserted a top-level `dry_run` that list mode's
// payload does not carry in the position the schema claimed.
const RESTORE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    dry_run: { type: 'boolean' },
    ok: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    // The engine's envelope. Declared so a reader of this schema sees the real shape.
    result: { type: 'object', additionalProperties: true },
    plan: { type: 'object', additionalProperties: true },
    // list mode
    snapshots: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    restorable_pous: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    most_recent: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    damaged: { oneOf: [{ type: 'array' }, { type: 'null' }] },
    // single-POU mode
    pou: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    snapshot: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    snapshot_taken: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    snapshots_available: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    before: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    after: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    restored: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    would_restore: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    bytes_restored: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    saved_current_to: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    refused: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    note: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

/**
 * Report a restore in the terms the caller asked in: a survey of what is restorable, or what one
 * restore did. Two shapes, because the tool has two modes.
 */
function renderRestore(_a, v) {
  const r = (v && v.result) || {};

  // ── list mode ────────────────────────────────────────────────────────────────
  if (typeof r.snapshots === 'number') {
    const damaged = Array.isArray(r.damaged) ? r.damaged : [];
    const who = damaged.length
      ? `DAMAGED: ${damaged.map((d) => `${d.pou} (${d.bytes} B, ${d.snapshots} snapshot(s))`).join('; ')}`
      : 'nothing looks damaged';
    return text(`${r.snapshots} snapshot(s), ${r.restorable_pous} POU(s) restorable`
      + (r.most_recent ? `, newest ${r.most_recent}` : '')
      + `. ${who}.`);
  }

  // ── one POU ──────────────────────────────────────────────────────────────────
  if (!r.pou) return text('nothing to report');

  const before = r.before ?? {};
  const after = r.after ?? {};
  const sizes = `${before.bytes ?? '?'} B -> ${after.bytes ?? '?'} B`;
  const where = r.snapshot_taken
    ? `from the snapshot taken ${r.snapshot_taken} (${r.snapshots_available} available)`
    : '';

  if (r.refused) {
    return text(`Refused to restore '${r.pou}'. ${r.refused}`);
  }
  if (r.dry_run) {
    const verdict = r.would_restore ? 'would restore' : 'would NOT restore';
    return text(`DRY RUN - nothing changed. '${r.pou}' ${verdict} ${where}. Size ${sizes}.`
      + ' Call again with dry_run:false to do it.');
  }
  if (r.restored) {
    return text(`Restored '${r.pou}' ${where}. Size ${sizes}.`
      + (r.saved_current_to
        ? ` The file it replaced was kept at ${r.saved_current_to}, so this is undoable.`
        : ''));
  }
  return text(`Could not restore '${r.pou}' ${where}. Size ${sizes}.`
    + (r.note ? ` ${r.note}` : ''));
}

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
    evidence_kind: { type: 'string', enum: ['already_up_to_date', 'observed_compile_transition', 'completion_unverified'] },
    fresh_compile: { type: 'boolean' },
    active_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    identity_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    identity_source: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    diagnosis: {
      oneOf: [{ type: 'object' }, { type: 'null' }],
      description:
        'Why the build did not succeed, worked out on the way out rather than left to the caller. '
        + 'kind is one of: poe-damaged (a POU container is not a plausible size - the compiler '
        + 'destroyed it), stall (the compiler never finished, so the Errors pane is EMPTY and '
        + 'reading it wastes the turn), rejected (the compiler finished and refused the code, so '
        + 'the Errors pane HAS messages), or null when the build was clean. explain names the cause '
        + 'and next says what to do about it.',
    },
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
function projectLine(v) {
  if (!v?.active_project && !v?.identity_name) return '';
  const name = v.identity_name ?? v.active_project;
  const from = v.identity_source ? ` Staged from ${v.identity_source}.` : '';
  return ` Project: ${name}.${from}`;
}

function renderBuild(_a, v) {
  const where = projectLine(v);
  if (!v.accepted) return text(`${v.mode}: the IDE never accepted the compile request.${where}`);
  if (v.evidence_kind === 'already_up_to_date') {
    return text(`${v.mode}: already up to date; no fresh compilation was observed.${where}`);
  }
  if (v.stalled) {
    return text(`${v.mode}: completion unverified after ${v.elapsed_s}s.${where} Inspect mw_ide_state and mw_ide_errors before proceeding.`);
  }

  return text(
    v.is_compiled
      ? `${v.mode}: compiled (is_compiled=true, ${v.elapsed_s}s); inspect Errors/Warnings separately.${where}`
      : `${v.mode}: COMPILE FAILED (is_compiled=false, ${v.elapsed_s}s).${where} `
        + 'The automation API returns the verdict but never the messages — call mw_ide_errors to '
        + 'bring the IDE Errors pane up and capture it.',
  );
}

/** Output of the code-engine write verbs (dry-run preview or a real apply). */
const WRITE_SCHEMA_NULLABLE = { type: 'object', additionalProperties: true };
const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    dry_run: { type: 'boolean' },
    result: { type: 'object', additionalProperties: true },
    plan: { type: 'object', additionalProperties: true },
    // Attached by mw_code_write_st and mw_code_pou_create when the POU they touched is assigned to
    // no task. Declared so the renderer can print it: it belongs in the rendered text, not only in
    // the value, because a warning a caller has to go looking for is one they do not read.
    unassigned_warning: { type: 'string' },
  },
};

function renderWrite(_a, v) {
  // Why Array.isArray: `text()` returns ContentBlock[] and the two branches below each build one,
  // so appending a warning has to put it INSIDE the block, not beside it. Returning
  // [block, warningString] would put a bare string where a block belongs.
  const withWarning = (blocks) => {
    if (!v?.unassigned_warning || !Array.isArray(blocks)) return blocks;
    return blocks.map((b, i) => (i === 0 && b?.type === 'text'
      ? { ...b, text: `${b.text}\n\nWARNING: ${v.unassigned_warning}` }
      : b));
  };
  const r = (v && v.result) || {};
  const p = (v && v.plan) || {};
  if (v && v.dry_run) {
    if (p.pou_name) {
      return withWarning(text(`DRY RUN Ã¢â‚¬â€ nothing changed. Plan for POU '${p.pou_name}'`
        + (p.template_name ? ` from template '${p.template_name}'` : '')
        + (p.files ? `; would touch ${p.files.length} file(s)` : '')
        + (p.referenced_by && p.referenced_by.length
          ? `; referenced by ${p.referenced_by.join(', ')}` : '')
        + (p.assigned_to && p.assigned_to.length
          ? `; assigned to tasks ${p.assigned_to.join(', ')}` : '')));
    }
    return withWarning(text(`DRY RUN Ã¢â‚¬â€ nothing changed.`
      + (r.target ? ` Would write ${r.target}` : '')
      + (r.stream ? ` (stream ${r.stream})` : '')));
  }
  if (r.applied) {
    return withWarning(text(
      `APPLIED to ${r.target} (stream ${r.stream}); ${r.before_bytes} -> ${r.after_bytes} bytes, `
      + `${r.siblings_verified} sibling streams verified unchanged.`
      + (Array.isArray(r.backups) && r.backups.length ? ` Backup: ${r.backups[0]}` : ''),
    ));
  }
  const body = Object.keys(r).length ? r : p;
  return text(`Result: ${JSON.stringify(body).slice(0, 400)}`);
}

/**
 * Report a batch declaration in the terms a batch actually has: how many landed, and WHICH failed.
 *
 * Write batches are atomic by default. Partial results occur on dry runs or only when the caller
 * explicitly requests allow_partial; name every rejected item so it can be corrected.
 */
function renderBatch(_a, v) {
  const applied = v.applied ?? 0;
  const failed = v.failed ?? 0;
  const head = `${v.dry_run ? 'DRY RUN — nothing changed. ' : ''}`
    + `${applied} of ${v.requested} declaration(s) `
    + `${v.dry_run ? 'planned' : 'applied'}${v.pou ? ` in ${v.pou}` : ' (global)'}`;
  if (!failed) return text(`${head}. All of them.`);
  const lines = (v.failures ?? []).map((f) => `  [${f.index}] ${f.name ?? '(unnamed)'}: ${f.error}`);
  return text(`${head}; ${failed} FAILED${v.dry_run ? ' in preview' : ' with explicit partial mode'}. Re-issue only these:\n`
    + lines.join('\n')
    + `\n${v.note ?? ''}`);
}

/**
 * Report a copy back: what it wrote, and whether the write landed.
 *
 * `mismatched` is the field that matters. The engine re-reads every file it wrote and compares
 * digests, so a non-empty list means the release is NOT synced even though the copy call returned
 * without raising - which is the difference between a verification and an intention.
 */
function renderSync(_a, v) {
  if (v.dry_run) {
    return text(`DRY RUN — nothing written. ${v.would_copy} file(s) would be copied to\n`
      + `  ${v.destination}\n`
      + `${v.would_skip} left alone (already identical, or not source this engine writes).`);
  }
  const bad = v.mismatched ?? 0;
  return text(`${bad ? 'NOT SYNCED — ' : 'Synced '}${v.copied} file(s) to\n`
    + `  ${v.destination}\n`
    + `${v.skipped} left alone. ${v.wrapper ?? ''}`
    + (bad ? `\n${(v.failures ?? []).map((f) => `  ${f.file}: expected ${f.expected}, got ${f.got}`).join('\n')}` : '')
    + `\nVerified by sha256 after the copy.`);
}

/**
 * Name the POUs that exist but are assigned to no task, so the caller hears it before a build.
 *
 * WHY THIS EXISTS. A POU with no task instance NEVER RUNS, and — measured — a build does not
 * flag it: a POU containing an undeclared variable compiled cleanly while it was unassigned. So
 * the two symptoms a caller actually meets are a 90-second build that ends `compiled=false` with
 * an EMPTY Errors pane, or a green build over code that does nothing. Both were hit twice in one
 * session and the cause was this, discovered afterwards.
 *
 * Best-effort by design: this is a warning attached to someone else's answer, so a failure to read
 * the task list must never turn a successful write into an error. It returns null rather than
 * guessing when it cannot tell.
 */
async function unassignedWarning(project, names) {
  try {
    const r = await runCode('tasks', { project });
    const unassigned = new Set(r?.unassigned ?? []);
    const hit = (names ?? []).filter((n) => n && unassigned.has(n));
    if (!hit.length) return null;
    return `${hit.join(', ')} ${hit.length === 1 ? 'is' : 'are'} assigned to NO TASK, so `
      + `${hit.length === 1 ? 'it' : 'they'} will never run — and a clean build does NOT prove `
      + `otherwise: a POU with an undeclared variable built cleanly while unassigned. Assign it in `
      + `the MotionWorks Project Tree (right-click the task, add the program), then confirm with `
      + `mw_code_tasks. A build attempted before that can stall for ~90s and end with an empty `
      + `Errors pane.`;
  } catch {
    // No project, no task list, or no IDE: the warning is worth having and not worth failing for.
    return null;
  }
}

/** The staged project directory for a path that may be the .mwt, the directory, or a file inside it. */function stagedProjectDir(p) {
  const staged = assertStaged(p);
  const asMwt = staged.toLowerCase().endsWith('.mwt') ? staged.slice(0, -4) : staged;
  const root = canonical(stageRoot());
  const full = canonical(asMwt);
  const rel = full.slice(root.length).replace(/^[/\\]/, '');
  const name = rel.split(/[/\\]/)[0];
  if (!name) {
    throw new Error(`REFUSED: '${staged}' is the staging root, not a project.`);
  }
  return join(root, name);
}

/**
 * Refuse a staged copy whose identity does not name a source inside this workspace.
 *
 * A directory sitting in stage/ is not enough. The identity written by mw_ide_stage is
 * what says which workspace project the copy is. Without that, the newest directory
 * was editable, including a copy whose source was never recorded.
 */
function assertProven(p) {
  const staged = assertStaged(String(p));
  const dir = stagedProjectDir(staged);
  const name = dir.slice(dir.lastIndexOf(sep) + 1);
  const id = readIdentityFile(identityPathFor(name));
  if (!id?.source) {
    throw new Error(
      `REFUSED: staged project '${name}' has no recorded source, so it will not be opened or edited. `
      + `Stage it from the workspace with mw_ide_stage. `
      + `A program elsewhere can be read with reference: true.`,
    );
  }
  if (!id.workspace || canonical(id.workspace).toLowerCase() !== canonical(workspaceRoot()).toLowerCase()
      || !isInsideWorkspace(id.source) || !isInsideWorkspace(id.source_directory ?? id.source)
      || canonical(id.staged_directory ?? '').toLowerCase() !== canonical(dir).toLowerCase()
      || canonical(id.staged_mwt ?? '').toLowerCase() !== canonical(`${dir}.mwt`).toLowerCase()) {
    throw new Error(
      `REFUSED: staged project '${name}' was copied from '${id.source}', which is outside the workspace `
      + `'${workspaceRoot()}'. Stage the workspace project. To inspect this one, use reference: true.`,
    );
  }
  return staged.toLowerCase().endsWith('.mwt') ? `${dir}.mwt` : staged;
}

function stagedProjectDirs() {
  if (!existsSync(stageRoot())) return [];
  // A staged PROJECT is a directory with a sibling `<name>.mwt`. Requiring that
  // matters: writing a POU creates stage/backups, and a plain "newest directory"
  // pick then selected the BACKUP FOLDER as the project.
  return readdirSync(stageRoot(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(stageRoot(), e.name))
    .filter((d) => existsSync(`${d}.mwt`));
}

/**
 * The project directory a code tool should act on.
 *
 * A named project must be a proven workspace copy. With no name, the only proven
 * copy is used. Several proven copies is a refusal — picking the newest one is how
 * an edit landed in the wrong project.
 */
/** An export is a text file. It does not land in another project or replace a .mwt. */
function assertExportPath(p) {
  const full = canonical(p);
  if (full.toLowerCase().endsWith('.mwt')) {
    throw new Error(`REFUSED: an export cannot replace a .mwt file ('${full}').`);
  }
  if (isInside(full, stageRoot())) {
    throw new Error(
      `REFUSED: export path '${full}' is inside the staged project. `
      + 'Write it under the workspace.',
    );
  }
  if (!isInsideWorkspace(full)) {
    throw new Error(
      `REFUSED: export path '${full}' is outside the workspace.`,
    );
  }
  return full;
}

function projectOf(args) {
  if (args?.reference === true) {
    throw new Error(
      'REFUSED: reference mode is read-only. A project outside the workspace can be inspected, '
      + 'and it is never staged, opened, or edited.',
    );
  }
  if (args?.project) {
    const proven = assertProven(String(args.project));
    return proven.toLowerCase().endsWith('.mwt') ? proven.slice(0, -4) : proven;
  }
  const eligible = [];
  const unproven = [];
  for (const dir of stagedProjectDirs()) {
    const name = dir.slice(dir.lastIndexOf(sep) + 1);
    const id = readIdentityFile(identityPathFor(name));
    try { assertProven(dir); eligible.push(dir); }
    catch { unproven.push(name); }
  }
  if (eligible.length === 1) return eligible[0];
  if (eligible.length === 0) {
    throw new Error(
      `no staged copy of a project in the workspace '${workspaceRoot()}'. `
      + (unproven.length
        ? `Ignored ${unproven.join(', ')} because they have no source inside this workspace. `
        : '')
      + 'Call mw_project_find, then mw_ide_stage.',
    );
  }
  const names = eligible.map((d) => d.slice(d.lastIndexOf(sep) + 1));
  throw new Error(
    `${eligible.length} staged workspace projects (${names.join(', ')}). `
    + 'Pass project so this cannot edit the wrong one.',
  );
}

function defineTools() {
  return [
    {
      name: 'mw_ide_edit_guide',
      description: 'IDE-first editing and engineering checklists. Read-only: does not type or edit anything. Use engineering before designing motion logic and read docs/ENGINEERING_WORKFLOW.md. Use the connected computer tool for observed editor actions; never report a checklist as completed work.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        operation: { type: 'string', enum: ['st', 'variables', 'pou', 'graphical', 'tasks', 'libraries', 'engineering'] },
      }, required: ['operation'] },
      output: {
        schema: { type: 'object', properties: {
          mode: { type: 'string' }, operation: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          action_performed: { type: 'boolean' },
          engineering_guidance: { type: 'string' },
        }, required: ['mode', 'operation', 'steps', 'action_performed'], additionalProperties: false },
        render: (_a, v) => text(JSON.stringify(v, null, 2)),
      },
      execute: args => {
        const instructions = {
          engineering: ['Read docs/ENGINEERING_WORKFLOW.md and collect operation, controller/drive/IDE/library versions, axis units, task timing and interface ownership before choosing FBs.', 'Resolve the installed FB interface and firmware release-note applicability. Historical manuals and this checklist are not proof of compatibility.', 'Define state transitions, completion evidence, continuous target sequence, registration qualification, PLC authority, stop/park and home invalidation; review numeric ranges and timing at maximum speed.', 'Create a behavioral test matrix and retain diagnostics. Edit in the IDE, finish compile/persistence verification, and explicitly separate bench/field acceptance from compiler acceptance.'],
          st: ['Open the exact POU body in the IDE and observe its language and existing text.', 'Click inside the ST editor, verify focus, then select only the intended text and type the reviewed ST.', 'Multiline input requires explicit line-break support in the computer server; Enter can submit a dialog, so use it only in a confirmed multiline editor. Inspect indentation, line count and the entire saved body.', 'Inspect the resulting text before Save; do not type into a terminal or variable-name cell.'],
          variables: ['Open the correct POU variable worksheet or Global_Variables resource worksheet.', 'Use the native insert/edit command visible in the current UI; set name, type, usage, address, initializer and description.', 'Verify cell edit mode and full committed name: typing may append to NewVar1 instead of replacing it, and Ctrl+A may select worksheet rows rather than cell text.', 'Check the row in the IDE; globals referenced by a POU also need native VAR_EXTERNAL declarations.'],
          pou: ['Select Logical POUs and use the observed native create/edit command; choose PROGRAM, FUNCTION or FUNCTION_BLOCK and the required language.', 'For rename/delete, inspect references and task instances first. Obtain required deletion confirmation.', 'Verify both the logical POU and its task assignment after Save; never patch PROJECT.TRE to complete a UI operation.'],
          graphical: ['Open the LD/FBD worksheet and inspect the actual Edit Wizard and installed library interface.', 'Insert contacts, coils, branches or FBs through native editor commands; observe pin names/directions before wiring.', 'Confirm connections and declarations visually; no arbitrary GB binary generation.'],
          tasks: ['Inspect native task properties and current instance order before editing.', 'Create/assign/unassign through the observed Project Tree commands, or supported guarded IDE object-model tools.', 'Confirm exact resource, task, instance, cycle/priority and order; a clean compile does not prove an unassigned POU executes.'],
          libraries: ['Inspect current library versions and dependent POUs first.', 'Use the native Libraries command to select the operator-approved local library and observe the imported interface.', 'Do not remove a referenced library or silently substitute another version; compile all consumers.'],
        };
        if (!instructions[args.operation]) throw new Error('Unknown IDE editing operation');
        return { mode: 'ide-first', operation: args.operation, action_performed: false,
          ...(args.operation === 'engineering' ? { engineering_guidance: readFileSync(join(HERE, 'docs', 'ENGINEERING_WORKFLOW.md'), 'utf8') } : {}), steps: [
          'Run mw_project_find and inspect mw_ide_state/mw_ide_status. If the requested verified stage is already open, continue it without restaging, closing or reopening. Otherwise stage/open only with the required exact-project consent. Preserve unsaved IDE changes before relying on disk reads.',
          'Observe MotionWorks with the computer tool. One action, then a fresh screenshot; confirm focus before typing. Stop on unexpected dialogs or project identity changes.',
          ...instructions[args.operation],
          'Use observed File > Save All before whole-project read-back; Ctrl+S may save only the active worksheet. Inspect native read-back, run a fresh Build and Make, capture Errors/Warnings, and test save/close/reopen only with consent.',
        ] };
      },
    },
    {
      name: 'mw_ide_status',
      description:
        'Detect the running MotionWorks IEC 3 Pro IDE and report its automation version, '
        + 'window handle, and whether a project is open in it. After mw_project_find, inspect this: every other '
        + 'mw_ide_* tool needs a live IDE, and this says whether one exists.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: STATUS_SCHEMA,
        render: (_a, v) => {
          if (!v.is_project_open) {
            return text(
              `MotionWorks IEC ${v.version} is running (window ${v.ide_window}), no project open.`,
            );
          }
          if (v.in_stage === false) {
            return text(
              `MotionWorks IEC ${v.version} has '${v.active_project}' open. `
              + 'That project is NOT the staged workspace copy, so it will not be compiled, '
              + 'saved, or edited. Ask the user whether the agent may save and close this named '
              + 'project before opening the staged copy. '
              + 'A project outside the workspace can be read with reference: true.',
            );
          }
          const who = v.identity_source
            ? ` Staged from ${v.identity_source} (workspace ${v.identity_workspace}).`
            : '';
          return text(
            `MotionWorks IEC ${v.version} is running (window ${v.ide_window}) `
            + `with '${v.identity_name ?? v.active_project}' open.${who}`,
          );
        },
      },
      presentCall: () => ({ card: 'generic', title: 'MotionWorks IDE status', kind: 'read' }),
      execute: async () => {
        const status = await verb('status', {}, 20000);
        const id = identityMatching(status.active_project);
        return { ...status, ...identityFields(id) };
      },
    },

    {
      name: 'mw_project_find',
      description:
        'Find MotionWorks projects INSIDE THE WORKSPACE. Call this first for any MotionWorks task, '
        + 'before mw_ide_stage: it answers "which project am I supposed to be working on" and '
        + 'mw_ide_stage will refuse a path outside the workspace. '
        + 'A MotionWorks project is a .mwt file beside its expanded directory, so each result '
        + 'returns the .mwt to pass to mw_ide_stage. '
        + 'IF THERE ARE NO PROJECTS IT SAYS SO and tells you to ask the user for the files - that is '
        + 'the intended behaviour, not a failure. Do not go looking elsewhere on the machine; a '
        + 'project outside the workspace is not one the task asked for. '
        + 'The search is bounded (5 levels, hidden and build directories skipped) so it stays fast '
        + 'on a large tree.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: {
            type: 'string',
            description: 'Directory to search. Defaults to the workspace.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['workspace', 'count', 'projects', 'guidance'],
          // workspace_source says HOW the workspace was found, so a wrong root is visible
          // in the result instead of silently pointing somewhere unexpected.
          properties: {
            workspace: { type: 'string' },
            workspace_source: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            root: { type: 'string' },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            count: { type: 'integer' },
            projects: { type: 'array' },
            guidance: { type: 'string' },
          },
        },
        // render receives (args, value). Taking only one parameter here made `v` the ARGS - an empty
        // object - so the result read as undefined and the tool said "no projects" whatever it found.
        render: (_a, v) => text(v.count
          ? `${v.count} MotionWorks project(s) in the workspace:\n`
            + v.projects.map((p) => `  ${p.name}  ${p.mwt}`).join('\n')
            + '\n\nStage one with mw_ide_stage { source: "<the .mwt>" }.'
          : `No MotionWorks projects found in ${v.root}`
            + ` (workspace from ${v.workspace_source}).\n\n${v.guidance}`),
      },
      presentCall: () => ({ card: 'generic', title: 'Find MotionWorks projects', kind: 'read' }),
      execute: async (args) => {
        const root = args?.root ? resolve(workspaceRoot(), args.root) : workspaceRoot();
        if (!isInsideWorkspace(root)) throw new Error('REFUSED: project discovery must stay inside the workspace.');
        const projects = findProjects(root);
        // A root outside the workspace is allowed - this tool only reads - but it is REPORTED
        // rather than passed over. The rule is that MotionWorks work happens in the workspace, and
        // a search that quietly wandered elsewhere would undermine it even though nothing is
        // modified. Naming it keeps the caller honest about which tree it just looked at.
        const outside = !isInsideWorkspace(root);
        return {
          workspace: workspaceRoot(),
          workspace_source: workspaceSource,
          root,
          outside_workspace: outside,
          count: projects.length,
          projects,
          guidance: projects.length
            ? (outside
              ? 'NOTE: this root is OUTSIDE the workspace. Nothing here was modified. '
                + 'Do not stage or open any of these. To inspect one, call mw_code_read_st or '
                + 'mw_code_pous with reference: true and that path. That is read-only.'
              : 'Pass one of these .mwt paths to mw_ide_stage.')
            : 'STOP AND ASK THE USER. There is no MotionWorks project in this workspace, and a '
              + 'project elsewhere on the machine is not what the task asked for. Tell the user '
              + 'what you looked for (.mwt files) and where you looked, then ask them to put the '
              + 'project in the workspace or to say which one they mean.',
        };
      },
    },
    {
      name: 'mw_ide_stage',
      description:
        'Copy a MotionWorks project into this plugin\'s staging area so it can be opened '
        + 'without touching the original. Accepts a project folder or its .mwt file, and copies '
        + 'both the .mwt and its sibling expanded directory. This only ever copies; the source '
        + 'is never modified, moved or deleted. '
        + 'THE SOURCE MUST BE INSIDE THE WORKSPACE. There is no override. A project elsewhere on '
        + 'the machine is refused, because a task that mentions MotionWorks does not mean "find '
        + 'any project anywhere". Call mw_project_find first, and if it holds nothing, STOP AND '
        + 'ASK THE USER. To look at another program for reference, read it with reference: true '
        + '— that does not stage it and does not open it. '
        + 'After the copy, the .mwt is rewritten so the path stored inside it is the staged '
        + 'directory. Left alone, opening the wrapper loads whatever directory it still names, '
        + 'which has been a project outside the workspace.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['source'],
        properties: {
          source: {
            type: 'string',
            description: 'Path to the project folder or its .mwt file. Must be inside the workspace.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['staged_mwt', 'files_copied', 'name', 'source', 'workspace'],
          properties: {
            staged_mwt: { type: 'string' },
            staged_directory: { type: 'string' },
            files_copied: { type: 'integer' },
            name: { type: 'string' },
            source: { type: 'string' },
            workspace: { type: 'string' },
            bound_to: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            previous_embedded_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          `Staged '${v.name}' from ${v.source}. `
          + (v.previous_embedded_path
            ? `The wrapper pointed at ${v.previous_embedded_path}; it now points at ${v.bound_to}. `
            : '')
          + `Open with: ${v.staged_mwt}`,
        ),
      },
      presentCall: (a) => ({
        card: 'generic', title: 'Stage project copy', kind: 'other', rawInput: a.source,
      }),
      execute: async (args) => {
        // Checked before existence, on purpose. A caller reaching outside the workspace is told
        // the rule whether or not the path is there. There is no override: an outside project
        // can be read with reference: true, and it is never staged or opened.
        const asked = resolve(workspaceRoot(), String(args.source));
        const workspace = workspaceRoot();
        if (!isInsideWorkspace(asked)) {
          throw new Error(
            `mw_ide_stage refuses '${asked}': it is outside the workspace `
            + `'${workspace}'. MotionWorks work happens on a project IN the workspace. `
            + `Call mw_project_find. If it finds nothing, STOP AND ASK THE USER — tell them `
            + `what you looked for and where, and ask them to put the project in the workspace. `
            + `Do not stage a project from elsewhere. To look at one for reference, read it with `
            + `mw_code_read_st or mw_code_pous { reference: true, project: "<path>" }.`,
          );
        }

        const source = asked;
        if (!existsSync(source)) throw new Error(`source not found: ${source}`);

        const isMwt = source.toLowerCase().endsWith('.mwt');
        const mwt = isMwt ? source : `${source}.mwt`;
        const dir = isMwt ? source.slice(0, -4) : source;
        if (!existsSync(mwt)) throw new Error(`no .mwt found at ${mwt}`);
        if (!isInsideWorkspace(mwt) || !isInsideWorkspace(dir)) {
          throw new Error('REFUSED: the wrapper and expanded project must both be inside the workspace.');
        }
        if (isInside(mwt, stageRoot()) || isInside(dir, stageRoot())) {
          throw new Error('REFUSED: stage the original workspace project, not an existing staged copy.');
        }
        validateCopyTree(dir);

        const base = mwt.slice(mwt.lastIndexOf(sep) + 1, -4);
        mkdirSync(stageRoot(), { recursive: true });
        const targetMwt = join(stageRoot(), `${base}.mwt`);
        const targetDir = join(stageRoot(), base);

        // REPLACE, do not merge. Copying onto an existing staged copy left POUs and
        // edits from the previous run in place, so "re-stage" did not produce a
        // clean copy — a repeat test then ran against a dirty project.
        const stageBoundary = resolve(stageRoot());
        for (const target of [targetMwt, targetDir]) {
          if (resolve(target).startsWith(stageBoundary + sep) || resolve(target) === targetMwt) {
            rmSync(target, { recursive: true, force: true });
          }
        }

        let copied = 0;
        try {
          copyFileSync(mwt, targetMwt);
          copied += 1;
          if (existsSync(dir) && statSync(dir).isDirectory()) {
            copyTree(dir, targetDir, () => { copied += 1; });
          }
          // The wrapper carries an absolute directory. Opening it loads THAT directory,
          // not the sibling of the file you passed. Rewrite it to the staged directory
          // before anything is allowed to open the copy.
          const bound = await runCode('bind_mwt', { mwt: targetMwt, directory: targetDir });
          const previous = Array.isArray(bound.paths) && bound.paths[0]
            ? bound.paths[0].from
            : null;
          const record = {
            name: base,
            source: mwt,
            source_directory: dir,
            workspace,
            staged_mwt: targetMwt,
            staged_directory: targetDir,
            bound_to: bound.bound_to ?? targetDir,
            previous_embedded_path: previous,
            staged_at: new Date().toISOString(),
          };
          writeIdentity(record);
          return {
            staged_mwt: targetMwt,
            staged_directory: targetDir,
            files_copied: copied,
            name: base,
            source: mwt,
            workspace,
            bound_to: record.bound_to,
            previous_embedded_path: previous,
          };
        } catch (err) {
          rmSync(targetMwt, { force: true });
          rmSync(targetDir, { recursive: true, force: true });
          throw err;
        }
      },
    },

    {
      name: 'mw_ide_open',
      description:
        'Open a staged project inside the running MotionWorks IDE. The path must be inside this '
        + 'plugin\'s stage directory; use mw_ide_stage first. If another project is already open, '
        + 'ask the user whether the agent may save and close it, then pass user_approved=true '
        + 'and its exact path as expected_project. A changed project is refused. After the IDE loads, the project it '
        + 'actually has open is compared with the path that was asked for. A mismatched project '
        + 'is left open and the call fails. Success means the staged '
        + 'workspace copy is the project in the window, and the result names where it was staged '
        + 'from.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Staged .mwt path.' },
          user_approved: { type: 'boolean', description: 'True only after the user approved saving and closing the named current project.' },
          expected_project: { type: 'string', description: 'Exact current project path named in the user approval; checked again immediately before closing it.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['requested', 'is_project_open', 'matches_request', 'in_stage'],
          properties: {
            requested: { type: 'string' },
            is_project_open: { type: 'boolean' },
            active_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            matches_request: { type: 'boolean' },
            in_stage: { type: 'boolean' },
            dismissed_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            identity_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            identity_source: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            identity_workspace: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          v.is_project_open && v.matches_request
            ? `The IDE now has '${v.identity_name ?? v.active_project}' open`
              + (v.identity_source ? `, staged from ${v.identity_source}` : '')
              + (v.dismissed_project ? `. Saved and closed the approved previous project (${v.dismissed_project}).` : '.')
            : 'OpenProject returned but the staged project is not what the IDE has open.',
        ),
      },
      presentCall: (a) => ({
        card: 'generic', title: 'Open project in IDE', kind: 'other', rawInput: a.path,
      }),
      // The bridge retries OpenProject for up to 90s while a freshly started IDE
      // initialises its project services, answers any modal prompt it raises on the
      // way, and then waits for the project to appear Ã¢â‚¬â€ so the budget here has to
      // cover all three, not just the first retry window.
      execute: async (args) => {
        const path = assertProven(String(args.path));
        const binding = await runCode('check_mwt', { project: path });
        const opened = await verb('open', {
          path, wrapper_sha256: binding.wrapper_sha256,
          user_approved: args?.user_approved === true,
          ...(args?.expected_project ? { expected_project: String(args.expected_project) } : {}),
        }, 300000);
        const id = identityMatching(opened.active_project) ?? identityMatching(path);
        return { ...opened, ...identityFields(id) };
      },
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
      execute: async () => {
        const status = await assertIdeProjectProven();
        return tagProject(await verb('make', {}, 400000), status);
      },
    },

    {
      name: 'mw_ide_build',
      description: 'Run Compile(2), which is Build, not Rebuild. Completion requires an observed pending-to-compiled transition; otherwise reports unverified. Use the observed IDE menu for Rebuild; the API is unsupported on the tested IDE.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: BUILD_SCHEMA, render: renderBuild },
      presentCall: () => ({ card: 'generic', title: 'Build in MotionWorks IEC', kind: 'execute' }),
      execute: async () => {
        const status = await assertIdeProjectProven();
        const verdict = tagProject(await verb('build', {}, 400000), status);
        // Say why, on the way out. A caller that gets is_compiled=false and nothing else has to
        // guess, and the three silent failure modes this project has are indistinguishable from
        // the one that leaves messages.
        return { ...verdict, diagnosis: diagnoseBuild(verdict) };
      },
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
        'Save the verified staged project already open in the IDE through ActiveProject.Save. '
        + 'No offline source writes. Useful after visible editor changes and native task assignment. '
        + 'Reports elapsed_s and modified/compiled flags; read saved ST/declarations back to prove '
        + 'the intended worksheets persisted. Do not assume this equals File > Save All on every '
        + 'IDE version. Requires a running IDE and refuses an unverified project.',
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
        + 'Errors (default), Warnings, Build, Info. The Errors pane also carries INFORMATIONAL lines - structure padding notes, required-memory totals, redundant-variable counts - so read them before calling a build broken. '
        + 'AN EMPTY PANE IS NOT BY ITSELF A CLEAN BUILD: this tool also reads the compile state, and '
        + 'when the pane is empty while the project is NOT compiled it says so, because that pair is '
        + 'a stall or a destroyed POU rather than success. Set screenshot:true to also capture the '
        + 'pane, and limit to raise the cap.',
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
            // The compile verdict, read on EVERY call, so an empty pane can be qualified instead
            // of reported as success. Null when the IDE would not answer - which is itself a
            // reason not to read an empty pane as clean.
            compiles: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            is_modified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            empty_means: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.count === 0) {
            // THE FIX. An empty pane used to be reported as "nothing to report", and a build that
            // had actually FAILED was read as a clean one - the caller is told the one thing that
            // is wrong about this situation, and the two causes look identical from the pane alone.
            //
            // The pane is read through MSAA and returns zero rows both when it is genuinely empty
            // and when the control cannot be read, so `count === 0` is "no messages AND no
            // evidence there are none". The compile verdict is the evidence, and it is right
            // there.
            const head = `The '${v.pane}' pane is EMPTY - it returned no lines.`;
            const shot = v.screenshot ? `\nScreenshot: ${v.screenshot} (the only other view of this pane)` : '';
            if (v.compiles === false) {
              return text(`${head}\n`
                + `BUT is_compiled=false — this is NOT a clean build. The pane is empty and the\n`
                + `project did not compile, which is a STALL or a DESTROYED POU, not success.\n`
                + `Do not treat this as a pass.  ${v.empty_means}\n`
                + `Next: mw_ide_state (is the IDE blocked on a dialog?), then mw_ide_build to retry,\n`
                + `and an approved verified backup if the build names a damaged POU.` + shot);
            }
            if (v.compiles === true && v.is_modified === true) {
              return text(`${head}\n`
                + `is_compiled=true but is_modified=true — the project is compiled and has been\n`
                + `EDITED SINCE. An empty pane is expected here, but the edits are not compiled yet,\n`
                + `so this says nothing about them. Run mw_ide_build before trusting the code.` + shot);
            }
            if (v.compiles === true) {
              return text(`${head} Consistent with the clean compile verdict `
                + `(is_compiled=true, is_modified=false), so this is a genuine clean result.` + shot);
            }
            // compiles === null: the IDE did not answer the verdict question at all.
            return text(`${head}\n`
              + `The compile verdict could NOT be read (no running IDE, or it did not answer), so\n`
              + `there is no evidence this is clean — an unreadable pane and an empty one look\n`
              + `identical here. ${v.empty_means}` + shot);
          }
          return text(`'${v.pane}': ${v.count} message(s)\n`
            + v.lines.map((l) => `  ${l}`).join('\n')
            + (v.compiles === false ? '\n(is_compiled=false)' : '')
            + (v.screenshot ? `\nScreenshot: ${v.screenshot}` : ''));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'Read MotionWorks errors', kind: 'read' }),
      execute: async (args) => {
        const pane = args?.pane ? String(args.pane) : 'Errors';
        const limit = Number.isInteger(args?.limit) ? args.limit : 200;
        const read = await verb('read_output', { pane, limit }, 60000);

        // The verdict that turns "the pane is empty" into an answer. Asked on every call
        // because it is cheap and because the empty case is exactly when it is needed; a
        // failure to read it is null, never a guess.
        let compiles = null;
        let isModified = null;
        try {
          const state = await verb('compile_state', {}, 30000);
          compiles = typeof state?.is_compiled === 'boolean' ? state.is_compiled : null;
          isModified = typeof state?.is_modified === 'boolean' ? state.is_modified : null;
        } catch { /* no IDE, or it would not answer: null is the honest report */ }

        const count = read.count ?? 0;
        const emptyMeans = count === 0
          ? 'An empty pane can mean "no messages" OR "the pane could not be read"; the compile '
            + 'state above is what tells the two apart. If you expected errors and see none, take '
            + 'the screenshot before concluding the build is clean.'
          : '';

        let shotPath = null;
        // Auto-capture when the pane is empty and the verdict says something is wrong: that is
        // the case where the screenshot is the only other evidence, and the caller has just been
        // told not to trust the empty pane.
        const wantShot = args?.screenshot || (count === 0 && compiles === false);
        if (wantShot) {
          const out = join(HERE, 'shots', `pane-${pane.replace(/\W+/g, '')}-${Date.now()}.png`);
          mkdirSync(dirname(out), { recursive: true });
          try {
            const shot = await verb('screenshot', { path: out }, 30000);
            shotPath = shot.path;
          } catch { shotPath = null; }
        }
        return {
          pane,
          count,
          lines: read.lines ?? [],
          note: read.note ?? null,
          screenshot: shotPath,
          compiles,
          is_modified: isModified,
          empty_means: emptyMeans,
        };
      },
    },

    {
      name: 'mw_ide_start',
      description:
        'Start MotionWorks IEC (a bare Mwt.exe launch, no project). Needed after mw_ide_close, '
        + 'for an approved close/reopen persistence check. Source edits happen inside the open IDE. '
        + 'Follow it with mw_ide_open to load a project: a '
        + 'freshly launched IDE has no project services until one is opened. If MotionWorks '
        + 'restores another project, it is left open until the user approves saving and closing it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exe: { type: 'string', description: 'Override the Mwt.exe path.' },
          project: { type: 'string', description: 'Staged workspace project; required when several copies exist.' },
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
            dismissed_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            foreign_project: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          `MotionWorks IEC ${v.version} running at ${v.ide_window}`
          + (v.already_running ? ' (was already up)' : ' (launched)')
          + (v.foreign_project
            ? `. Another project is open (${v.foreign_project}). Ask the user before saving and closing it; do not build it.`
            : ''),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Start MotionWorks IEC', kind: 'execute' }),
      // The bridge waits up to 300s for the window (IDE startup can exceed two
      // minutes here), so the client must allow longer than that or it gives up
      // while the bridge is still legitimately waiting.
      execute: async (args) => {
        const path = `${projectOf(args)}.mwt`;
        const binding = await runCode('check_mwt', { project: path });
        return verb('start_ide', {
          ...(args?.exe ? { exe: String(args.exe) } : {}),
          path, wrapper_sha256: binding.wrapper_sha256,
        }, 330000);
      },
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
        const state = await verb('ide_state', {}, 45000);
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
        'Close MotionWorks IEC gracefully for an explicitly approved persistence test or recovery. '
        + 'Normal code editing happens inside the open IDE; closing is not a prerequisite. '
        + 'Ask the user whether the agent may save and close MotionWorks first. Pass '
        + 'user_approved=true and the exact open project path as expected_project. '
        + 'If the project changed, the close is refused.',
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['user_approved'],
        properties: {
          user_approved: { type: 'boolean', description: 'True only after the user approved saving and closing MotionWorks.' },
          expected_project: { type: 'string', description: 'Exact open project path named in the approval. Omit only if no project is open.' },
        },
      },
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
          ? `MotionWorks closed gracefully. Continue only the approved reopen or recovery workflow.`
          : 'MotionWorks is STILL running Ã¢â‚¬â€ do not write code yet.'),
      },
      presentCall: () => ({ card: 'generic', title: 'Close MotionWorks IEC', kind: 'execute' }),
      execute: (args) => {
        if (args?.user_approved !== true) {
          throw new Error('Ask the user whether the agent may save and close MotionWorks, then pass user_approved:true.');
        }
        return verb('close_ide', {
          user_approved: true,
          ...(args?.expected_project ? { expected_project: String(args.expected_project) } : {}),
        }, 60000);
      },
    },

    // Ã¢â€â‚¬Ã¢â€â‚¬ code Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    {
      name: 'mw_code_pous',
      description:
        'List the POUs of a staged project with each one\'s language and body stream, read '
        + 'straight from the project files. `has_st_body` is the editability test: Structured '
        +         'Text POUs are editable, while graphical LD/FBD POUs are proprietary binary and are '
        + 'refused. Defaults to the staged project. Pass reference: true with a project path to '
        + 'read a different program, including one outside the workspace, without staging or opening it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          reference: REFERENCE_PARAM,
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
            read_only: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          (v.read_only ? 'READ ONLY. ' : '')
          + `${v.count} POUs:\n` + v.pous.map((p) => `  ${p.name} [${p.language ?? '?'}]`
            + (p.has_st_body ? ' editable (ST)' : ' not ST-editable')).join('\n'),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'List POUs from files', kind: 'read' }),
      execute: (args) => runCode('pous', projectRequest(args)),
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
          reference: REFERENCE_PARAM,
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
        // `(_a, r)` and not `(r)`: the harness calls render(args, value), so a single parameter
        // receives the ARGS. Written `(r)` this read `r.name`, `r.types` and `r.members` off an
        // object that has none of them, and every call rendered nothing.
        //
        // Wrapped in `text()` because `output.render` returns ContentBlock[], not a bare string.
        // Returning a string is not rejected - the harness only snapshots it as lossless JSON -
        // so it fails later and further away, in whatever consumes the content.
        render: (_a, r) => {
          if (r.name) {
            const ms = (r.members ?? []).map((m) => `${m.name}${m.array_size ? `[${m.array_size}]` : ''} : ${m.type}`).join(', ');
            return text(`${r.name} [${r.kind}] ${(r.members ?? []).length} members: ${ms}`);
          }
          const kinds = {};
          for (const t of r.types ?? []) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
          const summary = Object.entries(kinds).map(([k, v]) => `${v} ${k || 'other'}`).join(', ');
          return text(`${r.defined} data types defined in this project (${summary})`);
        },
      },
      execute: async (args) => runCode('types', projectRequest(args, {
        ...(args?.name ? { name: String(args.name) } : {}),
      })),
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
        + 'native function-block definition or mw_code_reference; a caller declaration alone does not establish pin direction. Compiler '
        + 'temporaries (__temp_1..50, s1..s7) are filtered out rather than reported as part '
        + 'of the interface.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'One block to read; omit to list all.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          reference: REFERENCE_PARAM,
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
        // `(_a, r)` and not `(r)`: see mw_code_types. Same wrong parameter, same silence.
        // `text()` for the same reason: render returns ContentBlock[].
        render: (_a, r) => {
          if (Array.isArray(r.blocks)) {
            const libs = r.blocks.filter((b) => b.library).length;
            return text(`${r.count} blocks (${libs} library): `
              + r.blocks.map((b) => `${b.name}${b.depends_on?.length ? ` <- ${b.depends_on.join(', ')}` : ''}`).join(' | '));
          }
          return text(`${r.name} (${r.assembly}) ${(r.identifiers ?? []).length} identifiers: `
            + (r.identifiers ?? []).join(', '));
        },
      },
      execute: async (args) => runCode('library', projectRequest(args, {
        ...(args?.name ? { name: String(args.name) } : {}),
      })),
    },
    {
      name: 'mw_code_reference',
      description: 'Search reviewed Yaskawa programming references with document ID, revision, section and physical PDF page links. Works offline with curated guidance; synchronized official PDFs add full-page search. Omit query to list sources/topics; pass block for one reviewed FB interface. Historical signatures are advisory until installed versions match.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string', maxLength: 256 }, source_id: { type: 'string' },
        block: { type: 'string', description: 'Function-block type, e.g. MC_ReadActualPosition.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('reference', args ?? {}),
    },
    {
      name: 'mw_code_reference_sync',
      description: 'Download and index allowlisted official Yaskawa PDFs inside this workspace .motionworks/references. No project files are transmitted. Requires network access and pypdf in the plugin Python runtime. Verifies reviewed PDF hashes before using versioned page citations; changed vendor editions require catalog review. Curated references remain usable if downloads are unavailable.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        source_ids: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['basics', 'plcopen', 'toolbox', 'quick'] } },
      } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('reference_sync', args ?? {}, 600000),
    },
    {
      name: 'mw_code_check_program',
      description: 'Read-only source-linked programming review: external/global scope and types, integer bounds, named function-block pin direction/types, and task-binding candidates. Pass pou and body to check proposed ST before writing; omit them to review existing ST POUs. Project-defined interfaces take precedence over historical vendor signatures. Reports unresolved library and graphical coverage; does not replace the compiler or modify files.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        project: { type: 'string' }, pou: { type: 'string' }, body: { type: 'string' },
      } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('check_program', { ...(args ?? {}), project: projectOf(args) }),
    },
    {
      name: 'mw_code_diagnose',
      description: 'Map exact compiler or runtime diagnostic text to documented candidate causes, read-only checks and versioned Yaskawa references. Separates compiler, runtime and IDE-state problems. Does not invent a root cause or clear alarms; unknown messages are reported unmatched.',
      parameters: { type: 'object', additionalProperties: false, required: ['message'], properties: {
        message: { type: 'string', minLength: 1, maxLength: 20000 },
      } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('diagnose', args),
    },
    {
      name: 'mw_code_pattern',
      description: 'Retrieve original, source-linked ST patterns for startup initialization, request-edge handling, cyclic sequencing and Enable/Valid position feedback. Returns declarations, body, assumptions and adaptation checks. Does not write or execute the example. Omit name to list patterns.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', enum: ['startup-initialization', 'request-edge', 'cyclic-sequence', 'cyclic-position-reader'] },
      } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('pattern', args ?? {}),
    },
    {
      name: 'mw_code_manual',
      description: 'Search installed MotionWorks PDF text and reviewed, versioned Yaskawa references. Omit term to list available manuals, CHM topic filenames and the reviewed catalog. Installed legacy text extraction is heuristic and has no verified revision/page citations; prefer mw_code_reference for source-linked programming guidance. Full PDF search requires mw_code_reference_sync; curated guidance works offline.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', description: 'Word or phrase to search for; omit to list what is available.' },
          name: { type: 'string', description: 'Restrict the search to one manual by name fragment.' },
          limit: { type: 'integer', description: 'Passages per manual; defaults to 5.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            term: { type: 'string' },
            found: { type: 'integer' },
            results: { type: 'array', items: { type: 'object', additionalProperties: true } },
            manuals: { type: 'array', items: { type: 'object', additionalProperties: true } },
            help_topics: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
        },
        // `(_a, r)` and not `(r)`: see mw_code_types. Same wrong parameter, same silence.
        // `text()` for the same reason: render returns ContentBlock[].
        render: (_a, r) => {
          if (Array.isArray(r.manuals)) {
            return text(`${r.manuals.length} manuals, ${(r.help_topics ?? []).length} help topics: `
              + r.manuals.map((m) => `${m.name}${m.readable ? '' : ' (compiled)'}`).join(' | '));
          }
          if (!r.found) return text(`no manual mentions ${r.term}`);
          const total = (r.results ?? []).reduce((n, x) => n + (x.hits ?? 0), 0);
          return text(`${total} hits for ${r.term} across ${r.found} manual(s): `
            + (r.results ?? []).map((x) => `${x.manual} (${x.hits})`).join(', '));
        },
      },
      execute: async (args) => runCode('manual', {
        ...(args?.term ? { term: String(args.term) } : {}),
        ...(args?.name ? { name: String(args.name) } : {}),
        ...(args?.limit !== undefined ? { limit: Number(args.limit) } : {}),
      }),
    },
    {
      name: 'mw_code_globals',
      description:
        'List the project VAR_GLOBAL declarations - the tags every POU can see, with type, '
        + 'group, IEC address, initial value and description. Read this BEFORE writing code that '
        + 'references a shared tag, and after native IDE Save All to confirm the '
        + 'global landed. Each consuming POU needs a matching VAR_EXTERNAL declaration. '
        + 'The automation API exposes NO project-level variable collection '
        + '(project.Variables, project.Globals and project.VariableGroups are all absent or '
        + 'empty), so the live variable model cannot show globals at all - this reads them from '
        + 'the resource declaration stream instead.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          reference: REFERENCE_PARAM,
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
            read_only: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(
          (v.read_only ? 'READ ONLY. ' : '')
          + `${v.count} global declaration(s)`
          + (v.source_stream ? ` from ${v.source_stream}` : '')
          + ':\n'
          + v.variables.slice(0, 40).map((x) => `  ${x.name} : ${x.type ?? '?'}`
            + (x.address ? `  ${x.address}` : '')
            + (x.group ? `  [${x.group}]` : '')).join('\n')
          + (v.variables.length > 40 ? `\n  â€¦ and ${v.variables.length - 40} more` : ''),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'List global variables', kind: 'read' }),
      execute: (args) => runCode('globals', projectRequest(args)),
    },

    {
      name: 'mw_code_read_st',
      description:
        'Read one POU\'s Structured Text body, exactly as the container holds it, plus its '
        + 'variable declarations. This is how the agent sees the code it is about to change. '
        + 'Pass reference: true and a project path to read a POU from another program, including '
        + 'one outside the workspace. That read does not stage, open, or modify it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pou'],
        properties: {
          pou: { type: 'string', description: 'POU name.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          reference: REFERENCE_PARAM,
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
            read_only: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            // Informational blob straight from the engine's summary(); left
            // unconstrained on purpose so a new field there cannot make this tool
            // fail again. An empty schema node is a valid member of the subset.
            summary: {},
          },
        },
        render: (_a, v) => text(`POU ${v.pou} (${v.language ?? '?'}):\n${v.body ?? '(no ST body)'}`),
      },
      presentCall: (a) => ({ card: 'generic', title: `Read ${a.pou}`, kind: 'read' }),
      execute: (args) => runCode('read_st', projectRequest(args, { pou: String(args.pou) })),
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
        + 'the native IDE editors/import dialogs; this readable export is not an import format.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pou'],
        properties: {
          pou: { type: 'string', description: 'POU to export.' },
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          path: {
            type: 'string',
            description: 'File to write. Defaults to <workspace>/.motionworks/exports/<POU>.st',
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
          ? assertExportPath(String(args.path))
          : join(workspaceRoot(), '.motionworks', 'exports', `${pou.replace(/[^\w.-]+/g, '_')}${ext}`);
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
      name: 'mw_code_eip_map',
      description:
        'Summarize the EtherNet/IP assembly map: the size each assembly DECLARES, how many words the '
        + 'project actually USES, and how many are left - so "is there room for another status '
        + 'value?" is one call instead of a reconstruction. Two sources, because they hold two '
        + 'halves of the answer: the L5X module definition gives the declared assembly size '
        + '(PrimCxnInputSize/PrimCxnOutputSize), and the project\'s own %I/%Q addresses give the used '
        + 'range. Pass both for a full answer, or either alone for that half. '
        + 'The assembly is treated as a WINDOW from the lowest address in each direction, so '
        + 'addresses belonging to a different module\'s area are reported separately rather than '
        + 'folded into the count. `next_free_word_address` is the first address past the highest one '
        + 'in use - it is arithmetic over what was read, NOT a claim that the peer program leaves it '
        + 'alone; confirm a new offset against the CompactLogix side before writing it. Read-only.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          l5x: {
            type: 'string',
            description: 'Exported L5X holding the module definition. Optional.',
          },
          project: {
            type: 'string',
            description: 'MotionWorks project directory; defaults to the staged project. Optional.',
          },
          module_name: {
            type: 'string',
            description: 'One module by name, e.g. TopCutter_MP2600iec. Defaults to the first generic ETHERNET-MODULE.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            result: {
              type: 'object',
              additionalProperties: true,
              properties: {
                assemblies: { type: 'array', items: { type: 'object', additionalProperties: true } },
                module_source: { type: 'object', additionalProperties: true },
                address_rules: { type: 'object', additionalProperties: true },
                note: { type: 'string' },
              },
            },
          },
        },
        render: (_a, v) => {
          const r = v.result ?? {};
          const lines = [];
          const mods = r.module_source?.modules ?? [];
          if (mods.length) {
            lines.push(`${mods.length} module(s); using ${mods[0].name} `
              + `(${mods[0].catalog} rev ${mods[0].revision}): `
              + `${mods[0].input_bytes} B in / ${mods[0].output_bytes} B out`);
          }
          for (const a of r.assemblies ?? []) {
            const bits = [`${a.direction}:`];
            if (a.declared_words !== undefined) bits.push(`${a.declared_words} words declared;`);
            bits.push(`${a.used_words} used;`);
            if (a.unused_words !== undefined) bits.push(`${a.unused_words} free;`);
            if (a.next_free_word_address !== undefined) {
              bits.push(`next free address ${a.next_free_word_address}`);
              bits.push(`(${a.contiguous_room_after_last} contiguous after the last one in use)`);
            }
            if (a.full) bits.push('FULL');
            if (a.addresses_outside_this_assembly) {
              bits.push(`+ ${a.addresses_outside_this_assembly.count} address(es) from another module's area`);
            }
            lines.push(bits.join(' '));
          }
          if (!lines.length) lines.push('nothing to report: pass `l5x` and/or `project`.');
          if (r.note) lines.push(r.note);
          return text(lines.join('\n'));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'Map the E/IP assemblies', kind: 'read' }),
      execute: async (args) => {
        // `project` is optional here in a way it is not elsewhere: the L5X half alone is a
        // complete answer to "how big is it", and the project half alone to "how much is used".
        const request = {
          ...(args?.l5x ? { l5x: String(args.l5x) } : {}),
          ...(args?.module_name ? { module_name: String(args.module_name) } : {}),
        };
        if (args?.l5x || args?.project || !args?.module_name) {
          request.project = projectOf(args);
        }
        return runCode('eip_map', request);
      },
    },

    {
      name: 'mw_code_validate',
      description: 'Read-only offline validation of native containers, paired declarations/grids, handles, rows, addresses and project-tree IDs/counts. Reports format refusals as errors. This is not an IDE build verdict.',
      parameters: { type: 'object', additionalProperties: false, properties: { project: { type: 'string' } } },
      output: { schema: WRITE_SCHEMA, render: renderWrite },
      execute: (args) => runCode('validate', { project: projectOf(args) }),
    },

    {
      name: 'mw_workflow_check',
      description: 'Read-only readiness report for an explicit staged project, including stale or relocated identities that other tools refuse. Reports native validation, wrapper binding, source hashes, blockers and the next safe action. Does not repair, overwrite, start the IDE or download.',
      parameters: { type: 'object', additionalProperties: false, required: ['project'], properties: { project: { type: 'string' } } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text([
        `Project: ${v.project}`, `Evidence: ${v.evidence_level}; ready for IDE open: ${v.ready_for_ide_open}`,
        ...(v.blockers ?? []).map(b => `BLOCKED ${b.code}: ${typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail)}`),
        ...(v.warnings ?? []).map(w => `WARNING ${w.pou ?? ''}: ${w.detail}`),
        `Next: ${v.next_step}`,
      ].join('\n')) },
      execute: (args) => runCode('workflow_check', { project: assertStaged(resolve(workspaceRoot(), args.project)) }),
    },

    {
      name: 'mw_code_source_manifest',
      description: 'Read-only native source stream hashes for before/after and persistence comparisons. Excludes generated compiler output. A DLL constant or IsCompiled flag is not proof these sources were compiled or downloaded.',
      parameters: { type: 'object', additionalProperties: false, properties: { project: { type: 'string' } } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`Native source: ${v.source_digest}\n${Object.keys(v.files ?? {}).length} files; ${v.note}`) },
      execute: (args) => runCode('source_manifest', { project: projectOf(args) }),
    },

    {
      name: 'mw_ide_verify',
      description: 'After native Save All and intended-change read-back, verify the exact open stage: validation, manifests, fresh Build, Make, messages and Save. With consent, close/reopen, compare persistence, then repeat fresh Build/Make and integrity checks. Retains a JSON report on failure. Never force-closes, repairs files, downloads or commands motion. Cached Make is not fresh Build.',
      parameters: { type: 'object', additionalProperties: false, required: ['project'], properties: {
        project: { type: 'string' }, close_reopen: { type: 'boolean', default: false },
        user_approved: { type: 'boolean', description: 'Explicit consent to save/close/reopen this disposable or named project. Required when close_reopen is true.' },
      } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`Acceptance: ${v.verdict}\nEvidence: ${v.report_path}\n${v.next_step}`) },
      execute: async (args) => {
        const project = projectOf(args);
        if (args.close_reopen && args.user_approved !== true) throw new Error('REFUSED: ask for consent to save/close/reopen this exact project.');
        const reportDir = join(workspaceRoot(), '.motionworks', 'verification');
        if (!isInside(reportDir, workspaceRoot())) throw new Error('REFUSED: verification directory escapes workspace.');
        const reportPath = join(reportDir, `${Date.now()}-${randomUUID()}.json`);
        const report = { project, started_at: new Date().toISOString(), verdict: 'unverified',
          report_path: reportPath, steps: [], controller_downloaded: false, motion_tested: false,
          next_step: 'Inspect the retained evidence; do not download on an unverified result.' };
        const definitions = new Map(defineTools().map(t => [t.name, t]));
        const step = async (name, input = {}) => {
          try {
            const value = await definitions.get(name).execute(input);
            report.steps.push({ tool: name, phase: report.phase ?? 'preflight', value });
            return value;
          } catch (error) {
            report.steps.push({ tool: name, phase: report.phase ?? 'preflight', error: error.message });
            throw error;
          }
        };
        try {
          const status = await assertIdeProjectProven();
          const active = resolve(String(status.active_project)).replace(/\.mwt$/i, '');
          if (active.toLowerCase() !== resolve(project).toLowerCase()) throw new Error('REFUSED: the open IDE project differs from the requested verification project.');
          return await verifyAcceptance({ project, activeProject: status.active_project,
            closeReopen: args.close_reopen === true, step, report });
        } catch (error) {
          report.error = error.message;
          report.next_step = 'Inspect this report and current IDE state. Do not retry mutations or delete locks blindly.';
          return report;
        } finally {
          report.finished_at = new Date().toISOString();
          mkdirSync(reportDir, { recursive: true });
          const temp = reportPath + '.tmp';
          writeFileSync(temp, JSON.stringify(report, null, 2), 'utf8');
          renameSync(temp, reportPath);
        }
      },
    },






    {
      name: 'mw_code_sync_back',
      description:
        'Copy the STAGED edit back to the real project it was staged from - the step the release '
        + 'loop: edit in IDE -> Save All -> read back -> fresh Build/Make -> approved reopen '
        + 'and recompile -> separately authorized source-only promotion. Do not restage over edits. '
        + 'It carries SOURCE ONLY: the POU containers (src.st1), declaration and grid streams, the '
        + 'project tree, the type list and the resource files. It does NOT carry the .mwt wrapper, '
        + 'whose stored path is bound to the stage and would point the real project at a temporary '
        + 'copy of itself, and it does NOT carry compiler output (.DLL/.pdb) or scratch files. '
        + 'Measured on the TopCutter project: 8 files, where a blanket "everything that changed" '
        + 'copy selected 90 and led with compiled DLLs. '
        + 'The destination is the source directory mw_ide_stage recorded, and it is refused unless '
        + 'that recording proves it lies inside the workspace. Every file is verified by sha256 '
        + 'after the copy, so a non-empty `failures` means the release is NOT synced. '
        + '**dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Staged project directory or its .mwt.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            dry_run: { type: 'boolean' },
            staged: { type: 'string' },
            destination: { type: 'string' },
            would_copy: { type: 'integer' },
            would_skip: { type: 'integer' },
            copied: { type: 'integer' },
            // A dry run reports `skipped` as the file list it did not touch; an applied run reports
            // it as a count. The schema says both, because both are real - and the harness rejects
            // a value its own schema does not accept, which is exactly what this caught when the
            // first draft declared only the integer.
            skipped: {
              oneOf: [
                { type: 'integer' },
                { type: 'array', items: { type: 'object', additionalProperties: true } },
              ],
            },
            mismatched: { type: 'integer' },
            files: { type: 'array', items: { type: 'object', additionalProperties: true } },
            failures: { type: 'array', items: { type: 'object', additionalProperties: true } },
            wrapper: { type: 'string' },
            note: { type: 'string' },
          },
        },
        render: renderSync,
      },
      presentCall: () => ({ card: 'generic', title: 'Copy the stage back to the project', kind: 'edit' }),
      execute: (args) => runCode('sync_back', {
        ...(args ?? {}), project: projectOf(args), dry_run: args?.dry_run !== false,
      }, 600000),
    },

    {
      name: 'mw_code_wrapper_binding',
      description:
        'Read-only: how a staged project\'s .mwt wrapper is bound, and whether it is STALE. '
        + 'mw_ide_open refuses a wrapper whose stored path is not the staged directory, and that '
        + 'refusal can appear after native project metadata changes. Re-staging to '
        + 'clear it is the wrong remedy - it overwrites the stage and takes the new POU with it - '
        + 'so this reports which wrapper is stale and whether re-binding is enough, before anything '
        + 'tries to open it. Omit project to check every staged project.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'One staged project; omit to check them all.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            count: { type: 'integer' },
            stale: { type: 'integer' },
            wrappers: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_a, v) => text(
          (v.count === 0
            ? 'No staged project has a wrapper to check.'
            : (v.stale === 0
              ? `${v.count} wrapper(s), all bound to their staged directory.`
              : `${v.stale} of ${v.count} wrapper(s) are STALE - mw_ide_open will refuse them.`)
            + (v.wrappers ?? []).map((w) => `\n  ${w.wrapper}`
              + (w.error ? ` ERROR ${w.error}`
                : (w.stale_paths ?? []).length
                  ? ` -> names ${w.stale_paths.join(', ')}; should name ${w.should_name}`
                  : ' ok')).join('')),
        ),
      },
      presentCall: () => ({ card: 'generic', title: 'Check wrapper binding', kind: 'read' }),
      execute: (args) => runCode('wrapper_binding', args?.project ? { project: String(args.project) } : {}),
    },

    {
      name: 'mw_code_rebind_wrapper',
      description:
        'Point a staged .mwt back at its staged directory, IN PLACE, so mw_ide_open will accept it. '
        + 'This is the remedy for a wrapper reported stale by mw_code_wrapper_binding - and it is '
        + 'the alternative to re-staging, which would overwrite the staged project and take any POU '
        + 'created since with it. Idempotent and cheap when already bound: measured, an already-bound '
        + 'wrapper reports would_change=false and the file digest is unchanged, so it is safe to call '
        + 'unconditionally rather than working out whether it is needed. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['mwt'],
        properties: {
          mwt: { type: 'string', description: 'The staged .mwt wrapper to re-bind.' },
          directory: { type: 'string', description: 'Staged project directory; defaults to the wrapper\'s own name.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            dry_run: { type: 'boolean' },
            changed: { type: 'boolean' },
            would_change: { type: 'boolean' },
            bound_to: { type: 'string' },
            stores: { type: 'array', items: { type: 'string' } },
            stale_paths: { type: 'array', items: { type: 'string' } },
            paths: { type: 'array', items: { type: 'object', additionalProperties: true } },
            note: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.dry_run) {
            return text(v.would_change
              ? `DRY RUN — this wrapper is STALE and would be re-bound to\n  ${v.bound_to}`
                + `\nIt currently names: ${(v.stale_paths ?? []).join(', ')}`
              : `DRY RUN — already bound to ${v.bound_to}; re-binding would change nothing.`);
          }
          return text(v.changed
            ? `Re-bound to ${v.bound_to}. Rewrote: `
              + (v.paths ?? []).map((p) => `${p.from} (${p.stream})`).join(', ')
            : `Already bound to ${v.bound_to}; nothing changed.`);
        },
      },
      presentCall: () => ({ card: 'generic', title: 'Re-bind the .mwt wrapper', kind: 'edit' }),
      execute: (args) => runCode('rebind_wrapper', {
        ...(args ?? {}), dry_run: args?.dry_run !== false,
      }, 120000),
    },



    {
      name: 'mw_code_task_create',
      description:
        'Create a task in the project, through the IDE\'s own object model - '
        + 'resource.Tasks.Create(name, cycle) then Save(), so the IDE writes the project tree '
        + 'itself and nothing here edits a file. This is the counterpart of mw_code_pou_assign: '
        + 'assign puts a program INTO a task, and this makes the task to put it in. Measured: the '
        + 'task survives the save, appears to mw_code_tasks (which reads the tree) and to '
        + 'mw_code_task_model (which reads COM), and is still there after a close and reopen. '
        + 'The cycle is the task\'s Type as the IDE reports it - this project uses DEFAULT for the '
        + 'background task, CYCLIC for the periodic ones, and SYSTEM for Start. A task starts with '
        + 'no programs assigned; use mw_code_pou_assign to add them. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Name for the new task, e.g. "MyTsk".' },
          kind: { type: 'string', description: 'Cycle type: CYCLIC (default), DEFAULT or SYSTEM.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Create task ${a.name}`, kind: 'edit' }),
      execute: async (args) => {
        const name = args?.name;
        if (typeof name !== 'string' || !name.trim() || name.length > 7) {
          throw new Error('MotionWorks IEC task names must contain 1 to 7 characters.');
        }
        if (args?.dry_run !== false) {
          let existing = null;
          try { existing = (await verb('task_model', {}, 60000)).tasks ?? null; } catch { /* */ }
          const names = existing ? Object.keys(existing) : null;
          return {
            dry_run: true,
            would_create: { name, kind: args?.kind ?? 'CYCLIC' },
            existing_tasks: names,
            note: names?.includes(name)
              ? `a task named ${name} already exists`
              : `This would call Tasks.Create('${name}', '${args?.kind ?? 'CYCLIC'}') then save. Pass dry_run:false to do it.`,
          };
        }
        return verb('create_task', {
          name: String(name),
          ...(args?.kind ? { kind: String(args.kind) } : {}),
        }, 120000);
      },
    },

    {
      name: 'mw_code_task_delete',
      description:
        'Delete a task, through the IDE\'s own object model - Task.Delete() then Save(). Refuses '
        + 'while programs are still assigned to it, and names them, because deleting a task that '
        + 'is running code should be deliberate. Unassign first with mw_code_pou_unassign, or use '
        + 'the IDE POU delete command to remove the programs themselves. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Task to delete.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Delete task ${a.name}`, kind: 'edit' }),
      execute: async (args) => {
        const name = args?.name;
        if (args?.dry_run !== false) {
          let info = null;
          try { info = (await verb('task_model', {}, 60000)).tasks?.[name] ?? null; } catch { /* */ }
          return {
            dry_run: true,
            would_delete: name,
            currently: info,
            note: !info
              ? `no task named ${name}`
              : (info.instances ?? []).length
                ? `task ${name} has ${info.instances.length} program(s) assigned; unassign them first`
                : `This would delete task ${name} and save. Pass dry_run:false to do it.`,
          };
        }
        return verb('delete_task', { name: String(name) }, 120000);
      },
    },

    {
      name: 'mw_code_task_model',
      description:
        'Read every task and its assigned programs through the IDE\'s own COM object model - a '
        + 'SECOND SOURCE OF TRUTH beside mw_code_tasks, which reads PROJECT.TRE. The tree is what '
        + 'the IDE wrote at the last save; this is what the IDE holds in memory now, so when the '
        + 'two agree the assignment is both made and saved. Each task reports its name, its cycle '
        + '(DEFAULT, CYCLIC, SYSTEM) and every program instance with its instance name, program '
        + 'type and logical name. Use it to confirm an assignment made by mw_code_pou_assign. '
        + 'Read-only.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            tasks: { type: 'object', additionalProperties: true },
            source: { type: 'string' },
          },
        },
        render: (_a, v) => {
          const rows = Object.entries(v.tasks ?? {});
          // `text` is not decoration. A render that returns a bare string hands the harness a
          // primitive where it expects content blocks, and the spill policy's
          // `content.some(block => block.type === 'image')` then fails with
          // "content.some is not a function" before this output is ever shown. The bridge
          // answered this verb correctly the whole time (bridge.log records ok=True).
          if (!rows.length) return text('no tasks');
          return text(rows.map(([k, t]) => `${k} [${t.cycle ?? '?'}] `
            + ((t.instances ?? []).map((i) => i.name).join(', ') || '(none)')).join('\n'));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'Read tasks through COM', kind: 'read' }),
      execute: () => verb('task_model', {}, 60000),
    },

    {
      name: 'mw_code_tasks',
      description: 'List native task instances in execution order and program names without matching instance names. Unmatched names are review candidates: an instance name can differ from its program type, and indirect calls need inspection. Confirm actual bindings and startup/cyclic context in the IDE; this tool does not create task assignments.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project directory; defaults to the staged project.' },
          reference: REFERENCE_PARAM,
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
            // DECLARED because the engine RETURNS it, and an undeclared field under
            // `additionalProperties: false` is not ignored - the harness REJECTS the whole value
            // with `"value.next_step" is not a declared property`, before render is ever called.
            // So this tool's promise to tell the caller what to do next was not merely dropped
            // from the output; it failed every call. Found by test/render_contract.mjs phase 2.
            next_step: { type: 'string' },
            read_only: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => {
          const lines = [`${v.task_count} task(s):`];
          for (const [task, programs] of Object.entries(v.tasks ?? {})) {
            lines.push(`  ${task}: ${programs.join(', ') || '(nothing assigned)'}`);
          }
          if ((v.unassigned ?? []).length) {
            lines.push(`TASK BINDING NEEDS REVIEW (instance names may differ): ${v.unassigned.join(', ')}`);
          }
          if (v.unassigned_note) lines.push(v.unassigned_note);
          if (v.next_step) lines.push(`NEXT: ${v.next_step}`);
          return text(lines.join('\n'));
        },
      },
      presentCall: () => ({ card: 'generic', title: 'List tasks and assignments', kind: 'read' }),
      execute: (args) => runCode('tasks', projectRequest(args)),
    },

    {
      name: 'mw_code_pou_assign',
      description:
        'Assign a program to a task so it actually RUNS and is compile-checked. An unassigned POU '
        + 'may be inert: nothing '
        + 'calls it and a clean build says nothing about whether it is correct. '
        + 'This goes through the IDE\'s own object model - task.ProgramInstances.Create then '
        + 'Save() - so the IDE writes the project tree itself and nothing here edits a file. The '
        + 'IDE also VALIDATES: an instance that already exists reports "ProgramInstance already '
        + 'exists" and an unknown program type reports "Unknown Program type" rather than '
        + 'producing something broken. Task names come from mw_code_tasks (Start, FastTsk, '
        + 'MedTsk, SlowTsk, BG). Confirm from the tree side with mw_code_tasks and from the COM '
        + 'side with mw_code_task_model. **dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'pou'],
        properties: {
          task: { type: 'string', description: 'Task to assign to, e.g. "SlowTsk" or "BG".' },
          pou: { type: 'string', description: 'Program to assign; also the instance name.' },
          instance: { type: 'string', description: 'Instance name; defaults to the POU name.' },
          type: { type: 'string', description: 'Program type; defaults to the POU name.' },
          dry_run: { type: 'boolean', description: 'Report what would happen without doing it. Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Assign ${a.pou} to ${a.task}`, kind: 'edit' }),
      execute: async (args) => {
        const task = args?.task;
        const pou = args?.pou;
        if (args?.dry_run !== false) {
          let current = null;
          try {
            const m = await verb('task_model', {}, 60000);
            current = m?.tasks?.[task]?.instances?.map((i) => i.name) ?? null;
          } catch { /* report what we have */ }
          return {
            dry_run: true,
            would_assign: { task, pou, instance: args?.instance ?? pou, type: args?.type ?? pou },
            currently_assigned: current,
            note: current?.includes(pou)
              ? `${pou} is ALREADY assigned to ${task}; assigning again would report "ProgramInstance already exists".`
              : `This would call ProgramInstances.Create on task ${task}, then save. Pass dry_run:false to do it.`,
          };
        }
        return verb('assign_pou', {
          task: String(task), pou: String(pou),
          ...(args?.instance ? { instance: String(args.instance) } : {}),
          ...(args?.type ? { type: String(args.type) } : {}),
        }, 120000);
      },
    },

    {
      name: 'mw_code_pou_unassign',
      description:
        'Remove a program\'s assignment from a task, through the IDE\'s own object model - '
        + 'ProgramInstances.Delete() then Save() - so the IDE writes the project tree itself and '
        + 'nothing here edits a file. The program itself is NOT deleted; it stays in Logical POUs '
        + 'and simply stops running. Compare with the IDE POU delete command, which removes the POU. '
        + '**dry_run defaults to true.**',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'pou'],
        properties: {
          task: { type: 'string', description: 'Task the program is assigned to.' },
          pou: { type: 'string', description: 'Instance name to remove, as mw_code_tasks shows it.' },
          dry_run: { type: 'boolean', description: 'Defaults to true.' },
        },
      },
      output: { schema: WRITE_SCHEMA_NULLABLE, render: renderWrite },
      presentCall: (a) => ({ card: 'generic', title: `Unassign ${a.pou} from ${a.task}`, kind: 'edit' }),
      execute: async (args) => {
        const task = args?.task;
        const pou = args?.pou;
        if (args?.dry_run !== false) {
          let current = null;
          try {
            const m = await verb('task_model', {}, 60000);
            current = m?.tasks?.[task]?.instances?.map((i) => i.name) ?? null;
          } catch { /* report what we have */ }
          return {
            dry_run: true,
            would_unassign: { task, pou },
            currently_assigned: current,
            note: current && !current.includes(pou)
              ? `${pou} is not assigned to ${task}; there is nothing to remove.`
              : `This would delete the ${pou} instance from task ${task}, then save. Pass dry_run:false to do it.`,
          };
        }
        return verb('unassign_pou', { task: String(task), pou: String(pou) }, 120000);
      },
    },

    {
      name: 'mw_code_unsupported',
      description: 'Inspect offline-reader limitations for graphical LD/FBD and compressed declaration streams. These limits do not prohibit native IDE editing; use mw_ide_edit_guide and the companion computer tool.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string' },
          reference: REFERENCE_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'blocked'],
          properties: {
            count: { type: 'integer' },
            blocked: { type: 'array', items: { type: 'object', additionalProperties: true } },
            read_only: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            outside_workspace: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        render: (_a, v) => text(v.count === 0
          ? 'Every POU has an editable ST body.'
          : `${v.count} POUs are not ST-editable:\n`
            + v.blocked.map((b) => `  ${b.name}: ${b.reason}`).join('\n')),
      },
      presentCall: () => ({ card: 'generic', title: 'Check editability', kind: 'read' }),
      execute: (args) => runCode('unsupported', projectRequest(args)),
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
  // ── WHY THIS PLUGIN LOADS ON macOS AND LINUX, AND IMMEDIATELY STOPS ────────────────────────
  //
  // Everything below this line drives MotionWorks IEC 3 Pro, which is a Windows application: it
  // reaches it through COM, through a PowerShell bridge, and through an MTA-pinned Python child.
  // None of that exists anywhere else, so on another platform there is nothing to operate.
  //
  // The plugin still LOADS there, and that is deliberate rather than an oversight. Its manifest
  // used to declare `"os": ["win32"]`, which is correct about the plugin and fatal about shipping
  // it: `os` is an install-time platform gate, and a REQUIRED dependency that does not match the
  // host fails `pnpm install` outright with ERR_PNPM_UNSUPPORTED_PLATFORM rather than being
  // skipped. This plugin is meant to be built into every AryaAI install, and the harness has Linux
  // and macOS CI lanes and release targets - so a required `os: win32` edge would have broken the
  // install for everyone who is not on Windows, to no benefit.
  //
  // Declaring no `os` and refusing at apply() instead is the shape the repo already uses for
  // platform-specific payloads: the dependency edge stays installable everywhere, and the plugin
  // itself states the limitation where a caller can read it.
  if (process.platform !== 'win32') {
    try {
      ctx.logger?.info?.(
        'motionworks-iec-use: not loaded. This plugin drives the MotionWorks IEC 3 Pro IDE, which '
        + `is a Windows application, and this host is ${process.platform}. No tools or skill are `
        + 'registered.',
      );
    } catch { /* a logger that refuses must not turn an unsupported host into a crash */ }
    return;
  }

  // Kept for per-call workspace lookup: currentInitiator() reports the agent for the
  // current driver chain, so it can only be asked while a tool is executing.
  hostCtx = ctx;

  // THE SKILL, REGISTERED — and until this existed it was never registered at all.
  //
  // SKILL.md has shipped in this package the whole time and nothing ever loaded it: the cordis
  // patch registers the plugin row and nothing else, and this file had no reference to it. So the
  // workspace rule was written down at line 764 of 777, in a document no agent ever opened, and the
  // owner reported a third time that a project outside the workspace had been opened. Correctly —
  // the rule had never once reached the agent that was breaking it.
  //
  // register() files into the calling context's layer, and a plugin mounted from the profile lands
  // in the GLOBAL layer, so this reaches every agent in every workspace rather than only a session
  // that happens to share this plugin's directory.
  //
  // The description and whenToUse carry the rule as much as the body does, because those are what an
  // agent sees WITHOUT loading the skill. A rule that lives only in the body applies only to agents
  // who already decided to read it.
  try {
    const skills = ctx.get?.('skills');
    if (skills?.register) {
      const raw = readFileSync(fileURLToPath(new URL('./SKILL.md', import.meta.url)), 'utf8');
      // Drop the YAML frontmatter: those fields go through the registration instead, so leaving
      // them in `content` would show the agent a second copy of its own description.
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      // CALLED DIRECTLY, not inside ctx.effect(). The contract is "register a borrowed readonly
      // runtime skill into the calling context's layer ... synchronously during plugin apply", and
      // "fiber disposal unregisters the provider" - so the host already owns teardown, the same way
      // it does for ctx.tools.register on the next line. Wrapping it in an effect was wrong twice
      // over: the effect never ran under a context that only records them, and a skill registered
      // inside one is not registered during apply at all.
      skills.register({
        name: 'motionworks-iec-use',
        description: 'Operate a running Yaskawa MotionWorks IEC 3 Pro IDE and edit its code — stage '
          + 'and open a project, read the live object model, read and rewrite POU Structured Text, '
          + 'add variable declarations, compile, and read the compiler verdict and error text. '
          + 'START HERE: run mw_project_find before anything else, and work only on a project inside '
          + 'the workspace — never one from elsewhere on the machine, even if you know where it is. '
          + 'Another program may be read with reference: true; that does not stage or open it. '
          + 'Edit through the companion computer-use MCP after verifying the staged IDE project. Preserve unsaved changes. '
          + 'For motion design/diagnosis, use the engineering guide and complete the authorized read-back, fresh compile, approved reopen/recompile and evidence handoff loop.',
        whenToUse: 'The user has MotionWorks IEC 3 Pro open or asks for work in it — a real build, a '
          + 'compile verdict, the live project model, reading or changing POU Structured Text, or '
          + 'the IDE error list. ALSO USE WHEN a MotionWorks project is mentioned at all, even to '
          + 'ask a question about it, because the first step is always to find which project is '
          + 'actually in the workspace.',
        content: body,
        source: 'bundled',
        provider: 'dsh-motionworks-iec-use',
        invocation: { modelInvocable: true, userInvocable: true },
      });
    }
  } catch (e) {
    // A skill that failed to register must not take the tools with it: the tools are the part that
    // does the work, and a missing catalogue entry is a smaller loss than a dead plugin.
    try { ctx.logger?.warn?.(`motionworks-iec-use: could not register the skill: ${e?.message ?? e}`); } catch { /* ignore */ }
  }

  for (const definition of defineTools()) {
    // `defineTool()` Ã¢â‚¬â€ which we cannot import here Ã¢â‚¬â€ wraps execute in an async
    // function, so a validation throw becomes a rejection rather than a
    // synchronous throw out of the registry's dispatch. Registering directly, we
    // must do that ourselves; otherwise an argument error like the staging guard
    // escapes the tool pipeline instead of surfacing as a tool error.
    ctx.tools.register({
      ...definition,

      async execute(args, exec) {
        return toolContext.run(exec ?? {}, () => definition.execute(args, exec));
      },
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
  get STAGE_ROOT() { return stageRoot(); }, workspaceRoot, assertProven, projectOf, BRIDGE_DIR, BRIDGE_SCRIPT, CODE_DIR, CODE_HELPER,
};
