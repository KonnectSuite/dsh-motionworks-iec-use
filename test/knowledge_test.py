import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import knowledge as K, program_checks as C


class References(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'MOTIONWORKS_MCP_WORKSPACE': self.temp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_catalog_citations_resolve(self):
        data = K.catalog()
        sources = {s['id']: s for s in data['sources']}
        for topic in data['topics']:
            source = sources[topic['source_id']]
            self.assertTrue(source['url'].startswith('https://www.yaskawa.com/'))
            self.assertTrue(source['revision'])
            for page in topic['pdf_pages']:
                self.assertTrue(1 <= page <= source['pages'])
            self.assertEqual(K.reference(topic['id'])['citation']['revision'], source['revision'])

    def test_offline_search_has_versioned_scope(self):
        result = K.search('VAR_EXTERNAL')
        self.assertTrue(result['topics'])
        self.assertEqual(result['pages'], [])
        self.assertIn('revision', result['topics'][0]['citation'])
        self.assertEqual(len(K.search(source_id='basics')['sources']), 1)
        with self.assertRaises(ValueError): K.search('x' * 257)
        with self.assertRaises(ValueError): K.search(source_id='https://elsewhere.test')

    def test_signatures_are_historical_and_case_insensitive(self):
        self.assertEqual(K.signature('mc_power')['outputs']['Status'], 'BOOL')
        self.assertNotIn('Done', K.signature('MC_Power')['outputs'])
        self.assertEqual(K.signature('MC_Stop')['authority'], 'historical_vendor_reference')
        self.assertIsNone(K.signature('ImaginaryBlock'))

    def test_diagnostics_are_candidates_not_fixes(self):
        for message in ('Error in native code generation', 'Operand not implemented', '4370', '4625', 'watchdog', 'type mismatch'):
            result = K.diagnose(message)
            self.assertTrue(result['matched'], message)
            self.assertFalse(result['automatic_changes'])
            self.assertEqual(result['matches'][0]['confidence'], 'candidate_not_confirmed')
        self.assertFalse(K.diagnose('Unknown failure 987654321')['matched'])

    def test_all_patterns_have_sources_and_review_cleanly(self):
        for entry in K.patterns()['patterns']:
            pattern = K.patterns(entry['id'])
            self.assertTrue(pattern['references'])
            self.assertEqual(C.review(pattern['body'], pattern['declarations'])['findings'], [], entry['id'])

    def test_only_catalog_sync_allowed(self):
        with self.assertRaises(ValueError): K.sync(['https://elsewhere.test/a.pdf'])

    def test_changed_vendor_revision_is_rejected(self):
        with patch.object(K, '_fetch', return_value=b'%PDF changed'), patch.dict(sys.modules, {'pypdf': SimpleNamespace(PdfReader=None)}):
            result = K.sync(['basics'])
        self.assertFalse(result['ok'])
        self.assertIn('differs', result['sources'][0]['error'])
        self.assertFalse((K.cache_root() / 'basics.pdf').exists())

    def test_index_roundtrip_and_tampering(self):
        raw = b'%PDF reviewed fixture'
        source = {**K.catalog()['sources'][0], 'pages': 1, 'sha256': hashlib.sha256(raw).hexdigest()}
        data = {**K.catalog(), 'sources': [source], 'topics': []}
        reader = lambda _: SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: 'VAR_EXTERNAL is declared here')])
        with patch.object(K, 'catalog', return_value=data), patch.object(K, '_fetch', return_value=raw), patch.dict(sys.modules, {'pypdf': SimpleNamespace(PdfReader=reader)}):
            self.assertTrue(K.sync(['basics'])['ok'])
            self.assertEqual(K.search('VAR_EXTERNAL')['pages'][0]['pdf_page'], 1)
            index = K.cache_root() / 'basics.json'
            payload = json.loads(index.read_text(encoding='utf-8'))
            payload['pages'][0] = 'corrupted VAR_EXTERNAL'
            index.write_text(json.dumps(payload), encoding='utf-8')
            self.assertFalse(K.search('VAR_EXTERNAL')['pages'])
            self.assertIn('integrity', K.search('VAR_EXTERNAL')['unavailable_indexes'][0]['reason'])

    def test_cache_remains_in_workspace(self):
        self.assertTrue(K.cache_root().is_relative_to(Path(self.temp.name).resolve()))
        with self.assertRaises(ValueError): K._safe_child(K.cache_root(), '../../outside')
        with patch.dict(os.environ, {'MOTIONWORKS_MCP_WORKSPACE': ''}):
            with self.assertRaises(Exception): K.cache_root()


