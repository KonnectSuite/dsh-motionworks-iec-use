"""Recoverable offline transactions. A successful file write is not a build verdict."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .errors import MotionWorksError
from .ide import ensure_ide_closed
from .snapshot import sha256_file
from .staging import assert_proven, workspace_root


def hash_tree(root):
    """A rollback snapshot includes generated files and hidden directories too."""
    return {p.relative_to(root).as_posix(): sha256_file(p)
            for p in sorted(Path(root).rglob('*')) if p.is_file()}


def _save(path: Path, payload: dict) -> None:
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    os.replace(temp, path)


def _restore(root: Path, backup: Path, before: dict[str, str]) -> None:
    # Verify the complete rollback set before replacing even one source file.
    for name, digest in before.items():
        if sha256_file(backup / name) != digest:
            raise MotionWorksError(f'Rollback backup failed verification: {name}')
    for path in sorted(root.rglob('*'), reverse=True):
        if path.is_file() and path.relative_to(root).as_posix() not in before:
            path.unlink()
    for name in before:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + '.rollback-' + uuid4().hex)
        shutil.copy2(backup / name, temp)
        os.replace(temp, target)
    for path in sorted(root.rglob('*'), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    if hash_tree(root) != before:
        raise MotionWorksError('Rollback read-back differs from the recorded snapshot')


def update_metadata(root: Path) -> None:
    path = root / 'PROJECT.INF'
    if not path.exists():
        return
    raw = path.read_bytes()
    if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        encoding = 'utf-16'
    else:
        encoding = 'latin1'
    text = raw.decode(encoding)
    updated, count = re.subn(r'(?m)^LastChange=[^\r\n]*',
        'LastChange=' + datetime.now().strftime('%m/%d/%Y  %I:%M:%S %p'), text)
    if count != 1:
        raise MotionWorksError('PROJECT.INF must have exactly one LastChange field')
    temp = path.with_name(path.name + '.transaction-' + uuid4().hex)
    temp.write_bytes(updated.encode(encoding))
    os.replace(temp, path)


def run(project: Path, operation, *, validate=None) -> dict:
    """Commit a whole operation or restore its complete pre-operation file set.

    The lock remains after a process crash or failed rollback. A later writer refuses;
    it never silently treats an incomplete transaction as committed.
    """
    root = assert_proven(project)
    if root.suffix.lower() == '.mwt':
        root = root.with_suffix('')
    if not root.is_dir():
        raise MotionWorksError('Transaction requires an expanded project directory')
    ensure_ide_closed(auto_close=False)
    home = workspace_root() / '.motionworks'
    key = hashlib.sha256(str(root).casefold().encode()).hexdigest()[:20]
    lock = home / 'locks' / (key + '.lock')
    if not lock.resolve().is_relative_to(workspace_root()):
        raise MotionWorksError('Transaction lock escapes the workspace')
    if not lock.resolve().is_relative_to(workspace_root()):
        raise MotionWorksError('Transaction lock escapes the workspace')
    lock.parent.mkdir(parents=True, exist_ok=True)
    transaction_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ-') + uuid4().hex[:8]
    folder = home / 'transactions' / key / transaction_id
    if not folder.resolve().is_relative_to(workspace_root()):
        raise MotionWorksError('Transaction journal escapes the workspace')
    if not folder.resolve().is_relative_to(workspace_root()):
        raise MotionWorksError('Transaction journal escapes the workspace')
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise MotionWorksError(f'Project transaction is locked; inspect {lock} before recovery') from exc
    with os.fdopen(fd, 'w') as handle:
        json.dump({'pid': os.getpid(), 'journal': str(folder / 'journal.json')}, handle)
    clean = False
    before = None
    journal = {'id': transaction_id, 'project': str(root), 'state': 'preparing',
               'verification': 'offline_only', 'required': ['rebuild', 'make', 'save', 'close_reopen']}
    try:
        folder.mkdir(parents=True)
        before = hash_tree(root)
        shutil.copytree(root, folder / 'before')
        if hash_tree(folder / 'before') != before or hash_tree(root) != before:
            raise MotionWorksError('Source changed during snapshot or backup did not verify')
        journal.update(state='prepared', before=before)
        _save(folder / 'journal.json', journal)
        # Recheck after potentially slow backup, immediately before changing files.
        ensure_ide_closed(auto_close=False)
        journal['state'] = 'applying'
        _save(folder / 'journal.json', journal)
        payload = operation()
        if payload.get('ok') is False:
            raise MotionWorksError('Operation reported failure: ' + json.dumps(payload))
        if validate:
            validation = validate(root)
        else:
            from .validation import validate as validate_native
            current = hash_tree(root)
            changed_containers = [root / name for name, digest in current.items()
                                  if Path(name).name.lower() == 'src.st1' and before.get(name) != digest]
            validation = validate_native(root, containers=changed_containers) if changed_containers else {'status': 'operation_readback_only'}
        if validation.get('ok') is False:
            raise MotionWorksError('Static validation failed: ' + json.dumps(validation))
        after = hash_tree(root)
        if after != before:
            update_metadata(root)
            after = hash_tree(root)
        changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
        journal.update(state='committed', after=after, changed_files=changed, validation=validation)
        _save(folder / 'journal.json', journal)
        report = {k: journal[k] for k in ('id', 'state', 'verification', 'required', 'changed_files', 'validation')}
        report.update(journal=str(folder / 'journal.json'), backup=str(folder / 'before'),
                      hashes={name: {'before': before.get(name), 'after': after.get(name)} for name in changed})
        payload.setdefault('result', {})['transaction'] = report
        clean = True
        return payload
    except Exception as exc:
        if journal['state'] in ('applying', 'committed'):
            try:
                ensure_ide_closed(auto_close=False)
                assert_proven(root)
                assert_proven(root)
                _restore(root, folder / 'before', before)
                journal.update(state='rolled_back', error=str(exc))
                _save(folder / 'journal.json', journal)
                clean = True
            except Exception as rollback_error:
                raise MotionWorksError(f'Operation failed: {exc}; rollback needs recovery: {rollback_error}; journal: {folder}') from exc
        else:
            clean = True  # No project mutation has begun.
        raise MotionWorksError(f'Offline transaction failed: {exc}; journal: {folder}') from exc
    finally:
        if clean:
            lock.unlink(missing_ok=True)
