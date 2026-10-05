"""Read bounded compiler networks with exact POU and worksheet identities.

No binary graphical decoding or writes. The caller must bind this cache to a
fresh native Build and unchanged complete source baseline.
"""
import hashlib
import re
from pathlib import Path, PureWindowsPath

HEADER = re.compile(r'\A\(\*\s*T: (PROGRAM|FUNCTION_BLOCK|FUNCTION) ([A-Za-z_][A-Za-z_0-9]*)\s', re.S)
SYMBOL = re.compile(r'@IFBP (\d+)\.(\d+)(?![\d.])|@(RV|IV|IFB) (\d+)(?!\d)')
DECLARATION = re.compile(r'^([A-Za-z_][A-Za-z_0-9]*)\t(\d+)\t(VAR[A-Z_]*)\t([^\r\n]+)\r?\n([^;]*);', re.M)
# Generated private code temporaries are counted for completeness, never exposed
# as public pins. CamGenerator contains @T_Code_00 after its 140 source rows.
DEPENDENCY_DECLARATION = re.compile(r'^((?:[A-Za-z_][A-Za-z_0-9@]*|@T_Code_[0-9]+))\t(\d+)\t(VAR[A-Z_]*)\t([^\r\n]+)\r?\n([^;]*);', re.M)
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


def symbols(text, saved=None):
    result, rows, ordinals, names = {}, [], set(), set()
    def bind(token, row):
        if token in result and result[token] != row:
            raise ValueError('Ambiguous compiler symbol')
        result[token] = row
    for match in DECLARATION.finditer(text):
        name, ordinal, section, type_token, detail = match.groups()
        if ordinal in ordinals or name.casefold() in names or int(ordinal) < 1:
            raise ValueError('Ambiguous compiler declaration ordinal/name')
        ordinals.add(ordinal); names.add(name.casefold())
        row = dict(name=name, section=section)
        rows.append((name, section))
        explicit = re.findall(r'^@(RV|IV) (\d+)(?:\s|$)', detail, re.M)
        if len(explicit) > 1:
            raise ValueError('Ambiguous compiler declaration token')
        if explicit:
            kind, number = explicit[0]
            bind('@' + kind + ' ' + number, row)
        elif section in ('VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP'):
            # Local operands use the declaration ordinal. FB instances use the
            # same ordinal under IFB; the type ID remains raw compiler evidence.
            if re.fullmatch(r'@FB:\d+\s*', type_token):
                bind('@IFB ' + ordinal, row)
            elif re.match(r'@TYP:\d+(?:\s|$)', type_token):
                bind('@IV ' + ordinal, row)
    if saved is not None:
        if sorted(rows) != sorted((v.name, v.section) for v in saved):
            raise ValueError('Compiler declarations differ from saved worksheet')
    return result


def pin_bindings(code, declarations, saved, path, root):
    """Bind only public pins from exact compiler FB dependencies, never UI order."""
    needed = {m.group(1) for m in SYMBOL.finditer(code) if m.group(1) is not None}
    saved_types = {v.name: v.type_name for v in saved}
    pins, artifacts, cache = {}, [], {}
    directions = {'VAR_INPUT': 'input', 'VAR_OUTPUT': 'output', 'VAR_IN_OUT': 'in_out'}
    for match in DECLARATION.finditer(declarations):
        name, ordinal, section, type_token, _ = match.groups()
        fb = re.fullmatch(r'@FB:(\d+)\s*', type_token)
        if ordinal not in needed or not fb or section not in ('VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP'):
            continue
        type_id = int(fb.group(1))
        if type_id not in cache:
            dependency = path.with_name(f'ICI{type_id:05d}.DIT')
            text, evidence = read_text(dependency, root)
            kind, block = identity(text)
            if '*)' not in text:
                raise ValueError('Truncated compiler FB dependency header')
            header = text.split('*)', 1)[0]
            ids = re.findall(r'^CI#:\s*(\d+)\s*$', header, re.M)
            counts = re.findall(r'^QVE:\s*(\d+)\s*$', header, re.M)
            if kind != 'FUNCTION_BLOCK' or len(ids) != 1 or int(ids[0]) != type_id:
                raise ValueError('Compiler FB dependency identity mismatch')
            # Graphical library FBs contain compiler-only names such as Code@@80.
            # Count those private rows, but never expose them as public pins.
            rows = list(DEPENDENCY_DECLARATION.finditer(text))
            # QVE includes internal declarations; a partial parse must not resolve pins.
            if len(counts) != 1 or int(counts[0]) != len(rows):
                raise ValueError('Compiler FB dependency declarations are incomplete')
            symbols(text)  # Reject duplicate names/ordinals and ambiguous bindings.
            names = {r.group(1).casefold() for r in rows}
            ordinals = {int(r.group(2)) for r in rows}
            if len(names) != len(rows) or ordinals != set(range(1, len(rows)+1)):
                raise ValueError('Compiler FB dependency ordinals are incomplete')
            cache[type_id] = (block, rows, evidence)
            artifacts.append(evidence)
        block, rows, evidence = cache[type_id]
        if saved_types[name].casefold() != block.casefold():
            raise ValueError('Compiler FB dependency type differs from saved instance')
        for row in rows:
            pin_name, pin_ordinal, pin_section, _, _ = row.groups()
            if pin_section in directions:
                if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', pin_name):
                    raise ValueError('Compiler FB public pin name is unsupported')
                pins[f'@IFBP {ordinal}.{int(pin_ordinal)}'] = dict(
                    declaration=dict(name=pin_name, section=pin_section),
                    pin_direction=directions[pin_section], block_type=block,
                    compiler_type_id=type_id, dependency_sha256=evidence['sha256'])
    return pins, artifacts


def networks(text, bindings, pins=None):
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
                if match.group(1) is not None:
                    instance = bindings.get('@IFB ' + match.group(1))
                    pin = (pins or {}).get(token) if instance else None
                    refs.append(dict(dict(token=token, declaration=None, resolved=pin is not None,
                                     instance=instance, pin_ordinal=int(match.group(2))), **(pin or {})))
                else:
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
    table = pou.declarations()
    if table.warnings:
        raise ValueError('Saved declaration worksheet is incomplete')
    bindings = symbols(declarations, table.variables)
    pins, dependency_artifacts = ({}, []) if source_only else pin_bindings(code, declarations, table.variables, path, root)
    parsed = [] if source_only else networks(code, bindings, pins)
    if source_only and not paths:
        raise ValueError('Compiled source has no worksheet mapping')
    if parsed and not paths:
        raise ValueError('Populated listing has no source mapping')
    selected = parsed[start-1:start-1+limit]
    artifacts=[evidence,dit_evidence,diw_evidence,sp_evidence]
    for artifact in artifacts + dependency_artifacts:
        if read_text(Path(artifact['path']),root)[1]!=artifact:
            raise ValueError('Compiler artifact set changed during inspection')
    if source_only:
        return dict(pou=name, language=pou.body_stream()[1], artifacts=artifacts,
                    action_performed=False, compiler_cache_freshness_verified=False)
    return dict(pou=name, language=pou.body_stream()[1], artifacts=artifacts,
                network_count=len(parsed), start=start, networks=selected, has_more=start-1+len(selected)<len(parsed),
                symbol_bindings=bindings, dependency_artifacts=dependency_artifacts,
                compiler_cache_freshness_verified=False, compiler_dependency_freshness_verified=False,
                action_performed=False, limitations=['Compiler tokens are retained verbatim; unresolved tokens have no inferred meaning.',
                'Compiler instructions do not prove canvas geometry, pin placement or runtime behavior.'])