class Programming(unittest.TestCase):
    def codes(self, body, declarations, globals_text=None, **kwargs):
        return {f['code']: f for f in C.review(body, declarations, globals_text, **kwargs)['findings']}

    def test_external_scope_and_type(self):
        declarations = 'VAR_EXTERNAL\nG_Run: BOOL;\nEND_VAR'
        self.assertIn('external-missing-global', self.codes('', declarations, 'VAR_GLOBAL\nOther:BOOL;\nEND_VAR'))
        self.assertEqual(self.codes('', declarations, 'VAR_GLOBAL\nG_Run:INT;\nEND_VAR')['external-type-mismatch']['severity'], 'error')
        self.assertEqual(C.review('', declarations)['global_scope'], 'unresolved')
        self.assertNotIn('external-missing-global', self.codes('', declarations))

    def test_range_and_conversion(self):
        declarations = 'VAR\nx:USINT:=256;\ny:INT;\nb:BOOL;\nEND_VAR'
        result = self.codes('y := INT#40000;\ny := b;', declarations)
        self.assertIn('initializer-out-of-range', result)
        self.assertIn('assignment-out-of-range', result)
        self.assertIn('explicit-conversion-review', result)
        self.assertEqual(C.integer_literal('WORD#16#FF_FF'), 65535)

    def test_comments_strings_and_nested_arguments(self):
        body = "(* outer (* x := 99999; *) *)\ns := 'x := 99999;'; // x := 99999;\nfb(P := F(1,2), Q := a[1,2]);"
        self.assertNotIn('assignment-out-of-range', self.codes(body, 'VAR\nx:INT;\nEND_VAR'))
        call = next(C.calls(body))
        self.assertEqual(call[1], [('P', ':=', 'F(1,2)'), ('Q', ':=', 'a[1,2]')])
        self.assertEqual(len(C.mask(body)), len(body))

    def test_historical_pin_errors_are_advisory(self):
        declarations = 'VAR\nfb:MC_Power;\na:AXIS_REF;\nn:INT;\nEND_VAR'
        result = self.codes('fb(Axis:=a, Enable:=n, Status:=TRUE, Missing:=TRUE);', declarations)
        for code in ('fb-parameter-type', 'fb-parameter-direction', 'unknown-fb-parameter'):
            self.assertEqual(result[code]['severity'], 'warning')

    def test_historical_unsupported_pin_is_not_silently_accepted(self):
        result = self.codes('fb(Enable_Positive:=TRUE);', 'VAR\nfb:MC_Power;\nEND_VAR')
        self.assertEqual(result['historical-unsupported-pin']['severity'], 'warning')

    def test_project_interface_overrides_historical(self):
        spec = {'inputs': {'Custom': 'BOOL'}, 'outputs': {}, 'inouts': {}, 'complete': True, 'authority': 'project_declaration'}
        result = self.codes('fb(Enable:=TRUE);', 'VAR\nfb:MC_Power;\nEND_VAR', signatures={'MC_POWER': spec})
        self.assertEqual(result['unknown-fb-parameter']['severity'], 'error')

    def test_duplicate_inout_execute_and_error(self):
        result = self.codes('fb(Axis:=1, Execute:=TRUE, Execute:=TRUE);', 'VAR\nfb:MC_Stop;\nEND_VAR')
        for code in ('duplicate-fb-parameter', 'fb-inout-needs-variable', 'execute-held-true', 'fb-error-not-observed'):
            self.assertIn(code, result)

    def test_bound_error_and_omitted_inputs(self):
        result = self.codes('fb(Axis:=a, Error=>fault);', 'VAR\nfb:MC_Power;\na:AXIS_REF;\nfault:BOOL;\nEND_VAR')
        self.assertNotIn('fb-error-not-observed', result)
        self.assertFalse(any(f['severity'] == 'error' for f in result.values()))

    def test_named_pin_does_not_assign_same_named_local(self):
        self.assertNotIn('assignment-out-of-range', self.codes('unknown(Value:=99999);', 'VAR\nValue:INT;\nunknown:CustomType;\nEND_VAR'))

    def test_unknown_interface_is_unresolved(self):
        self.assertEqual(C.review('fb(X:=TRUE);', 'VAR\nfb:CustomType;\nEND_VAR')['unresolved_signatures'], ['CustomType'])

    def test_task_names_are_candidates(self):
        findings = C.task_review(['ProgramType'], {'Cyclic': ['InstanceName']})
        self.assertEqual(findings[0]['binding_resolution'], 'instance_names_only')
        self.assertEqual(C.task_review(['SameName'], {'Cyclic': ['samename']}), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
