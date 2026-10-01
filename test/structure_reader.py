import sys, unittest
from pathlib import Path
from types import SimpleNamespace as S
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.structure import snapshot, body_is_blank
from motionworks_iec_mcp.project import PouInfo
class Reader(unittest.TestCase):
    def test_graphical_language_uses_exact_saved_node(self):
        pou=PouInfo('Main',Path('fixture/POE/Main'))
        for record_kind, expected in [('11','LD'),('12','FBD'),('99','GRAPHICAL')]:
            document=S(warnings=[],lines=[record_kind],walk_with_ancestors=lambda:[(S(node_id=60,start_line=0,path='POE\\Main\\Renamed.GB'),[])])
            with patch.object(PouInfo,'stream_names',return_value=['Renamed.GB']),patch('motionworks_iec_mcp.project.CompoundFile'),patch('motionworks_iec_mcp.tree.parse_document',return_value=document):
                self.assertEqual(pou.body_stream(),('Renamed.GB',expected))
        document=S(warnings=[],walk_with_ancestors=lambda:[])
        with patch.object(PouInfo,'stream_names',return_value=['Renamed.GB']),patch('motionworks_iec_mcp.project.CompoundFile'),patch('motionworks_iec_mcp.tree.parse_document',return_value=document):
            with self.assertRaisesRegex(ValueError,'identity'):pou.body_stream()
    def test_unknown_or_populated_graph_body_is_not_blank(self):
        for language in ['LD','FBD','GRAPHICAL']:
            for raw in [b'',b'\0'*292,b'\0'*291,b'[BIN]\r\n[TET] populated']:
                self.assertFalse(body_is_blank(language,raw))
        self.assertTrue(body_is_blank('ST',b' \r\n',' \r\n'))
        self.assertFalse(body_is_blank('ST',b'X := 1;','X := 1;'))
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
