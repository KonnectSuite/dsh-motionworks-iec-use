import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.graphical_listing import inspect, networks, symbols

CODE='(*\nT: PROGRAM Main\nCI#: 1\n*)\n\t@NETWORK_BEGIN\n@BPV 1 4 0\tLD\t@IV 1\n@BPV 1 5 0\tST\t@RV 2\n\t@NETWORK_END\n'
DIT='(*\nT: PROGRAM Main\n*)\nInput\t1\tVAR\t@TYP:1\n@IV 1\n;\n\nOutput\t2\tVAR_EXTERNAL\t@TYP:1\n@RV 2\n;\n'
class Listing(unittest.TestCase):
    def test_networks_annotations_unknowns_and_truncation(self):
        parsed=networks(CODE,symbols(DIT))
        self.assertEqual(parsed[0]['lines'][0]['symbols'][0]['declaration']['name'],'Input')
        self.assertFalse(networks(CODE.replace('@IV 1','@IV 9'),symbols(DIT))[0]['lines'][0]['symbols'][0]['resolved'])
        for bad in [CODE.replace('@NETWORK_END',''),CODE.replace('@NETWORK_BEGIN',''),CODE.replace('@NETWORK_BEGIN','@NETWORK_BEGIN\n@NETWORK_BEGIN')]:
            with self.assertRaises(ValueError):networks(bad,{})
    def test_implicit_local_and_fb_instances_keep_pin_names_unknown(self):
        dit = 'Local\t10\tVAR\t@TYP:11\n\t\n;\nTimer\t3\tVAR\t@FB:76\n\n;\n'
        bindings = symbols(dit)
        self.assertEqual(bindings['@IV 10']['name'], 'Local')
        self.assertEqual(bindings['@IFB 3']['name'], 'Timer')
        code = CODE.replace('@IV 1', '@IFBP 3.2').replace('@RV 2', '@IFB 3')
        pin, call = [line['symbols'][0] for line in networks(code, bindings)[0]['lines']]
        self.assertFalse(pin['resolved']);self.assertEqual(pin['instance']['name'],'Timer')
        self.assertEqual(pin['pin_ordinal'],2);self.assertTrue(call['resolved'])
        with self.assertRaisesRegex(ValueError,'ordinal/name'):symbols(dit+dit)
        with self.assertRaisesRegex(ValueError,'saved worksheet'):
            symbols(dit,[SimpleNamespace(name='Wrong',section='VAR')])
        # No ordinal fallback for an external without its resource binding.
        self.assertEqual(symbols('Outside\t1\tVAR_EXTERNAL\t@TYP:1\n\n;\n'), {})

    def fixture(self, root):
        directory=root/'C'/'Configuration'/'R'/'Resource';directory.mkdir(parents=True)
        path=directory/'ICI00001.CIC';path.write_text(CODE)
        path.with_suffix('.DIT').write_text(DIT)
        path.with_suffix('.DIW').write_text('00001\t00002\tPOE\\Main\\MainV.vb\n00002\t00000\tPOE\\Main\\Main.gb\n')
        path.with_suffix('.SP').write_text(str(root/'POE'/'Main'/'Main.gb')+'\t4\t1\t4\t1\t0000\n')
        class Pou:
            name='Main'
            def body_stream(self):return ('Main.GB','LD')
            def declarations(self):return SimpleNamespace(warnings=[],variables=[SimpleNamespace(name='Input',section='VAR',type_name='BOOL'),SimpleNamespace(name='Output',section='VAR_EXTERNAL',type_name='BOOL')])
        class Project:
            def pou(self,name):return Pou()
        project=Project();project.root=root
        return project,path
    def test_exact_sources_bounded_page_and_mismatched_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path=self.fixture(Path(temp))
            result=inspect(project,'Main')
            self.assertEqual(result['network_count'],1);self.assertEqual(len(result['artifacts']),4)
            self.assertFalse(result['compiler_cache_freshness_verified'])
            self.assertEqual(inspect(project,'Main',start=2)['networks'],[])
            path.with_suffix('.DIT').write_text(DIT.replace('PROGRAM Main','FUNCTION_BLOCK Other'))
            with self.assertRaisesRegex(ValueError,'declaration identity'):inspect(project,'Main')
            path.with_suffix('.DIT').write_text(DIT)
            path.with_suffix('.SP').write_text(str(Path(temp)/'other'/'Main.gb')+'\t4\n')
            with self.assertRaisesRegex(ValueError,'another project'):inspect(project,'Main')
    def test_missing_ambiguous_bad_range_and_worksheet(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path=self.fixture(Path(temp))
            for start,limit in [(0,1),(1,51),(True,1)]:
                with self.assertRaises(ValueError):inspect(project,'Main',start,limit)
            path.with_suffix('.DIW').write_text('00002\t00000\tPOE\\Other\\Main.gb\n')
            with self.assertRaisesRegex(ValueError,'worksheet identity'):inspect(project,'Main')
            path.with_name('ICI00002.CIC').write_text(CODE)
            with self.assertRaisesRegex(ValueError,'ambiguous'):inspect(project,'Main')
            path.unlink();path.with_name('ICI00002.CIC').unlink()
            with self.assertRaisesRegex(ValueError,'absent'):inspect(project,'Main')
    def test_textual_source_provenance_without_graphical_network_parsing(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path=self.fixture(Path(temp))
            pou=project.pou('Main');pou.body_stream=lambda:('Main.ST','ST')
            project.pou=lambda name:pou
            path.write_text('(*\nT: PROGRAM Main\n*)\nLD\t@IV 1\nST\t@IV 2\n')
            path.with_suffix('.DIW').write_text('00002\t00000\tPOE\\Main\\Main.st\n')
            path.with_suffix('.SP').write_text(str(Path(temp)/'POE'/'Main'/'Main.st')+'\t4\n')
            self.assertEqual(len(inspect(project,'Main',source_only=True)['artifacts']),4)
            with self.assertRaisesRegex(ValueError,'graphical'):inspect(project,'Main')
            path.with_suffix('.SP').write_text('')
            with self.assertRaisesRegex(ValueError,'no worksheet mapping'):inspect(project,'Main',source_only=True)

    def fb_fixture(self, root):
        project,path=self.fixture(root)
        path.write_text(CODE.replace('@IV 1','@IFBP 3.4').replace('@RV 2','@IFBP 3.3'))
        path.with_suffix('.DIT').write_text('(*\nT: PROGRAM Main\n*)\nTimer\t3\tVAR\t@FB:76\n\n;\n')
        pou=project.pou('Main')
        pou.declarations=lambda:SimpleNamespace(warnings=[],variables=[SimpleNamespace(name='Timer',section='VAR',type_name='TON')])
        project.pou=lambda name:pou
        dependency=path.with_name('ICI00076.DIT')
        text='(*\nT: FUNCTION_BLOCK TON\nCI#: 76\nQVE: 5\n*)\n'
        for ordinal,name,section in [(1,'IN','VAR_INPUT'),(2,'PT','VAR_INPUT'),(3,'ET','VAR_OUTPUT'),(4,'Q','VAR_OUTPUT'),(5,'Code@@80','VAR')]:
            text+=f'{name}\t{ordinal}\t{section}\t@TYP:1\n\n;\n'
        dependency.write_text(text)
        return project,path,dependency,text

    def test_fb_pins_use_matching_compiler_ordinals_and_ignore_internal_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path,dependency,text=self.fb_fixture(Path(temp))
            result=inspect(project,'Main')
            pins=[line['symbols'][0] for line in result['networks'][0]['lines']]
            self.assertEqual([p['declaration']['name'] for p in pins],['Q','ET'])
            self.assertTrue(all(p['resolved'] and p['pin_direction']=='output' for p in pins))
            self.assertEqual(pins[0]['instance']['name'],'Timer')
            self.assertEqual(pins[0]['dependency_sha256'],result['dependency_artifacts'][0]['sha256'])
            self.assertEqual(len(result['artifacts']),4)
            self.assertEqual(len(result['dependency_artifacts']),1)
            for ordinal in (5,99):
                path.write_text(CODE.replace('@IV 1',f'@IFBP 3.{ordinal}'))
                pin=inspect(project,'Main')['networks'][0]['lines'][0]['symbols'][0]
                self.assertFalse(pin['resolved']);self.assertIsNone(pin['declaration'])

    def test_fb_dependency_wrong_identity_partial_and_duplicate_declarations_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path,dependency,text=self.fb_fixture(Path(temp))
            for bad in [text.replace('CI#: 76','CI#: 77'),text.replace('FUNCTION_BLOCK TON','FUNCTION TON'),
                        text.replace('TON','Other'),text.replace('QVE: 5','QVE: 6'),
                        text.replace('*)',''),text.replace('Code@@80\t5','Code@@80\t3'),
                        text.replace('Q\t4','Q\t3'),text.replace('Q\t4','ET\t4'),
                        text.replace('Q\t4','Q\t9')]:
                dependency.write_text(bad)
                with self.assertRaises(ValueError):inspect(project,'Main')
            dependency.unlink()
            with self.assertRaises(FileNotFoundError):inspect(project,'Main')

    def test_fb_dependency_changed_after_read_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            project,path,dependency,text=self.fb_fixture(Path(temp))
            from motionworks_iec_mcp import graphical_listing as module
            original=module.read_text
            def read_then_change(candidate,root):
                result=original(candidate,root)
                if candidate==dependency:dependency.write_text(text+'\n')
                return result
            with patch.object(module,'read_text',side_effect=read_then_change):
                with self.assertRaisesRegex(ValueError,'set changed'):inspect(project,'Main')

if __name__=='__main__':unittest.main()
