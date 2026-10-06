import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import knowledge as K, program_checks as C


class References(unittest.TestCase):
    def test_fresh_compiled_review_contract_and_refusals(self):
        current = dict(name='ProtectedFB', library='Vendor', kind='FUNCTION_BLOCK', hidden=False,
            evidence_kind='installed-compiled-block-interface', insertion_eligible=False,
            pins=[dict(name='Enable', type='BOOL', direction='input'), dict(name='Done', type='BOOL', direction='output')],
            binding='native', origin='user_library_compiled_declarations', source_stream='Cached.VB',
            source_file='source', source_sha256='a'*64, reference_registry='registry', registry_sha256='b'*64,
            worksheet_file='worksheet', worksheet_sha256='c'*64, cache_file='cache', cache_sha256='d'*64,
            compiler_dependency='dependency', compiler_dependency_sha256='e'*64,
            compiler_type_table='types', compiler_type_table_sha256='f'*64,
            source_declaration_count=2, compiler_declaration_count=2)
        verified = dict(current, evidence_kind='fresh-bound-compiled-block-interface', insertion_eligible=True,
            project_compiler_freshness_verified=True, compiler_library_binding_verified=True,
            compiler_pin_types_verified=True, compile_acceptance_only=True,
            compiler_source_binding_verified=False, compiler_cache_freshness_verified=False,
            verified_at_ms=time.time()*1000, source_baseline_digest='1'*64, library_manifest_digest='2'*64)
        spec = C.compiled_interface_signature(verified, current)
        self.assertEqual(spec['authority'], 'fresh_bound_compiled_contract')
        self.assertFalse(spec['citation']['protected_source_decoded'])
        report = C.review('fb(Enable:=FALSE, Wrong:=TRUE);', 'VAR\nfb:ProtectedFB;\nEND_VAR', signatures={'PROTECTEDFB': spec})
        self.assertTrue(any(f['code']=='unknown-fb-parameter' and f['severity']=='error' for f in report['findings']))
        for patch in [dict(evidence_kind='installed-compiled-block-interface'), dict(project_compiler_freshness_verified=False),
                      dict(compiler_library_binding_verified=False), dict(compiler_pin_types_verified=False),
                      dict(compile_acceptance_only=False), dict(compiler_source_binding_verified=True),
                      dict(compiler_cache_freshness_verified=True), dict(verified_at_ms=0),
                      dict(verified_at_ms=time.time()*1000+10000), dict(source_baseline_digest='bad')]:
            with self.assertRaises(ValueError): C.compiled_interface_signature({**verified, **patch}, current)
        for patch in [dict(pins=[]), dict(compiler_dependency_sha256='0'*64), dict(library='Other')]:
            with self.assertRaises(ValueError): C.compiled_interface_signature(verified, {**current, **patch})

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

    def test_observed_output_syntax_diagnostic_routes_to_installed_help(self):
        result=K.diagnose("Illegal IEC syntax at or before '>'!")
        self.assertTrue(result['matched']);self.assertFalse(result['automatic_changes'])
        candidate=result['matches'][0]
        self.assertEqual(candidate['confidence'],'candidate_not_confirmed')
        self.assertEqual(candidate['evidence']['installed_help']['topic'],'callingfunctionblocksinst.htm')
        self.assertIn('If the line uses =>',' '.join(candidate['suggested_checks']))
        self.assertIn('other reasons',' '.join(candidate['suggested_checks']))
        self.assertFalse(K.diagnose("Illegal IEC syntax at or before ';'!")['matched'])

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
    def test_installed_selector_validation_and_no_historical_fallback(self):
        for selectors, libraries in [({'TON':'IEC'},None),({'TON':'IEC','ton':'eCLR'},[]),({'TON':'bad/path'},[])]:
            with self.assertRaises(ValueError):
                C.check_project(Path('fixture'),native_libraries=libraries,interface_libraries=selectors)
        text='VAR\nfb:MC_Power;\nEND_VAR'
        table=C.parse_declarations(text)
        container=SimpleNamespace(stream_names=lambda:['Main.VB'],read_stream=lambda name:text.encode())
        item=SimpleNamespace(name='Main',language=lambda:'ST',declarations=lambda:table,
            st_body=lambda:'fb(Unknown:=TRUE);',source=lambda:container,source_path=Path('Main/src.st1'))
        project=SimpleNamespace(pous=lambda:[item],pou=lambda name:item,
            global_variables=lambda:SimpleNamespace(warnings=[],variables=[]),task_assignments=lambda:{})
        with patch('motionworks_iec_mcp.project.Project',return_value=project), patch('motionworks_iec_mcp.block_interfaces.inspect',side_effect=ValueError('ambiguous')) as resolve:
            report=C.check_project(Path('fixture'),pou='Main',native_libraries=[],interface_libraries={'mc_power':'Firmware'})
        self.assertEqual(resolve.call_args.args[-1],'Firmware')
        self.assertEqual(report['coverage'][0]['unresolved_signatures'],['MC_Power'])
        self.assertEqual(report['installed_interfaces'][0]['status'],'unresolved')
        self.assertFalse(any(f['code']=='unknown-fb-parameter' for f in report['findings']))

    def test_bound_interface_authority_literals_and_unresolved(self):
        interface = dict(name='Timer', kind='FUNCTION_BLOCK', hidden=False,
            evidence_kind='installed-declared-block-interface', pins=[
                dict(name='IN',type='BOOL',direction='input'),
                dict(name='PT',type='TIME',direction='input'),
                dict(name='Q',type='BOOL',direction='output')],
            library='IEC',binding='saved_implicit_reference',origin='firmware_parameter_table',
            source_file='tmp.sto',source_stream='Timer.PT',source_sha256='bodyhash',
            reference_registry='IEC.POU',registry_sha256='registryhash')
        spec=C.interface_signature(interface)
        declarations='VAR\nfb:Timer;\nrun:BOOL;\nEND_VAR'
        good=C.review('fb(IN:=run, PT:=T#100ms);',declarations,signatures={'TIMER':spec})
        self.assertFalse(good['findings'])
        bad=self.codes('fb(PT:=run, Wrong:=TRUE);',declarations,signatures={'TIMER':spec})
        for code in ('unknown-fb-parameter','fb-parameter-type'):
            self.assertEqual(bad[code]['severity'],'error')
            self.assertEqual(bad[code]['reference']['source_sha256'],'bodyhash')
        unresolved=C.review('fb(Enable:=TRUE);','VAR\nfb:MC_Power;\nEND_VAR',signatures={'MC_POWER':None})
        self.assertEqual(unresolved['unresolved_signatures'],['MC_Power'])
        self.assertFalse(unresolved['findings'])
        self.assertEqual(C.expression_type('D#2026-10-01',{}),'DATE')
        self.assertEqual(C.expression_type('TIME#100ms',{}),'TIME')
        any_spec={**spec,'inputs':{'Value':'ANY'}}
        self.assertNotIn('fb-parameter-type',self.codes('fb(Value:=run);',declarations,signatures={'TIMER':any_spec}))
        with self.assertRaises(ValueError): C.interface_signature({**interface,'hidden':True})
        with self.assertRaises(ValueError): C.interface_signature({**interface,'evidence_kind':'installed-compiled-block-interface','insertion_eligible':False})
        with self.assertRaises(ValueError): C.interface_signature({**interface,'insertion_eligible':False})
        with self.assertRaises(ValueError): C.interface_signature({**interface,'pins':interface['pins']+[interface['pins'][0]]})

    def test_native_pdd_attribute_is_not_initializer_text(self):
        table=C.parse_declarations("VAR\nx:INT := 7 {PDD};\ny:BOOL {PDD};\nz:INT := 7 {CSV};\ns:STRING := '{PDD}';\nu:INT := 7 {UNKNOWN};\nEND_VAR")
        self.assertFalse(table.warnings)
        self.assertEqual(table.by_name('x').initial_value,'7')
        self.assertEqual(table.by_name('y').type_name,'BOOL')
        self.assertEqual(table.by_name('z').initial_value,'7')
        self.assertEqual(table.by_name('s').initial_value,"'{PDD}'")
        self.assertEqual(table.by_name('u').initial_value,'7 {UNKNOWN}')
        disabled=C.parse_declarations('VAR\n(*<x : INT := 7;>*)(*disabled variable*)\nEND_VAR').by_name('x')
        self.assertEqual(disabled.initial_value,'7')
        self.assertEqual(disabled.description,'disabled variable')
        self.assertTrue(disabled.disabled)
        self.assertTrue(disabled.to_dict()['disabled'])
        combined=C.parse_declarations("VAR RETAIN\n(*<x:INT := 7 {CSV,PDD,RDT,NOP};>*)(*all flags*)\ns:STRING := '{CSV,PDD,RDT,NOP}' {CSV,PDD,RDT,NOP};\nu:INT := 7 {CSV,UNKNOWN};\nEND_VAR")
        self.assertFalse(combined.warnings)
        self.assertEqual(combined.by_name('x').initial_value,'7')
        self.assertTrue(combined.by_name('x').disabled)
        self.assertEqual(combined.by_name('x').description,'all flags')
        self.assertEqual(combined.by_name('s').initial_value,"'{CSV,PDD,RDT,NOP}'")
        self.assertEqual(combined.by_name('u').initial_value,'7 {CSV,UNKNOWN}')

    def test_writable_fb_bindings_literals_and_unresolved_storage(self):
        spec={'authority':'bound_installed_declaration','complete':True,
              'inputs':{},'outputs':{'Q':'ANY'},'inouts':{'State':'ANY'},
              'citation':{'source_sha256':'installed-interface-hash'}}
        declarations='VAR\nfb:Timer;\nvalue:TIME;\nEND_VAR'
        for literal in ['T#100ms','TIME#1s','D#2026-10-02','REAL#1.25',
                        'TRUE','16#FF','-1.25E+3','1E3',"'text'",'"wide"',"'can''t'", "'$'quoted$''"]:
            report=C.review(f'fb(State:={literal}, Q=>{literal});',declarations,signatures={'TIMER':spec})
            invalid=[f for f in report['findings'] if f['code'] in ('fb-inout-needs-variable','fb-output-needs-variable')]
            self.assertEqual(len(invalid),2,literal)
            self.assertTrue(all(f['severity']=='error' and f['reference']['source_sha256']=='installed-interface-hash' for f in invalid))
        good=C.review('fb(State:=value, Q=>value);',declarations,signatures={'TIMER':spec})
        self.assertFalse(good['findings'])
        for target in ['state.Value','buffer[1]','missing','value + T#1s']:
            report=C.review(f'fb(State:={target});',declarations,signatures={'TIMER':spec})
            self.assertTrue(any(f['code']=='fb-writable-binding-unresolved' and f['severity']=='warning' for f in report['findings']),target)
            self.assertFalse(any(f['code']=='fb-inout-needs-variable' for f in report['findings']),target)

    def test_session_failures_are_candidates_not_repairs(self):
        for message in ['File error!: (POE\\Main\\MainV.vbc)',
                        'Internal error! MSILv2ResManager.cpp(1048)',
                        'Runtime exception! Division by zero', 'ENOTDIR workspace']:
            result = K.diagnose(message)
            self.assertTrue(result['matched'])
            self.assertFalse(result['automatic_changes'])
            self.assertTrue(all(x['confidence'] == 'candidate_not_confirmed' for x in result['matches']))

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
