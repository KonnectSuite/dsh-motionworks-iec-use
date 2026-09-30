"""Native variable records adapted from the supplied MotionWorksTools workflow.

Four UTF-16 cells plus a 16-byte record tail; the group trailer is NOT a record.
Unknown bytes between native records are retained. Donors must match type and usage.
"""
from __future__ import annotations
import re
import struct
from .errors import UnsupportedFormat, NotFound

USAGES = (1, 5, 0x40001, 6, 22)


def read_record(raw: bytes, offset: int) -> dict:
    if offset < 12 or offset + 24 > len(raw):
        raise UnsupportedFormat('Truncated variable record header')
    fields = struct.unpack_from('<6I', raw, offset)
    pos, cells, spans = offset + 24, [], []
    for _ in range(4):
        if pos + 4 > len(raw):
            raise UnsupportedFormat('Truncated variable cell length')
        size = struct.unpack_from('<I', raw, pos)[0]
        if size < 2 or size % 2 or size > 65536 or pos + 4 + size > len(raw):
            raise UnsupportedFormat('Invalid UTF-16 variable cell length')
        data = raw[pos + 4:pos + 4 + size]
        if not data.endswith(b'\0\0'):
            raise UnsupportedFormat('Variable cell lacks a terminator')
        try:
            value = data[:-2].decode('utf-16le')
        except UnicodeDecodeError as exc:
            raise UnsupportedFormat('Invalid UTF-16 variable cell') from exc
        if '\0' in value:
            raise UnsupportedFormat('Embedded NUL in variable cell')
        spans.append((pos, pos + 4, pos + 4 + size))
        cells.append(value)
        pos += 4 + size
    if pos + 16 > len(raw):
        raise UnsupportedFormat('Truncated variable record tail')
    return dict(offset=offset, end=pos + 16, fields=fields, handle=fields[0], usage=fields[1],
                group=fields[2], row=fields[4], cells=cells, spans=spans,
                type=cells[0], address=cells[1], initial_value=cells[2], name=cells[3],
                tail=raw[pos:pos + 16], type_at=spans[0][0], between_at=spans[0][2],
                initial_at=spans[2][0], name_at=spans[3][0], after_name=pos, strings_end=pos)


def parse(raw: bytes) -> list[dict]:
    if len(raw) < 12 or struct.unpack_from('<I', raw)[0] != 524289:
        raise UnsupportedFormat('Unrecognized native variable worksheet header')
    high, count = struct.unpack_from('<2I', raw, 4)
    records = []
    for offset in range(12, max(12, len(raw) - 23)):
        h, u, g, f, row, z = struct.unpack_from('<6I', raw, offset)
        if not (1000 <= h <= high and u in USAGES and 1 <= g <= 32 and f == z == 0 and 0 < row < 1000000):
            continue
        try:
            record = read_record(raw, offset)
        except UnsupportedFormat:
            continue
        if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', record['name']):
            records.append(record)
    if len(records) != count:
        raise UnsupportedFormat(f'Variable grid header says {count} records; parsed {len(records)}')
    for key in ('handle', 'name'):
        values = [str(r[key]).casefold() for r in records]
        if len(set(values)) != len(values):
            raise UnsupportedFormat(f'Duplicate variable grid {key}')
    rows = [(r['group'], r['row']) for r in records]
    if len(set(rows)) != len(rows):
        raise UnsupportedFormat('Duplicate worksheet row within a group')
    for left, right in zip(records, records[1:]):
        if left['end'] > right['offset']:
            raise UnsupportedFormat('Overlapping variable records')
    end = records[-1]['end'] if records else 12
    if end >= len(raw):
        raise UnsupportedFormat('Native worksheet group trailer is missing')
    return records


