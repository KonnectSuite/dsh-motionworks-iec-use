"""Read-only readiness and source evidence; never repairs or restages a project."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .cfb import CompoundFile
from .mwt_bind import embedded_paths
from .staging import assert_staged, assert_proven, workspace_root


def source_manifest(root: Path) -> dict:
    """Hash real native sources, not generated DLLs or tmp.sto compiler caches."""
    root = Path(root).resolve()
    files = {}
    streams = {}
    for path in sorted(root.rglob('src.st1')):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f'Linked source escapes project: {path}')
        relative = path.relative_to(root).as_posix()
        files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        cfb = CompoundFile(path)
        streams[relative] = {
            name: hashlib.sha256(cfb.read_stream(name)).hexdigest()
            for name in sorted(cfb.stream_names())
        }
    for name in ('LIST.POU', 'PROJECT.INF'):
        path = root / name
        if path.is_file():
            if not path.resolve().is_relative_to(root):
                raise ValueError(f'Linked source escapes project: {path}')
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    # Description text lives outside src.st1. Losing a translation must fail
    # persistence verification even when its binary description ID is unchanged.
    translations = {}
    for path in sorted(root.rglob('*Translation.xml')):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f'Linked description escapes project: {path}')
        relative = path.relative_to(root).as_posix()
        translations[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        files[relative] = translations[relative]
    metadata = {name: value for name, value in files.items() if not name.endswith('src.st1')}
    digest = hashlib.sha256(json.dumps({'streams': streams, 'metadata': metadata}, sort_keys=True).encode()).hexdigest()
    # These two measured streams store expanded navigation-tree/view state.
    # Keep their hashes as evidence, but do not confuse UI normalization with
    # changed program sources. PROJECT.TRE is deliberately NOT excluded.
    persistence_streams = {file: {name: value for name, value in store.items()
                                if name.upper() not in ('PRMVIEWALL.DAT', 'PRMVIEWHARD.DAT')}
                           for file, store in streams.items()}
    persistence_digest = hashlib.sha256(json.dumps({'streams': persistence_streams,
                                                    'metadata': metadata}, sort_keys=True).encode()).hexdigest()
    programs = {file: {name: value for name, value in store.items()
                      if name.upper().endswith(('.VB', '.VGR', '.STB', '.GB', '.TXT'))}
                for file, store in streams.items()}
    program_digest = hashlib.sha256(json.dumps({'programs': programs, 'translations': translations}, sort_keys=True).encode()).hexdigest()
    return {'project': str(root), 'source_digest': digest, 'files': files,
            'persistence_digest': persistence_digest,
            'program_digest': program_digest,
            'streams': streams, 'verification': 'native_source_only',
            'note': 'Source hashes are not compile, download, or motion evidence.'}


def check(project: str) -> dict:
    from .project import Project
    from .validation import validate

    root = assert_staged(project)
    if root.suffix.lower() == '.mwt':
        root = root.with_suffix('')
    # Diagnostic bypass is deliberately read-only, and still confines EVERY file
    # to the stage. It is necessary to explain relocated identities, not trust them.
    stage = workspace_root() / '.motionworks' / 'stage'
    if root.parent != stage.resolve() or not root.is_dir():
        raise ValueError('Select one expanded project directly inside workspace .motionworks/stage')
    for member in root.rglob('*'):
        if not member.resolve().is_relative_to(root):
            raise ValueError(f'Linked project member escapes stage: {member}')
    blockers, warnings = [], []
    try:
        assert_proven(root)
        identity_ok = True
    except Exception as exc:
        identity_ok = False
        blockers.append({'code': 'identity_invalid', 'detail': str(exc),
                         'next': 'Inspect the copied identity and original source. Do not restage over edits or hand-edit provenance.'})
    wrapper = root.with_suffix('.mwt')
    paths = []
    try:
        paths = embedded_paths(wrapper)
        # Native sibling-directory wrappers legitimately store no absolute path.
        # Use the same rule as check_mwt; do not manufacture a path for them.
        bound = (all(Path(p).resolve() == root for p in paths) if paths else identity_ok)
        if not bound:
            blockers.append({'code': 'wrapper_unverified', 'detail': str(paths),
                             'next': 'Check identity first, then mw_code_wrapper_binding. Preserve stage edits; do not restage over them.'})
    except Exception as exc:
        bound = False
        blockers.append({'code': 'wrapper_unreadable', 'detail': str(exc),
                         'next': 'Preserve the wrapper and inspect its native format.'})
    validation = validate(root)
    if not validation.get('ok'):
        blockers.append({'code': 'native_validation_failed', 'detail': validation,
                         'next': 'Inspect native errors before editing or opening.'})
    p = Project(root)
    bodies = {}
    for pou in p.pous():
        body = pou.st_body()
        if body is not None:
            bodies[pou.name] = body
            timers = re.findall(r'PT\s*:=\s*(T#[\w.]+)', body, re.I)
            if timers:
                warnings.append({'code': 'timer_present', 'pou': pou.name,
                                 'detail': f'Native ST timer presets: {sorted(set(timers))}. Verify timing claims in notes against source.'})
    return {'project': str(root), 'workspace': str(workspace_root()),
            'identity_valid': identity_ok, 'wrapper_bound': bound,
            'wrapper_paths': paths, 'ready_for_ide_open': not blockers,
            'binding_mode': 'embedded_path' if paths else 'native_sibling_directory',
            'blockers': blockers, 'warnings': warnings,
            'validation': validation, 'manifest': source_manifest(root),
            'st_pous': list(bodies), 'evidence_level': 'offline_only',
            'next_step': blockers[0]['next'] if blockers else
            'Open this exact wrapper; verify Build, Make, errors, save and reopen. Never download from this tool.'}
