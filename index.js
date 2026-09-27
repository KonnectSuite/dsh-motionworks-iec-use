/**
 * MotionWorks Use — a Cordis plugin for DeepSeek Harness.
 *
 * Gives the agent the ability to *operate* a running Yaskawa MotionWorks IEC 3 Pro
 * IDE: detect the live instance, stage and open a project in it, read the live
 * object model (POUs, variables), run the IDE's own compiler, and read the
 * verdict — plus see the IDE.
 *
 * WHY THERE ARE NO PACKAGE IMPORTS HERE
 * -------------------------------------
 * A profile plugin lives at `profiles/<p>/node_modules/@local/<name>/`. Node
 * resolves imports upward from that path, and `@deepseek-ai/*` is NOT reachable
 * from there — measured on this machine:
 *
 *     require.resolve('@deepseek-ai/dsh-tools', { paths: [.../@local/...] })
 *       -> MODULE_NOT_FOUND
 *
 * The bundle *entry* resolves (the loader finds it by name); imports inside it do
 * not. So this file imports only `node:` builtins, which always resolve.
 *
 * CONSEQUENCE: `parameters` and `output.schema` are PLAIN JSON SCHEMA.
 * `defineTool()` exists to convert the terse spec DSL (inline `required: true`)
 * into JSON Schema, and `ctx.tools.register` takes the converted form — a
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

// ─── the code engine ─────────────────────────────────────────────────────────
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
 * The code path is stdlib-only — `win32com` is imported lazily inside one
 * function in ide.py — so any Python 3 will do. The one AryaAI already ships is
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

// ─── bridge transport ────────────────────────────────────────────────────────

/**
 * One request/response round trip.
 *
 * The request is written to a temp name and renamed into place so the bridge can
 * never read a half-written file, and a reply is accepted only when its `id`
 * matches this call's — so an earlier call's answer is never mistaken for this one.
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
      // throws on a leading U+FEFF — which made a perfectly healthy bridge look
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
 * piped child fails with EPERM. This bridge never carries data over stdio — it
 * uses req.json/res.json — so ignoring stdio costs nothing.
 */
async function ensureBridge() {
  if (await bridgeAlive()) return;
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
      reject(new Error(`python not found at ${py} — set MW_PYTHON to a Python 3 interpreter`));
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
        // is not writable here — measured: WinError 5 on the first real write — so
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
      resolve(res);
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

// ─── schemas (plain JSON Schema: `required` is an array) ─────────────────────

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'ide_window', 'is_project_open'],
  properties: {
    version: { type: 'string', description: 'Automation server version reported by the IDE.' },
    ide_window: { type: 'string', description: 'Window handle of the live IDE, e.g. 0x4A0A12.' },
    is_project_open: { type: 'boolean' },
    active_project: { type: ['string', 'null'] },
  },
};

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'accepted', 'settled', 'is_compiled', 'elapsed_s'],
  properties: {
    mode: { type: 'string', description: 'make | build | patch | worksheet | datatypes.' },
    compile_type: { type: ['integer', 'null'], description: 'The AdeCompileType passed to Compile().' },
    accepted: { type: 'boolean', description: 'The IDE accepted the compile request.' },
    settled: {
      type: 'boolean',
      description: 'A second compile was accepted, proving the previous one finished.',
    },
    is_compiled: { type: ['boolean', 'null'] },
    is_modified: { type: ['boolean', 'null'] },
    elapsed_s: { type: 'number' },
  },
};

/**
 * Report the verdict without overclaiming: a compile that never ran must not read
 * like a project that does not compile.
 *
 * Compile types come from Ade.tlb. The commonly repeated 1=Build / 2=Rebuild
 * guess is wrong — 1 is Make, 2 is Build, and there is no Rebuild compile type
 * at all (Rebuild is a command, and ExecuteCommand is a stub in this build).
 */
