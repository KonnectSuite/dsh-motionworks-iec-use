import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.graphical_listing import inspect, networks, symbols

CODE='(*\nT: PROGRAM Main\nCI#: 1\n*)\n\t@NETWORK_BEGIN\n@BPV 1 4 0\tLD\t@IV 1\n@BPV 1 5 0\tST\t@RV 2\n\t@NETWORK_END\n'
DIT='(*\nT: PROGRAM Main\n*)\nInput\t1\tVAR\t@TYP:1\n@IV 1\n\nOutput\t2\tVAR_EXTERNAL\t@TYP:1\n@RV 2\n'
class Listing(unittest.TestCase):
    def test_networks_annotations_unknowns_and_truncation(self):
        parsed=networks(CODE,symbols(DIT))
        self.assertEqual(parsed[0]['lines'][0]['symbols'][0]['declaration']['name'],'Input')
        self.assertFalse(networks(CODE.replace('@IV 1','@IV 9'),symbols(DIT))[0]['lines'][0]['symbols'][0]['resolved'])
        for bad in [CODE.replace('@NETWORK_END',''),CODE.replace('@NETWORK_BEGIN',''),CODE.replace('@NETWORK_BEGIN','@NETWORK_BEGIN\n@NETWORK_BEGIN')]:
            with self.assertRaises(ValueError):networks(bad,{})
    def fixture(self, root):
        directory=root/'C'/'Configuration'/'R'/'Resource';directory.mkdir(parents=True)
        path=directory/'ICI00001.CIC';path.write_text(CODE)
        path.with_suffix('.DIT').write_text(DIT)
        path.with_suffix('.DIW').write_text('00001\t00002\tPOE\\Main\\MainV.vb\n00002\t00000\tPOE\\Main\\Main.gb\n')
        path.with_suffix('.SP').write_text(str(root/'POE'/'Main'/'Main.gb')+'\t4\t1\t4\t1\t0000\n')
        class Pou:
            name='Main'
            def body_stream(self):return ('Main.GB','LD')
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

if __name__=='__main__':unittest.main()
