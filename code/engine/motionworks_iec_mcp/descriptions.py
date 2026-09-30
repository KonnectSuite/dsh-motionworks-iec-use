"""Native worksheet description IDs and their translation sidecars."""
import struct
import xml.etree.ElementTree as ET
from .grid import find, parse
from .errors import UnsupportedFormat


def attach(plan, grid_name, variable, description):
    raw = bytearray(plan.extra_streams[grid_name])
    record = find(parse(bytes(raw)), variable)
    # The third DWORD of the fixed record tail is the native translation ID.
    path = plan.target.parent / (grid_name[:-4] + 'Translation.xml')
    before = path.read_bytes() if path.exists() else None
    root = ET.fromstring(before) if before else ET.Element('TranslationDocument')
    if root.tag != 'TranslationDocument':
        raise UnsupportedFormat('Unknown native translation document layout')
    items = root.find('ItemList')
    if items is None:
        items = ET.SubElement(root, 'ItemList')
    ids = [int(item.attrib['id']) for item in items.findall('item')]
    if len(ids) != len(set(ids)):
        raise UnsupportedFormat('Duplicate native translation IDs')
    # Allocate instead of modifying a potentially shared donor description.
    identifier = max([0] + ids) + 1
    item = ET.SubElement(items, 'item', {'id': str(identifier), 'readonly': 'False'})
    ET.SubElement(item, 'translation', {'{http://www.w3.org/XML/1998/namespace}lang': 'undefined'}).text = description
    struct.pack_into('<I', raw, record['end'] - 8, identifier)
    plan.extra_streams[grid_name] = bytes(raw)
    plan.sidecars[path] = (before, ET.tostring(root, encoding='utf-16', xml_declaration=True))
    return plan