def encode(record: dict, *, cells=None, handle=None, row=None) -> bytes:
    fields = list(record['fields'])
    if handle is not None: fields[0] = handle
    if row is not None: fields[4] = row
    out = struct.pack('<6I', *fields)
    for cell in cells if cells is not None else record['cells']:
        value = (cell + '\0').encode('utf-16le')
        out += struct.pack('<I', len(value)) + value
    return out + record['tail']


def find(records, name):
    matches = [r for r in records if r['name'].casefold() == name.casefold()]
    if len(matches) != 1:
        raise NotFound(f'Expected one grid record for {name!r}; found {len(matches)}')
    return matches[0]


def require_known_extent(records, record):
    index = records.index(record)
    if index + 1 < len(records) and records[index + 1]['offset'] != record['end']:
        raise UnsupportedFormat('Selected native record has an unrecognized extension; refusing to synthesize or remove it')


def add(raw, name, type_name, *, usage=1, address='', initial_value=None,
        donor_name=None, donor_grid=None, group=None, row=None):
    records = parse(raw)
    if any(r['name'].casefold() == name.casefold() for r in records):
        raise UnsupportedFormat(f'Variable {name} already exists in the worksheet')
    donors = parse(donor_grid if donor_grid is not None else raw)
    allowed = set(usage if isinstance(usage, (list, tuple)) else [usage])
    # The type must match the donor. Measured on a real project, two records of different types
    # looked interchangeable - six uint32 fields, a 16-byte tail, group 1 - but building one from
    # a donor of another type produced a record the project could no longer parse, and MotionWorks
    # had already rewritten it by the time it was read back. Treat the type as part of the layout
    # contract; a donor of the wrong type is not a safe source.
    candidates = [r for r in donors if r['usage'] in allowed
                  and r['type'].casefold() == type_name.casefold()
                  and bool(r['address']) == bool(address)
                  and (group is None or r['group'] == group)
                  and (donor_name is None or r['name'].casefold() == donor_name.casefold())]
    if not candidates:
        raise UnsupportedFormat('No compatible native donor: match type, usage, group and addressed/unaddressed layout')
    # Different hidden flags/tails cannot be resolved by guessing. Equivalent donors are interchangeable.
    shapes = {(r['fields'][1:4], r['tail']) for r in candidates}
    if len(shapes) != 1 and donor_name is None:
        raise UnsupportedFormat('Ambiguous native donors; pass donor explicitly')
    donor = candidates[0]
    require_known_extent(donors, donor)
    if donor_grid is not None and donor['group'] != 1:
        raise UnsupportedFormat('Cross-worksheet donors require the Default group')
    handle = max([struct.unpack_from('<I', raw, 4)[0]] + [r['handle'] for r in records]) + 1
    # Rows are native worksheet identifiers, NOT declaration source line numbers.
    new_row = max([0] + [r['row'] for r in records if r['group'] == donor['group']]) + 1
    if row is not None:
        new_row = row
    if (donor['group'], new_row) in {(r['group'], r['row']) for r in records}:
        raise UnsupportedFormat('Requested worksheet row already exists')
    cells = [type_name, address or '', donor['initial_value'] if initial_value is None else initial_value, name]
    record = encode(donor, cells=cells, handle=handle, row=new_row)
    end = records[-1]['end'] if records else 12
    out = bytearray(raw[:end] + record + raw[end:])
    struct.pack_into('<II', out, 4, handle, len(records) + 1)
    parse(bytes(out))
    return bytes(out), handle


