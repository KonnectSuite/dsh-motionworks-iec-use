/**
 * The workspace is the session folder, never the DSH profile directory.
 *
 * Run: node test/workspace_session.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL(join(import.meta.dirname, '..', 'index.js')).href);
const profile = process.cwd();
const sessionDir = mkdtempSync(join(tmpdir(), 'mw-session-'));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

function host({ sessionCwd, registryPath, propertyThrows }) {
  let propertyReads = 0;
  const tools = [];
  const ctx = {
    get(name) {
      if (name === 'agents') {
        return { currentInitiator: () => null };
      }
      if (name === 'workspaceRegistry') {
        return {
          list: () => (registryPath
            ? [{ title: 'Arya WorkSpace', path: registryPath, sessionIds: ['sess-arya'] }]
            : []),
        };
      }
      if (name === 'sessions') {
        return {
          get: () => (sessionCwd ? { header: { cwd: sessionCwd } } : undefined),
        };
      }
      return undefined;
    },
    tools: { register(def) { tools.push(def); } },
    on() {},
    logger: { warn() {} },
  };
  if (propertyThrows) {
    Object.defineProperty(ctx, 'workspaceRegistry', {
      get() {
        propertyReads += 1;
        throw new Error('service "workspaceRegistry" is not injected');
      },
    });
  }
  return { ctx, tools, reads: () => propertyReads };
}

try {
  const direct = host({ sessionCwd: sessionDir, registryPath: sessionDir, propertyThrows: true });
  mod.apply(direct.ctx);
  const find = direct.tools.find((t) => t.name === 'mw_project_find');
  const listed = await find.execute({}, {
    agent: { id: 'sess-arya', session: { header: { cwd: sessionDir } } },
  });
  check('session folder is the workspace', listed.workspace === sessionDir, listed.workspace);
  check('profile root was not used', listed.workspace !== profile, listed.workspace_source);
  check('sandbox property access was not used', direct.reads() === 0, `reads=${direct.reads()}`);
  check('find result declares outside_workspace', listed.outside_workspace === false, String(listed.outside_workspace));

  const viaRegistry = host({ sessionCwd: sessionDir, registryPath: sessionDir, propertyThrows: true });
  mod.apply(viaRegistry.ctx);
  const find2 = viaRegistry.tools.find((t) => t.name === 'mw_project_find');
  const fromRegistry = await find2.execute({}, { agent: { id: 'sess-arya' } });
  check('registry path is used when the call has only a session id', fromRegistry.workspace === sessionDir, fromRegistry.workspace_source);
  check('that lookup also skips the throwing property', viaRegistry.reads() === 0, `reads=${viaRegistry.reads()}`);

  const missing = host({ propertyThrows: true });
  mod.apply(missing.ctx);
  const find3 = missing.tools.find((t) => t.name === 'mw_project_find');
  let refused = '';
  try {
    await find3.execute({}, { agent: { id: 'sess-arya' } });
  } catch (e) {
    refused = String(e.message);
  }
  check('a session with no workspace path is refused', refused.includes('no workspace path'), refused.split('\n')[0]);
  check('the refusal does not name the profile root as the workspace', !refused.includes(profile), '');
} finally {
  rmSync(sessionDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
