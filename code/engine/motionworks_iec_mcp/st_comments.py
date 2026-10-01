"""Resolve native ST comment references using the worksheet translation file."""
import re
import xml.etree.ElementTree as ET

MARKER = re.compile(r'\x07(\d+),(\d+)\x07')

def resolve_comments(body, translation_path):
    if '\x07' not in body:
        return body
    root = ET.parse(translation_path).getroot()
    comments = {}
    for item in root.findall('./ItemList/item'):
        values = [t for t in item.findall('translation')
                  if t.get('{http://www.w3.org/XML/1998/namespace}lang') == 'undefined']
        if len(values) != 1 or item.get('id') in comments:
            raise ValueError('Ambiguous native comment translation')
        comments[item.get('id')] = ''.join(values[0].itertext())
    def replace(match):
        if match[1] != '1' or match[2] not in comments:
            raise ValueError('Unresolved native ST comment reference')
        return comments[match[2]]
    result = MARKER.sub(replace, body)
    if '\x07' in result:
        raise ValueError('Unsupported native ST comment reference')
    return result
