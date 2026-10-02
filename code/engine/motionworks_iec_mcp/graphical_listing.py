"""Read bounded compiler networks with exact POU and worksheet identities.

No binary graphical decoding or writes. The caller must bind this cache to a
fresh native Build and unchanged complete source baseline.
"""
import hashlib
import re
from pathlib import Path, PureWindowsPath

HEADER = re.compile(r'\A\(\*\s*T: (PROGRAM|FUNCTION_BLOCK|FUNCTION) ([A-Za-z_][A-Za-z_0-9]*)\s', re.S)
SYMBOL = re.compile(r'@(RV|IV) (\d+)(?!\d)')
MAX_BYTES = 2_000_000


def read_text(path, root):
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Compiler artifact resolves outside project')
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
        raise ValueError('Compiler artifact changed during read')
    if len(raw) > MAX_BYTES or b'\0' in raw:
        raise ValueError('Unsupported compiler text size/encoding')
    return raw.decode('latin1'), dict(path=str(path), sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw), modified_ms=after.st_mtime_ns/1_000_000)


def identity(text):
    match = HEADER.match(text)
    if not match:
        raise ValueError('Unknown compiler listing header')
    return match.groups()


def symbols(text):
    result = {}
    # A declaration name/ordinal/section/type is followed by its compiler token.
    pattern = re.compile(r'^([A-Za-z_][A-Za-z_0-9]*)\t\d+\t(VAR[A-Z_]*)\t[^\r\n]+\r?\n@(RV|IV) (\d+)(?:\s|$)', re.M)
    for match in pattern.finditer(text):
        name, section, kind, number = match.groups()
        key = '@' + kind + ' ' + number
        if key in result and result[key]['name'] != name:
            raise ValueError('Ambiguous compiler symbol')
        result[key] = dict(name=name, section=section)
    return result


def networks(text, bindings):
    result, current = [], None
    if '*)' not in text:
        raise ValueError('Truncated compiler header')
    for line in text.split('*)', 1)[1].splitlines():
        if line.strip() == '@NETWORK_BEGIN':
            if current is not None:
                raise ValueError('Nested compiler network')
            current = []
        elif line.strip() == '@NETWORK_END':
            if current is None:
                raise ValueError('Unmatched compiler network end')
            result.append(dict(number=len(result)+1, lines=current))
            current = None
        elif line.strip():
            if current is None:
                raise ValueError('Instruction outside graphical network')
            refs = []
            for match in SYMBOL.finditer(line):
                token = match.group()
                refs.append(dict(token=token, declaration=bindings.get(token), resolved=token in bindings))
            current.append(dict(raw=line, symbols=refs))
    if current is not None:
        raise ValueError('Truncated compiler network')
    return result


def inspect(project, name, start=1, limit=10, *, source_only=False):
    if type(start) is not int or start < 1 or type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError('Invalid network range')
    pou = project.pou(name)
    if pou.name != name or pou.body_stream()[1] not in (('ST', 'LD', 'FBD') if source_only else ('LD', 'FBD')):
        raise ValueError('Exact graphical POU required')
    root = project.root
    candidates = []
    for path in sorted((root / 'C').glob('*/R/*/ICI*.CIC')):
        text, evidence = read_text(path, root)
        if identity(text)[1] == name:
            candidates.append((path, text, evidence))
    if len(candidates) != 1:
        raise ValueError('Compiler listing for exact POU absent or ambiguous; unused POUs may be omitted. Inspect usage without automatic task assignment')
    path, code, evidence = candidates[0]
    declarations, dit_evidence = read_text(path.with_suffix('.DIT'), root)
    if identity(declarations) != identity(code):
        raise ValueError('Compiler declaration identity mismatch')
    worksheet, diw_evidence = read_text(path.with_suffix('.DIW'), root)
    # Match the saved body worksheet, not a guessed filename or a sibling cache.
    expected = 'poe/' + name.casefold() + '/' + pou.body_stream()[0].casefold()
    rows = [line.split('\t') for line in worksheet.splitlines() if re.match(r'^\d+\t\d+\t', line)]
    if len([r for r in rows if len(r)==3 and r[2].replace('\\','/').casefold()==expected]) != 1:
        raise ValueError('Compiler worksheet identity mismatch')
    mapping, sp_evidence = read_text(path.with_suffix('.SP'), root)
    paths = [line.split('\t')[0] for line in mapping.splitlines() if line.strip() and not line.startswith('*\t')]
    expected_file = str(root / Path(expected))
    # Compiler Windows paths are compared as paths even in portable unit tests.
    if paths and any(PureWindowsPath(p) != PureWindowsPath(expected_file) for p in paths):
        raise ValueError('Compiler source mapping points to another project/worksheet')
    bindings = symbols(declarations)
    parsed = [] if source_only else networks(code, bindings)
    if source_only and not paths:
        raise ValueError('Compiled source has no worksheet mapping')
    if parsed and not paths:
        raise ValueError('Populated listing has no source mapping')
    selected = parsed[start-1:start-1+limit]
    artifacts=[evidence,dit_evidence,diw_evidence,sp_evidence]
    for artifact in artifacts:
        if read_text(Path(artifact['path']),root)[1]!=artifact:
            raise ValueError('Compiler artifact set changed during inspection')
    if source_only:
        return dict(pou=name, language=pou.body_stream()[1], artifacts=artifacts,
                    action_performed=False, compiler_cache_freshness_verified=False)
    return dict(pou=name, language=pou.body_stream()[1], artifacts=artifacts,
                network_count=len(parsed), start=start, networks=selected, has_more=start-1+len(selected)<len(parsed),
                symbol_bindings=bindings, compiler_cache_freshness_verified=False,
                action_performed=False, limitations=['Compiler tokens are retained verbatim; unresolved tokens have no inferred meaning.',
                'Compiler instructions do not prove canvas geometry, pin placement or runtime behavior.'])
