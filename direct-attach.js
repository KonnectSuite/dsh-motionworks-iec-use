import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const inside = (child, parent) => {
  const actualChild = existsSync(child) ? realpathSync(child) : resolve(child);
  const actualParent = existsSync(parent) ? realpathSync(parent) : resolve(parent);
  const rel = relative(actualParent, actualChild);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
};

function assertPlainTree(path, workspace) {
  if (!inside(path, workspace)) throw Error(`REFUSED: project is outside workspace: ${path}`);
  if (lstatSync(path).isSymbolicLink()) throw Error(`REFUSED: linked project path: ${path}`);
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) assertPlainTree(join(path, name), workspace);
  }
}

function recordsDir(workspace) { return join(workspace, '.motionworks', 'attached', 'records'); }

export function findDirectAttachment(workspace, target, sessionId = null) {
  const records = recordsDir(workspace);
  if (!existsSync(records)) return null;
  for (const name of readdirSync(records)) {
    if (!name.endsWith('.json')) continue;
    let record;
    try { record = JSON.parse(readFileSync(join(records, name), 'utf8')); } catch { continue; }
    if (record?.mode !== 'direct' || !record.mwt || !record.directory) continue;
    if (sessionId && record.session_id !== sessionId) continue;
    if (!same(target, record.mwt) && !same(target, record.directory)) continue;
    if (!same(record.workspace, workspace)
      || !inside(record.mwt, workspace) || !inside(record.directory, workspace)
      || !same(record.directory, record.mwt.slice(0, -4))) continue;
    const backupRoot = join(workspace, '.motionworks', 'attached', 'backups');
    if (!inside(record.backup, backupRoot) || !inside(record.backup_manifest, record.backup)) continue;
    if (!existsSync(record.mwt) || !existsSync(record.directory)
      || !existsSync(record.backup_manifest)) continue;
    if (digest(record.backup_manifest) !== record.backup_manifest_sha256) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(record.backup_manifest, 'utf8')); } catch { continue; }
    if (!Array.isArray(manifest.files) || !manifest.files.every((file) =>
      typeof file.path === 'string' && inside(join(record.backup, file.path), record.backup)
      && existsSync(join(record.backup, file.path)))) continue;
    assertPlainTree(record.directory, workspace);
    return record;
  }
  return null;
}

export function listDirectAttachments(workspace) {
  const records = recordsDir(workspace);
  if (!existsSync(records)) return [];
  const attached = [];
  for (const name of readdirSync(records)) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(records, name), 'utf8'));
      if (record?.mwt && findDirectAttachment(workspace, record.mwt)) attached.push(record.directory);
    } catch { /* malformed identity is not an eligible project */ }
  }
  return [...new Set(attached.map(path => resolve(path)))];
}

export function createDirectAttachment(workspace, mwt, sessionId = null) {
  const wrapper = resolve(mwt);
  const directory = wrapper.slice(0, -4);
  if (!wrapper.toLowerCase().endsWith('.mwt') || !existsSync(directory)) {
    throw Error('REFUSED: direct attach requires a .mwt and its sibling expanded directory.');
  }
  if (!inside(wrapper, workspace) || !inside(directory, workspace)) {
    throw Error('REFUSED: direct attach requires a project inside the calling workspace.');
  }
  if (inside(wrapper, join(workspace, '.motionworks'))) {
    throw Error('REFUSED: use the existing staged-project path for projects under .motionworks.');
  }
  assertPlainTree(wrapper, workspace);
  assertPlainTree(directory, workspace);
  const existing = findDirectAttachment(workspace, wrapper, sessionId);
  if (existing) return existing;
  if (!findDirectAttachment(workspace, wrapper) && existsSync(recordsDir(workspace))) {
    for (const name of readdirSync(recordsDir(workspace))) {
      if (!name.endsWith('.json')) continue;
      try {
        const old = JSON.parse(readFileSync(join(recordsDir(workspace), name), 'utf8'));
        if (old?.mwt && same(old.mwt, wrapper)) {
          throw Error(`REFUSED: existing direct attachment for ${wrapper} is invalid. Inspect its backup and identity before another attach.`);
        }
      } catch (error) {
        if (String(error?.message).startsWith('REFUSED:')) throw error;
      }
    }
  }
  const id = randomUUID();
  const backup = join(workspace, '.motionworks', 'attached', 'backups', id);
  const sourceFiles = [wrapper];
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) walk(child);
      else sourceFiles.push(child);
    }
  };
  walk(directory);
  const before = sourceFiles.map((path) => ({ path, sha256: digest(path) }));
  mkdirSync(backup, { recursive: true });
  const files = [];
  for (const item of before) {
    const rel = relative(dirname(wrapper), item.path);
    const dest = join(backup, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(item.path, dest);
    if (digest(dest) !== item.sha256 || digest(item.path) !== item.sha256) {
      throw Error(`REFUSED: project changed during backup: ${item.path}. Preserve ${backup} for inspection.`);
    }
    files.push({ path: rel, sha256: item.sha256 });
  }
  for (const item of before) {
    if (digest(item.path) !== item.sha256) {
      throw Error(`REFUSED: project changed after backup: ${item.path}. Preserve ${backup} for inspection.`);
    }
  }
  const manifest = join(backup, 'backup-manifest.json');
  writeFileSync(manifest, JSON.stringify({ workspace, mwt: wrapper, directory, files }, null, 2));
  const record = {
    mode: 'direct', workspace, mwt: wrapper, directory, session_id: sessionId,
    backup, backup_manifest: manifest, backup_manifest_sha256: digest(manifest),
    attached_at: new Date().toISOString(),
  };
  mkdirSync(recordsDir(workspace), { recursive: true });
  const pending = join(recordsDir(workspace), `${id}.json.tmp`);
  const final = join(recordsDir(workspace), `${id}.json`);
  writeFileSync(pending, JSON.stringify(record, null, 2));
  renameSync(pending, final);
  return record;
}
