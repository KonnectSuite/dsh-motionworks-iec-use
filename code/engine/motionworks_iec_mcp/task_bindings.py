"""Exact saved PROGRAM instance ownership, separate from runtime execution."""
import hashlib
import re
from pathlib import Path
from .cfb import CompoundFile
from .tree import parse_document
from .tasks import parse_task_settings

IDENT = re.compile(r'^[A-Za-z_][A-Za-z_0-9]*$')

def resolve(document, programs):
    if document.warnings:
        raise ValueError('Task tree parse warnings')
    known = {name.casefold(): name for name in programs}
    if len(known) != len(programs): raise ValueError('Duplicate PROGRAM registry identity')
    tasks, identities = [], set()
    for node, _ in document.walk_with_ancestors():
        fields = node.path.split('\t')
        path = fields[0].replace('\\', '/').split('/')
        if len(path) != 5 or path[0] != 'C' or path[2] != 'R' or path[-1] != node.name:
            continue
        if len(fields) < 4 or fields[3] not in ('CYCLIC','DEFAULT','SYSTEM') or not all(IDENT.fullmatch(p) for p in (path[1],path[3],node.name)):
            raise ValueError('Unsupported task identity/kind')
        identity = '/'.join(path)
        if identity.casefold() in identities: raise ValueError('Duplicate task identity')
        identities.add(identity.casefold()); instances, names = [], set()
        for order, child in enumerate(node.children):
            if child.children or not IDENT.fullmatch(child.name) or child.name.casefold() in names:
                raise ValueError('Ambiguous PROGRAM instance identity')
            names.add(child.name.casefold())
            program = document.lines[child.line+2].split('\t')[0]
            if program.casefold() not in known:
                raise ValueError('Task instance type is absent from PROGRAM registry: '+program)
            instances.append(dict(name=child.name,type=known[program.casefold()],order=order+1))
        tasks.append(dict(name=node.name,configuration=path[1],resource=path[3],
                          path=identity,kind=fields[3],instances=instances))
    return tasks

def inspect(root):
    root = Path(root)
    registry = root/'LIST.POU'; tree = root/'src.st1'
    before = {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (registry,tree)}
    programs, seen = [], set()
    for line in registry.read_text(encoding='latin1').splitlines():
        if not line.strip(): continue
        columns = line.split('\t')
        if len(columns)<2 or columns[0].upper().replace('FUNCTIONBLOCK','FUNCTION_BLOCK') not in ('PROGRAM','FUNCTION','FUNCTION_BLOCK') or not IDENT.fullmatch(columns[1]) or columns[1].casefold() in seen:
            raise ValueError('Invalid/duplicate POU registry identity')
        seen.add(columns[1].casefold())
        if columns[0].upper() == 'PROGRAM': programs.append(columns[1])
    document = parse_document(CompoundFile(tree).read_stream('PROJECT.TRE').decode('latin1'))
    tasks = resolve(document,programs)
    for task in tasks:
        source = root/Path(task['path']).parent/(task['name']+'.SET')
        if not source.resolve().is_relative_to(root.resolve()): raise ValueError('Task settings escape project')
        raw = source.read_bytes(); before[str(source)] = hashlib.sha256(raw).hexdigest()
        settings = parse_task_settings(raw.decode('latin1'),source)
        if settings.warnings or settings.name.casefold()!=task['name'].casefold() or settings.type!=task['kind']:
            raise ValueError('Task settings/tree identity or kind mismatch')
        task['settings'] = settings.fields
        task['settings_source'] = str(source)
    for path, digest in before.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=digest:
            raise ValueError('Task sources changed during read')
    assigned = {instance['type'].casefold() for task in tasks for instance in task['instances']}
    return dict(bindings=tasks,program_types=programs,
                unassigned=sorted(name for name in programs if name.casefold() not in assigned),
                binding_resolution='exact_saved_tree',source_hashes=before)
