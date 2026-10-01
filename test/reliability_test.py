import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code'))
import mw_code
from motionworks_iec_mcp import grid, transaction
from motionworks_iec_mcp.errors import MotionWorksError, UnsupportedFormat


def record(name='Flag', typ='BOOL', usage=1, handle=1025, row=6, address='', initial='FALSE'):
    out = struct.pack('<6I', handle, usage, 1, 0, row, 0)
    for value in (typ, address, initial, name):
        cell = (value + '\0').encode('utf-16le')
        out += struct.pack('<I', len(cell)) + cell
    return out + bytes(16)


TRAILER = b'NATIVE-GROUP-TRAILER\0\xff\xff'
def worksheet(*records):
    high = max([1024] + [struct.unpack_from('<I', r)[0] for r in records])
    return struct.pack('<3I', 524289, high, len(records)) + b''.join(records) + TRAILER


class GridTests(unittest.TestCase):
    def test_empty_native_primitive_initializers_match_defaults(self):
        grid.validate_pair('VAR\nFlag:BOOL:=FALSE;\nEND_VAR', worksheet(record(initial='')))
        with self.assertRaises(UnsupportedFormat):
            grid.validate_pair('VAR\nFlag:BOOL:=TRUE;\nEND_VAR', worksheet(record(initial='')))

    def test_pou_name_cannot_escape_directory(self):
        from motionworks_iec_mcp.pou_writer import plan_pou_creation, PouPlanError
        with self.assertRaises(PouPlanError):
            plan_pou_creation(Path('unused'), '../../outside', 'Template')

    def test_translation_ids_are_unique_and_xml_is_escaped(self):
        from motionworks_iec_mcp.descriptions import attach
        from motionworks_iec_mcp.writer import WritePlan
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'MainVTranslation.xml'
            path.write_bytes(b'<TranslationDocument><ItemList><item id="1"/></ItemList></TranslationDocument>')
            plan = WritePlan(root / 'src.st1', 'MainV.VB', b'', b'', extra_streams={'MainV.VGR': worksheet(record())})
            attach(plan, 'MainV.VGR', 'Flag', 'A & B < C')
            raw = plan.extra_streams['MainV.VGR']
            rec = grid.parse(raw)[0]
            self.assertEqual(struct.unpack_from('<I', raw, rec['end']-8)[0], 2)
            xml = ET.fromstring(plan.sidecars[path][1])
            self.assertEqual(xml.find("./ItemList/item[@id='2']/translation").text, 'A & B < C')

    def test_last_record_does_not_include_trailer(self):
        raw = worksheet(record())
        self.assertEqual(raw[grid.parse(raw)[-1]['end']:], TRAILER)
        added, _ = grid.add(raw, 'Second', 'BOOL')
        self.assertEqual(added[grid.parse(added)[-1]['end']:], TRAILER)
        self.assertEqual(added.count(TRAILER), 1)

    def test_delete_last_preserves_empty_native_grid(self):
        raw, _ = grid.delete(worksheet(record()), 'Flag')
        self.assertEqual(grid.parse(raw), [])
        self.assertEqual(raw[12:], TRAILER)

    def test_different_length_rename_and_initial(self):
        raw, _ = grid.edit(worksheet(record()), 'Flag', new_name='MuchLongerName', initial_value='TRUE')
        item = grid.parse(raw)[0]
        self.assertEqual(item['name'], 'MuchLongerName')
        self.assertEqual(item['initial_value'], 'TRUE')
        self.assertTrue(raw.endswith(TRAILER))

    def test_native_global_address_cell_is_updated(self):
        raw = worksheet(record(usage=22, address='%QX200.0'))
        raw, _ = grid.add(raw, 'NewOutput', 'BOOL', usage=(6, 22), address='%QX200.1')
        self.assertEqual(grid.parse(raw)[1]['address'], '%QX200.1')

    def test_duplicate_rows_and_header_count_are_refused(self):
        with self.assertRaises(UnsupportedFormat):
            grid.parse(worksheet(record(), record('Other', handle=1026)))
        raw = bytearray(worksheet(record()))
        struct.pack_into('<I', raw, 8, 2)
        with self.assertRaises(UnsupportedFormat): grid.parse(bytes(raw))

    def test_unknown_donor_type_is_not_synthesized(self):
        with self.assertRaises(UnsupportedFormat):
            grid.add(worksheet(record()), 'Axis', 'AXIS_REF')

    def test_usage_preserved_for_external(self):
        raw, _ = grid.add(worksheet(record(usage=5, initial='')), 'Other', 'BOOL', usage=5)
        self.assertEqual(grid.parse(raw)[1]['usage'], 5)

    def test_address_overlap(self):
        from motionworks_iec_mcp.variable_edit import check_addresses
        with self.assertRaises(UnsupportedFormat):
            check_addresses('VAR_GLOBAL\nA AT %QW200 : WORD;\nB AT %QX201.0 : BOOL;\nEND_VAR')


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.ws = Path(self.temp.name)
        self.root = self.ws / '.motionworks' / 'stage' / 'Project'
        self.root.mkdir(parents=True)
        self.file = self.root / 'source.txt'
        self.file.write_bytes(b'original')
        (self.root.parent / 'Project.identity.json').write_text(json.dumps({
            'workspace': str(self.ws), 'source': str(self.ws / 'Project.mwt'),
            'source_directory': str(self.ws / 'Project'), 'staged_directory': str(self.root),
            'staged_mwt': str(self.root) + '.mwt',
        }))
        self.env = patch.dict(os.environ, {'MOTIONWORKS_MCP_WORKSPACE': str(self.ws),
                                          'MOTIONWORKS_MCP_STAGE': str(self.root.parent)})
        self.env.start()
        self.closed = patch.object(transaction, 'ensure_ide_closed')
        self.closed.start()

    def tearDown(self):
        self.closed.stop(); self.env.stop(); self.temp.cleanup()

    def test_partial_failure_restores_original_and_removes_created_files(self):
        def operation():
            self.file.write_bytes(b'changed')
            (self.root / 'new.txt').write_text('new')
            raise RuntimeError('injected failure')
        with self.assertRaises(MotionWorksError): transaction.run(self.root, operation)
        self.assertEqual(self.file.read_bytes(), b'original')
        self.assertFalse((self.root / 'new.txt').exists())
        journals = list((self.ws / '.motionworks' / 'transactions').rglob('journal.json'))
        self.assertEqual(json.loads(journals[0].read_text())['state'], 'rolled_back')

    def test_unique_verified_backups_and_hash_evidence(self):
        def operation():
            self.file.write_bytes(self.file.read_bytes() + b'!')
            return {'ok': True, 'result': {}}
        a = transaction.run(self.root, operation)['result']['transaction']
        b = transaction.run(self.root, operation)['result']['transaction']
        self.assertNotEqual(a['backup'], b['backup'])
        self.assertEqual((Path(a['backup']) / 'source.txt').read_bytes(), b'original')
        self.assertEqual(a['verification'], 'offline_only')
        self.assertNotEqual(a['hashes']['source.txt']['before'], a['hashes']['source.txt']['after'])

    def test_lock_refuses_a_second_writer(self):
        def nested():
            with self.assertRaisesRegex(MotionWorksError, 'locked'):
                transaction.run(self.root, lambda: {})
            return {'result': {}}
        transaction.run(self.root, nested)

    def test_static_failure_rolls_back(self):
        def operation():
            self.file.write_bytes(b'invalid')
            return {'result': {}}
        with self.assertRaises(MotionWorksError):
            transaction.run(self.root, operation, validate=lambda _: {'ok': False})
        self.assertEqual(self.file.read_bytes(), b'original')

    def test_rollback_includes_hidden_and_generated_files(self):
        folder = self.root / '__pycache__'
        folder.mkdir()
        generated = folder / 'tmp.sto'
        generated.write_bytes(b'original-cache')
        def operation():
            generated.write_bytes(b'changed-cache')
            return {'ok': False, 'error': 'injected failure response'}
        with self.assertRaises(MotionWorksError): transaction.run(self.root, operation)
        self.assertEqual(generated.read_bytes(), b'original-cache')

    def test_atomic_variable_batch_rolls_back_prior_success(self):
        from motionworks_iec_mcp import writer
        def plan(_root, _pou, name, _type, **_kwargs):
            if name == 'Broken':
                raise ValueError('native donor unavailable')
            return name
        def apply(name, _root, **_kwargs):
            self.file.write_bytes(name.encode())
            return {'applied': True}
        request = {'project': str(self.root), 'dry_run': False,
                   'variables': [{'name': 'Good', 'type': 'BOOL'},
                                 {'name': 'Broken', 'type': 'BOOL'}]}
        with patch.object(writer, 'plan_variable_add', side_effect=plan), \
             patch.object(writer, 'apply_declaration', side_effect=apply):
            with self.assertRaisesRegex(MotionWorksError, r'item \[1\] Broken'):
                transaction.run(self.root, lambda: mw_code.verb_var_add_many(request))
        self.assertEqual(self.file.read_bytes(), b'original')

    def test_partial_variable_batch_requires_explicit_opt_in(self):
        from motionworks_iec_mcp import writer
        def plan(_root, _pou, name, _type, **_kwargs):
            if name == 'Broken':
                raise ValueError('native donor unavailable')
            return name
        def apply(name, _root, **_kwargs):
            self.file.write_bytes(name.encode())
            return {'applied': True}
        request = {'project': str(self.root), 'dry_run': False, 'allow_partial': True,
                   'variables': [{'name': 'Good', 'type': 'BOOL'},
                                 {'name': 'Broken', 'type': 'BOOL'}]}
        with patch.object(writer, 'plan_variable_add', side_effect=plan), \
             patch.object(writer, 'apply_declaration', side_effect=apply):
            result = transaction.run(self.root, lambda: mw_code.verb_var_add_many(request))
        self.assertEqual(self.file.read_bytes(), b'Good')
        self.assertEqual((result['applied'], result['failed']), (1, 1))
        self.assertEqual(result['result']['transaction']['state'], 'committed')


if __name__ == '__main__': unittest.main()
