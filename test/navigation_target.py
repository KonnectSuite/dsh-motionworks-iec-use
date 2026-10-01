"""Saved native tree identities, including renamed body sheets and ambiguity."""
import sys, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp.navigation import worksheet_target
from motionworks_iec_mcp.tree import TreeNode

def node(name, path, children=None):
    return TreeNode(0, 0, (0,0,0,0), name, path, 0, children or [])

class Navigation(unittest.TestCase):
    def setUp(self):
        self.variables=node('MainV', 'POE\\Main\\MainV.VGR\tmetadata')
        self.body=node('RenamedBody', 'POE\\Main\\RenamedBody.STB')
        self.pou=node('Main', 'POE\\Main\tmetadata', [self.variables,self.body])
        self.global_node=node('Global_Variables', 'C\\Configuration\\R\\Resource\\Global_Variables.VGR')
        self.roots=[self.pou,self.global_node]
    def resolve(self,kind,pou=None,warnings=None):
        with patch('motionworks_iec_mcp.navigation.CompoundFile'), patch('motionworks_iec_mcp.navigation.parse_tree',return_value=(self.roots,warnings or [])):
            return worksheet_target(SimpleNamespace(root=Path('fixture')),kind,pou)
    def test_variables(self):
        r=self.resolve('variables','main')
        self.assertEqual(r['urn'],'@POUS.Main.MainV')
        self.assertEqual(r['logical_name'],'/Pous/Main/MainV')
    def test_code_uses_actual_child_and_pou_view(self):
        r=self.resolve('code','Main')
        self.assertEqual(r['urn'],'@POUS.Main.RenamedBody')
        self.assertEqual(r['logical_name'],'/Pous/Main')
        self.assertEqual(r['document_logical_name'],'/Pous/Main/RenamedBody')
    def test_globals(self):
        self.assertEqual(self.resolve('variables')['urn'],'@HW.Configuration.Resource.Global_Variables')
    def test_bad_scope_or_missing(self):
        for kind,pou in [('code',None),('variables','Missing'),('other','Main')]:
            with self.assertRaises(ValueError):self.resolve(kind,pou)
    def test_ambiguous(self):
        self.pou.children.append(self.variables)
        with self.assertRaises(ValueError):self.resolve('variables','Main')
    def test_warnings(self):
        with self.assertRaises(ValueError):self.resolve('variables','Main',['Unparsed'])
    def test_unsafe_identity(self):
        self.body.name='Main.Bad'
        with self.assertRaises(ValueError):self.resolve('code','Main')
if __name__=='__main__':unittest.main()
