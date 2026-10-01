import sys, unittest
from pathlib import Path
from types import SimpleNamespace as S
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.structure import snapshot
class Reader(unittest.TestCase):
    def test_function_return_type_comes_from_tree_not_blank_registry_column(self):
        parent=S(name='Fn',path='POE\\Fn\t\t',line=1,children=[])
        document=S(warnings=[],lines=['24','params','Fn','POE\\Fn','INT'],walk_with_ancestors=lambda:[(parent,[])])
        table=S(warnings=[],variables=[])
        pou=S(name='Fn',directory=S(iterdir=lambda:[]),declarations=lambda:table,body_stream=lambda:('Fn.STB','ST'),st_body=lambda:'')
        project=S(list_pou_lines=lambda:['FUNCTION\tFn\t\t\tPT=1'],pous=lambda:[pou],global_variables=lambda:table)
        with patch('motionworks_iec_mcp.structure.Project',return_value=project),patch('motionworks_iec_mcp.structure.CompoundFile'),patch('motionworks_iec_mcp.structure.parse_document',return_value=document),patch('motionworks_iec_mcp.structure.read_tasks',return_value=[]),patch('motionworks_iec_mcp.structure.source_manifest',return_value={'streams':{},'files':{}}):
            result=snapshot(Path('fixture'))
        self.assertEqual(result['pous'][0]['return_type'],'INT')
        self.assertTrue(result['pous'][0]['body_blank'])
if __name__=='__main__':unittest.main()
