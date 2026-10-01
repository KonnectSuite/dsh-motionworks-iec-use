"""Read-only workflow checks: relocation never becomes write permission."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import workflow


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mw-workflow-')
        self.ws = Path(self.temp.name).resolve()
        self.root = self.ws / '.motionworks' / 'stage' / 'Machine'
        self.root.mkdir(parents=True)
        self.identity = self.root.with_suffix('.identity.json')
        self.data = {'workspace': str(self.ws), 'source': str(self.ws/'Machine.mwt'),
                     'source_directory': str(self.ws/'Machine'),
                     'staged_directory': str(self.root), 'staged_mwt': str(self.root)+'.mwt'}
        self.identity.write_text(json.dumps(self.data))
        self.env = patch.dict(os.environ, {'MOTIONWORKS_MCP_WORKSPACE': str(self.ws),
                                         'MOTIONWORKS_MCP_STAGE': str(self.root.parent)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def check(self):
        pou = Mock(name='POU'); pou.name = 'Control'
        pou.st_body.return_value = 'fbFilter(IN := NOT Eye, PT := T#30ms);'
        with patch.object(workflow, 'embedded_paths', return_value=[]), \
             patch('motionworks_iec_mcp.validation.validate', return_value={'ok': True}), \
             patch('motionworks_iec_mcp.project.Project') as project:
            project.return_value.pous.return_value = [pou]
            return workflow.check(str(self.root))

    def test_sibling_wrapper_is_not_falsely_rejected(self):
        result = self.check()
        self.assertTrue(result['ready_for_ide_open'])
        self.assertEqual(result['binding_mode'], 'native_sibling_directory')
        self.assertEqual(result['evidence_level'], 'offline_only')
        self.assertIn('T#30ms', result['warnings'][0]['detail'])

    def test_relocated_identity_report_is_read_only_and_blocked(self):
        self.identity.write_text(json.dumps({**self.data, 'workspace': str(self.ws/'old')}))
        before = self.identity.read_bytes()
        result = self.check()
        self.assertFalse(result['ready_for_ide_open'])
        self.assertEqual(result['blockers'][0]['code'], 'identity_invalid')
        self.assertEqual(self.identity.read_bytes(), before)

    def test_outside_project_is_refused(self):
        with self.assertRaises(Exception):
            workflow.check(str(self.ws/'real-project'))

    def test_manifest_ignores_generated_output(self):
        first = workflow.source_manifest(self.root)
        (self.root/'generated.DLL').write_bytes(b'not source evidence')
        self.assertEqual(workflow.source_manifest(self.root), first)

    def test_manifest_covers_descriptions_and_pou_inventory(self):
        first = workflow.source_manifest(self.root)
        (self.root/'ControlVTranslation.xml').write_text('<translations>description</translations>')
        second = workflow.source_manifest(self.root)
        self.assertNotEqual(first['program_digest'], second['program_digest'])
        (self.root/'LIST.POU').write_text('Control\nNewPOU')
        third = workflow.source_manifest(self.root)
        self.assertNotEqual(second['source_digest'], third['source_digest'])

    def test_only_view_normalization_is_excluded_from_persistence(self):
        (self.root/'src.st1').write_bytes(b'mocked container')
        payloads = {'PRMVIEWALL.DAT': b'view-one', 'PROJECT.TRE': b'tree-one'}
        with patch.object(workflow, 'CompoundFile') as cfb:
            cfb.return_value.stream_names.return_value = list(payloads)
            cfb.return_value.read_stream.side_effect = lambda name: payloads[name]
            before = workflow.source_manifest(self.root)
            payloads['PRMVIEWALL.DAT'] = b'view-two'
            after = workflow.source_manifest(self.root)
            self.assertNotEqual(before['source_digest'], after['source_digest'])
            self.assertEqual(before['persistence_digest'], after['persistence_digest'])
            payloads['PROJECT.TRE'] = b'lost-task'
            changed = workflow.source_manifest(self.root)
            self.assertNotEqual(after['persistence_digest'], changed['persistence_digest'])


if __name__ == '__main__':
    unittest.main()
