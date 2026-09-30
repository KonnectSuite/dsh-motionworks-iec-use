"""Offline consistency evidence; never a substitute for IDE acceptance."""
from pathlib import Path
from .cfb import CompoundFile
from .grid import validate_pair
from .tree import parse_document
from .variable_edit import check_addresses


def validate(project, *, containers=None):
    root = Path(project)
    if root.suffix.lower() == '.mwt': root = root.with_suffix('')
    checked, errors = [], []
    sources = list(root.rglob('src.st1')) if containers is None else containers
    for source in sources:
        source = Path(source)
        label = source.relative_to(root).as_posix()
        try:
            cfb = CompoundFile(source)
            names = cfb.stream_names()
            for name in names:
                # Read every stream to check allocation/readability too.
                raw = cfb.read_stream(name)
                if name.upper().endswith('.VB'):
                    grid = next((n for n in names if n.casefold() == (name[:-3]+'.VGR').casefold()), None)
                    if grid is None: raise ValueError(f'Missing grid for {name}')
                    result = validate_pair(raw.decode('latin1'), cfb.read_stream(grid))
                    check_addresses(raw.decode('latin1'))
                    checked.append({'file': label, 'stream': name, **result})
                elif name == 'PROJECT.TRE':
                    document = parse_document(raw.decode('latin1'))
                    nodes = [node for node, _ in document.walk_with_ancestors()]
                    if len(nodes) != int(document.lines[1]):
                        raise ValueError('PROJECT.TRE total does not match parsed nodes')
                    ids = [node.node_id for node in nodes]
                    if len(set(ids)) != len(ids): raise ValueError('Duplicate PROJECT.TRE node IDs')
                    checked.append({'file': label, 'stream': name, 'nodes': len(nodes)})
        except Exception as exc:
            errors.append({'file': label, 'error': str(exc)})
    if not sources: errors.append({'error': 'No native containers found'})
    return {'ok': not errors, 'verification': 'offline_only', 'checked': checked, 'errors': errors,
            'not_verified': ['IDE Rebuild', 'Make', 'save/close/reopen', 'controller behavior']}
