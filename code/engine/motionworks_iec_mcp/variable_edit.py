"""Plan paired declaration/worksheet edits using compatible native donors."""
from __future__ import annotations
import re
from pathlib import Path
from . import grid as G, declarations as D
from .cfb import CompoundFile
from .errors import UnsupportedFormat
from .variables import parse_declarations


def _streams(project_root, pou):
    from .writer import _declaration_target
    source, vb, before, text = _declaration_target(project_root, pou)
    cfb = CompoundFile(source)
    vgr = vb[:-3] + '.VGR'
    if vgr not in cfb.stream_names():
        raise UnsupportedFormat(f'Missing paired worksheet {vgr}; refusing a text-only edit')
    raw = cfb.read_stream(vgr)
    # The pair's pre-existing disagreements are returned rather than raised: a project that
    # already carries one record the vendor tooling accepts must not block work on another
    # variable. The edit is still proven not to introduce a new one in _plan.
    return source, vb, before, text, vgr, raw, G.pair_findings(text, raw)


def _address_span(address, type_name):
    if not address: return None
    match = re.fullmatch(r'%([IQM])([XBWDL])(\d+)(?:\.(\d+))?', address.upper())
    if not match: raise UnsupportedFormat(f'Unrecognized direct address {address!r}')
    area, width, offset, bit = match.groups()
    if width == 'X':
        if bit is None or not 0 <= int(bit) <= 7:
            raise UnsupportedFormat('A bit address needs a bit number from 0 to 7')
        start, bits = int(offset) * 8 + int(bit), 1
    else:
        if bit is not None: raise UnsupportedFormat('Non-bit address has a bit suffix')
        start, bits = int(offset) * 8, {'B': 8, 'W': 16, 'D': 32, 'L': 64}[width]
    warning = D.check_address_type(address, type_name)
    if warning: raise UnsupportedFormat(warning)
    return area, start, start + bits


def check_addresses(text):
    spans = []
    for variable in parse_declarations(text).variables:
        # Runtime system memory uses segment.offset, unlike I/O byte.bit syntax.
        # Preserve those existing bindings; never reinterpret their offsets as bits.
        if variable.address and re.fullmatch(r'%M(?:[BWDL]\d+\.\d+|X\d+\.\d+\.[0-7])', variable.address, re.I):
            continue
        span = _address_span(variable.address, variable.type_name)
        if span is None: continue
        for other_name, other in spans:
            if span[0] == other[0] and span[1] < other[2] and other[1] < span[2]:
                raise UnsupportedFormat(f'Direct addresses overlap: {variable.name} and {other_name}')
        spans.append((variable.name, span))


def _plan(source, vb, before, updated, vgr, raw, notes, preexisting=()):
    from .writer import WritePlan
    tolerated = set(preexisting)
    introduced = [finding for finding in G.pair_findings(updated, raw) if finding not in tolerated]
    if introduced:
        raise UnsupportedFormat(introduced[0])
    if tolerated:
        notes = list(notes) + [
            'Pre-existing declaration/grid disagreement left untouched (not introduced by this edit): '
            + '; '.join(sorted(tolerated))]
    check_addresses(updated)
    return WritePlan(target=source, stream=vb, before=before, after=updated.encode('latin1'),
                     extra_streams={vgr: raw}, notes=notes)


def _other_pou_names(project_root):
    """Every POU name in the project that owns a worksheet, for an automatic donor search."""
    base = Path(project_root) / 'POE'
    if not base.is_dir():
        return []
    return sorted(child.name for child in base.iterdir()
                  if child.is_dir() and (child / 'src.st1').is_file())


def _compatible(records, usages, type_name, address, donor):
    return [r for r in records if r['usage'] in usages
            and r['type'].casefold() == type_name.casefold()
            and bool(r['address']) == bool(address)
            and (donor is None or r['name'].casefold() == donor.casefold())]