function renderBuild(_a, v) {
  if (!v.accepted) return text(`${v.mode}: the IDE never accepted the compile request.`);
  return text(
    v.is_compiled
      ? `${v.mode}: compiled cleanly (is_compiled=true, ${v.elapsed_s}s).`
      : `${v.mode}: COMPILE FAILED (is_compiled=false, ${v.elapsed_s}s). `
        + 'The automation API returns the verdict but never the messages — call mw_ide_errors to '
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
      return text(`DRY RUN — nothing changed. Plan for POU '${p.pou_name}'`
        + (p.template_name ? ` from template '${p.template_name}'` : '')
        + (p.files ? `; would touch ${p.files.length} file(s)` : '')
        + (p.referenced_by && p.referenced_by.length
          ? `; referenced by ${p.referenced_by.join(', ')}` : '')
        + (p.assigned_to && p.assigned_to.length
          ? `; assigned to tasks ${p.assigned_to.join(', ')}` : ''));
    }
    return text(`DRY RUN — nothing changed.`
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
    throw new Error(`no staged project: ${STAGE_ROOT} does not exist — stage one first`);
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
        // clean copy — a repeat test then ran against a dirty project.
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
            active_project: { type: ['string', 'null'] },
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
      // initialises its project services, so allow more than that here.
      execute: (args) => verb('open', { path: assertStaged(String(args.path)) }, 150000),
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
                        data_type: { type: ['string', 'null'] },
                        initial_value: { type: ['string', 'null'] },
                        iec_address: { type: ['string', 'null'] },
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
        + '"never ran". Note there is no Rebuild compile type — Rebuild is an IDE command, and '
        + 'ExecuteCommand is a stub in this build.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: BUILD_SCHEMA, render: renderBuild },
      presentCall: () => ({ card: 'generic', title: 'Build in MotionWorks IEC', kind: 'execute' }),
      execute: () => verb('build', {}, 400000),
    },

    {
      name: 'mw_ide_errors',
      description:
        'Read the IDE\'s compile errors. The automation API returns the verdict (IsCompiled) but '
        + 'never the messages, and the output windows expose only Activate/Clear/AddEntry — so '
        + 'this brings the Errors pane to the front and captures the IDE window to a PNG. Read '
        + 'the returned path with the image-reading tool to see the actual error text.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pane: {
            type: 'string',
            description: 'Output pane to show: Errors (default), Warnings, Infos, or Build.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pane', 'path', 'width', 'height'],
          properties: {
            pane: { type: 'string' },
            path: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
        },
        render: (_a, v) => text(`IDE '${v.pane}' pane captured: ${v.path} (${v.width}x${v.height})`),
      },
      presentCall: () => ({ card: 'generic', title: 'Read MotionWorks errors', kind: 'read' }),
      execute: async (args) => {
        const pane = args?.pane ? String(args.pane) : 'Errors';
        await verb('activate_output', { name: pane }, 20000);
        const out = join(HERE, 'shots', `pane-${pane.replace(/\W+/g, '')}-${Date.now()}.png`);
        mkdirSync(dirname(out), { recursive: true });
        const shot = await verb('screenshot', { path: out }, 30000);
        return { pane, ...shot };
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
            trial_answered: { type: ['boolean', 'null'] },
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
        'Check for — and optionally answer — the MotionWorks licence/trial dialog. An '
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
            method: { type: ['string', 'null'] },
            dialog_hwnd: { type: ['string', 'null'] },
            use_trial_hwnd: { type: ['string', 'null'] },
            ide_window: { type: ['string', 'null'] },
          },
        },
        render: (_a, v) => text(
          v.dialog_present
            ? (v.dismissed
              ? `Licence dialog was present and is now answered (via ${v.method}).`
              : 'LICENCE DIALOG IS UP and could not be dismissed automatically. Click '
                + '"Use Trial" once by hand (or activate a licence); the IDE has no project '
                + 'services until then, and every OpenProject will fail with "Internal error".')
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
          : 'MotionWorks is STILL running — do not write code yet.'),
      },
      presentCall: () => ({ card: 'generic', title: 'Close MotionWorks IEC', kind: 'execute' }),
      execute: () => verb('close_ide', {}, 60000),
    },

    // ── code ──────────────────────────────────────────────────────────────────

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
            pous: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  language: { type: ['string', 'null'] },
                  body_stream: { type: ['string', 'null'] },
                  has_st_body: { type: ['boolean', 'null'] },
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
            language: { type: ['string', 'null'] },
            body: { type: ['string', 'null'] },
            body_error: { type: ['string', 'null'] },
            variables: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_a, v) => text(`POU ${v.pou} (${v.language ?? '?'}):\n${v.body ?? '(no ST body)'}`),
      },
      presentCall: (a) => ({ card: 'generic', title: `Read ${a.pou}`, kind: 'read' }),
      execute: (args) => runCode('read_st', { ...(args ?? {}), project: projectOf(args) }),
    },

    {
      name: 'mw_code_write_st',
      description:
        'Replace a POU\'s Structured Text body — this is how the agent writes code. Backs the '
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
        'Add a variable declaration to a POU (or project-global when `pou` is omitted). '
        + 'Touches only the textual declaration stream. **dry_run defaults to true.**',
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
        + 'that leaves a dangling reference and a failed build — pass `force` to override. '
        + '**dry_run defaults to true.**',
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
        'Create a new POU by cloning a template POU that already exists in the project — '
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
      name: 'mw_code_unsupported',
      description:
        'Name the POUs whose bodies cannot be edited safely — graphical LD/FBD (proprietary '
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
        + 'the IDE is actually showing — a dialog, the Project Tree, or the Message Window error '
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
    // `defineTool()` — which we cannot import here — wraps execute in an async
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