def edit(raw, name, *, new_name=None, type_name=None, initial_value=None, address=None,
         donor_name=None):
    records = parse(raw)
    current = find(records, name)
    require_known_extent(records, current)
    donor = current
    wanted_type = type_name if type_name is not None else current['type']
    wanted_address = address if address is not None else current['address']
    if wanted_type.casefold() != current['type'].casefold() or bool(wanted_address) != bool(current['address']):
        matches = [r for r in records if r['type'].casefold() == wanted_type.casefold()
                   and r['usage'] == current['usage'] and r['group'] == current['group']
                   and bool(r['address']) == bool(wanted_address)
                   and (donor_name is None or r['name'].casefold() == donor_name.casefold())]
        if not matches or (len({r['tail'] for r in matches}) != 1 and donor_name is None):
            raise UnsupportedFormat('Type/address-layout change requires an unambiguous compatible native donor')
        donor = matches[0]
        require_known_extent(records, donor)
    cells = [wanted_type, wanted_address, current['initial_value'] if initial_value is None else initial_value,
             current['name'] if new_name is None else new_name]
    replacement = encode(donor, cells=cells, handle=current['handle'], row=current['row'])
    # Preserve the edited variable's translation ID rather than the type donor's.
    replacement = bytearray(replacement)
    replacement[-8:-4] = current['tail'][8:12]
    replacement = bytes(replacement)
    out = raw[:current['offset']] + replacement + raw[current['end']:]
    parse(out)
    return out, dict(handle=current['handle'], row=current['row'], **{'from': name, 'to': cells[3]})


def delete(raw, name):
    records = parse(raw)
    record = find(records, name)
    require_known_extent(records, record)
    out = bytearray(raw[:record['offset']] + raw[record['end']:])
    struct.pack_into('<I', out, 8, len(records) - 1)
    parse(bytes(out))
    return bytes(out), dict(handle=record['handle'], row=record['row'], removed=name)


def pair_findings(text, raw):
    """Report every declaration/worksheet inconsistency instead of raising on the first.

    A project may already carry a record the compiler and the IDE both accept while the two
    redundant stores disagree, and a vendor-authored project does exactly that. Collecting the
    findings lets a caller keep working on an unrelated variable while still proving that the
    edit introduces no new disagreement of its own.
    """
    from .variables import parse_declarations
    findings = []
    table = parse_declarations(text)
    if table.warnings or table.duplicates():
        # The declaration table itself is untrustworthy, so every comparison below would be noise.
        return ['Declaration parser warnings: ' + '; '.join(table.warnings)]
    records = parse(raw)
    expected = {v.name.casefold(): v for v in table.variables}
    actual = {r['name'].casefold(): r for r in records}
    if expected.keys() != actual.keys():
        return [f'Declaration/grid mismatch: text-only={sorted(expected.keys()-actual.keys())}, grid-only={sorted(actual.keys()-expected.keys())}']
    for name, variable in expected.items():
        record = actual[name]
        if variable.type_name.casefold() != record['type'].casefold() or (variable.address or '').casefold() != record['address'].casefold():
            findings.append(f'Declaration/grid type or address differs for {variable.name}')
            continue
        expected_initial = variable.initial_value.strip().upper() if variable.initial_value is not None else None
        actual_initial = record['initial_value'].strip().upper()
        primitive_defaults = {'BOOL': {'FALSE', '0'}, 'INT': {'0'}, 'DINT': {'0'}, 'SINT': {'0'},
                              'UINT': {'0'}, 'UDINT': {'0'}, 'USINT': {'0'}, 'REAL': {'0', '0.0'}, 'LREAL': {'0', '0.0'}}
        empty_default = not actual_initial and expected_initial in primitive_defaults.get(variable.type_name.upper(), set())
        if expected_initial is not None and expected_initial != actual_initial and not empty_default:
            findings.append(f'Declaration/grid initial value differs for {variable.name}')
        allowed = {'VAR_EXTERNAL': (5,), 'VAR_GLOBAL': (6, 22), 'VAR': (1, 0x40001)}.get(variable.section)
        if allowed and record['usage'] not in allowed:
            findings.append(f'Declaration/grid usage differs for {variable.name}')
    return findings


def validate_pair(text, raw):
    findings = pair_findings(text, raw)
    if findings:
        raise UnsupportedFormat(findings[0])
    records = parse(raw)
    return {'ok': True, 'variables': len(records), 'trailer_bytes': len(raw) - (records[-1]['end'] if records else 12)}