def add(project_root, pou_name, name, type_name, section='VAR', address=None,
        initial_value=None, description=None, donor=None, donor_pou=None):
    source, vb, before, text, vgr, raw, preexisting = _streams(project_root, pou_name)
    if address: _address_span(address, type_name)
    section = 'VAR_GLOBAL' if pou_name is None else section.upper()
    usages = {'VAR': (1, 0x40001), 'VAR_EXTERNAL': (5,), 'VAR_GLOBAL': (6, 22)}.get(section)
    if usages is None: raise UnsupportedFormat(f'No proven worksheet usage for {section}')
    donor_text, donor_raw = text, raw
    borrowed = donor_pou is not None
    if donor_pou is not None:
        if pou_name is None: raise UnsupportedFormat('Global donors must come from the same resource')
        _, _, _, donor_text, _, donor_raw, _ = _streams(project_root, donor_pou)
    donors = _compatible(G.parse(donor_raw), usages, type_name, address, donor)
    if not donors and donor_pou is None and donor is None:
        # A POU that declares none of this type - an empty clone, or one whose only locals are
        # function-block instances - has no donor of its own. Borrow one from another POU in the
        # same project rather than refusing: it is the same project, so its worksheets encode the
        # same layout. A donor of a DIFFERENT type is deliberately not accepted here; that was
        # tried and produced a record the project could no longer parse.
        for candidate in _other_pou_names(project_root):
            if candidate.casefold() == (pou_name or '').casefold():
                continue
            try:
                _, _, _, candidate_text, _, candidate_raw, _ = _streams(project_root, candidate)
            except UnsupportedFormat:
                continue
            matches = _compatible(G.parse(candidate_raw), usages, type_name, address, None)
            if matches:
                donor_text, donor_raw, donors, borrowed = candidate_text, candidate_raw, matches, True
                break
    if not donors: raise UnsupportedFormat('No native donor matches the requested type, usage and address layout')
    if donor is None and len({(r['fields'][1:4], r['tail']) for r in donors}) != 1:
        raise UnsupportedFormat('Native donor is ambiguous; specify donor by variable name')
    chosen = donors[0]
    table = parse_declarations(donor_text)
    declaration = next(v for v in table.variables if v.name.casefold() == chosen['name'].casefold())
    # Inherit the donor initializer explicitly in both stores, never silently.
    if initial_value is None:
        initial_value = chosen['initial_value'] or None
    new_grid, handle = G.add(raw, name, type_name, usage=chosen['usage'], address=address or '',
        initial_value=initial_value, donor_name=chosen['name'],
        donor_grid=donor_raw if borrowed else None, group=chosen['group'])
    updated, notes = D.add_variable(text, name, type_name, section=section, address=address,
        initial_value=initial_value, description=description,
        group=declaration.group if not borrowed else None)
    if borrowed and donor_pou is None:
        notes = list(notes) + [
            f'Borrowed the native record layout of {chosen["name"]} ({type_name}) from another POU '
            'in this project, because the target POU declares no donor of that type']
    plan = _plan(source, vb, before, updated, vgr, new_grid,
                 notes + [f'Cloned native donor {chosen["name"]}; initializer={initial_value!r}; handle={handle}; native trailer preserved'],
                 preexisting=preexisting)
    from .descriptions import attach
    if description is not None:
        return attach(plan, vgr, name, description)
    # A new variable must not inherit another variable's description ID.
    import struct
    new_raw = bytearray(plan.extra_streams[vgr])
    item = G.find(G.parse(bytes(new_raw)), name)
    identifier = struct.unpack_from('<I', new_raw, item['end'] - 8)[0]
    if identifier not in (0, 0xffffffff):
        struct.pack_into('<I', new_raw, item['end'] - 8, 0)
    plan.extra_streams[vgr] = bytes(new_raw)
    return plan


def edit(project_root, pou_name, name, new_name=None, type_name=None, address=None,
         initial_value=None, description=None, clear_address=False, force=False, donor=None):
    from .writer import _reference_check
    source, vb, before, text, vgr, raw, preexisting = _streams(project_root, pou_name)
    if address:
        current = G.find(G.parse(raw), name)
        _address_span(address, type_name or current['type'])
    if new_name and new_name.casefold() != name.casefold():
        references = _reference_check(project_root, name, None, include_named_pou=pou_name)
        if references:
            raise UnsupportedFormat(f'Rename would leave references in {references}; remove those references before renaming')
    updated, notes = D.edit_variable(text, name, new_name=new_name, type_name=type_name,
        address=address, initial_value=initial_value, description=description, clear_address=clear_address)
    new_grid, info = G.edit(raw, name, new_name=new_name, type_name=type_name,
        address='' if clear_address else address, initial_value=initial_value, donor_name=donor)
    plan = _plan(source, vb, before, updated, vgr, new_grid, notes + [str(info)], preexisting=preexisting)
    if description is not None:
        from .descriptions import attach
        return attach(plan, vgr, new_name or name, description)
    return plan


def delete(project_root, pou_name, name, force=False):
    from .writer import _reference_check
    source, vb, before, text, vgr, raw, preexisting = _streams(project_root, pou_name)
    references = _reference_check(project_root, name, None, include_named_pou=pou_name)
    if references: raise UnsupportedFormat(f'Cannot delete {name}: referenced in {references}')
    updated, notes = D.delete_variable(text, name)
    new_grid, info = G.delete(raw, name)
    return _plan(source, vb, before, updated, vgr, new_grid, notes + [str(info)], preexisting=preexisting)
