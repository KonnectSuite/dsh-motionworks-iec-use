"""Resolve native document URNs from the saved project tree, without writes."""
from .cfb import CompoundFile
from .tree import parse_tree

def worksheet_target(project, kind, pou=None):
    if kind not in ('variables', 'code'):
        raise ValueError('Unknown worksheet kind')
    roots, warnings = parse_tree(CompoundFile(project.root / 'src.st1').read_stream('PROJECT.TRE').decode('latin1'))
    if warnings:
        raise ValueError('Project tree has parse warnings; navigation refused')
    nodes = [node for root in roots for _, node in root.walk()]
    def parts(node):
        return node.path.split('\t', 1)[0].replace('\\', '/').split('/')
    if pou:
        parents = [n for n in nodes if len(parts(n)) == 2 and parts(n)[0].upper() == 'POE' and n.name.casefold() == pou.casefold()]
        if len(parents) != 1:
            raise ValueError('Exact POU tree identity is absent or ambiguous')
        parent = parents[0]
        extensions = ('.VGR',) if kind == 'variables' else ('.STB', '.AB', '.GB')
        matches = [n for n in parent.children if parts(n)[-1].upper().endswith(extensions)]
        if len(matches) != 1:
            raise ValueError('Exact worksheet is absent or ambiguous')
        node = matches[0]
        segments = [parent.name, node.name]
        logical = '/Pous/' + '/'.join(segments)
        urn = '@POUS.' + '.'.join(segments)
    else:
        if kind != 'variables':
            raise ValueError('Code navigation requires a POU')
        matches = [n for n in nodes if len(parts(n)) == 5 and parts(n)[0].upper() == 'C' and parts(n)[2].upper() == 'R' and parts(n)[-1].upper().endswith('.VGR')]
        if len(matches) != 1:
            raise ValueError('Exact resource globals worksheet is absent or ambiguous')
        node = matches[0]
        segments = [parts(node)[1], parts(node)[3], node.name]
        logical = '/Hardware/' + '/'.join(segments)
        urn = '@HW.' + '.'.join(segments)
    if any(not s or any(c in s for c in './\\\r\n') for s in segments):
        raise ValueError('Unsupported native worksheet identity')
    document_logical = logical
    if pou and kind == 'code':
        # The active code editor reports the POU identity, not its body child.
        logical = '/Pous/' + segments[0]
    return dict(kind=kind, pou=segments[0] if pou else None, logical_name=logical,
                document_logical_name=document_logical, urn=urn)
