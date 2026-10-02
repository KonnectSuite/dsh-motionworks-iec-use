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
        self.assertTrue(body_is_blank('IL',b'',''))
        self.assertFalse(body_is_blank('IL',b'RET','RET'))
    def test_il_requires_exact_ab_tree_identity_and_preserves_st_reader_scope(self):
        pou=PouInfo('Main',Path('fixture/POE/Main'))
        document=S(warnings=[],lines=['9'],walk_with_ancestors=lambda:[(S(start_line=0,path='POE\\Main\\Renamed.AB'),[])])
        with patch.object(PouInfo,'stream_names',return_value=['Renamed.AB']),patch('motionworks_iec_mcp.project.CompoundFile'),patch('motionworks_iec_mcp.tree.parse_document',return_value=document):
            self.assertEqual(pou.body_stream(),('Renamed.AB','IL'))
            self.assertIsNone(pou.st_body_text())
            document.lines=['11']
            with self.assertRaisesRegex(ValueError,'IL worksheet'):pou.body_stream()
        with patch.object(PouInfo,'stream_names',return_value=['Renamed.AB','Main.STB']):
            with self.assertRaisesRegex(ValueError,'ambiguous'):pou.body_stream()
    def test_il_override_cannot_be_reported_as_st_reviewed(self):
        from motionworks_iec_mcp.program_checks import check_project
        table=S(warnings=[],variables=[])
        pou=S(name='Probe',language=lambda:'IL',declarations=lambda:table)
        project=S(pous=lambda:[pou],pou=lambda name:pou,global_variables=lambda:table,task_assignments=lambda:{})
        with patch('motionworks_iec_mcp.project.Project',return_value=project):
            result=check_project(Path('fixture'),pou='Probe',body='LD TRUE')
        self.assertIn({'pou':'Probe','language':'IL','status':'IL_static_review_not_supported'},result['coverage'])
        self.assertFalse(any(c.get('status')=='ST_reviewed' for c in result['coverage']))
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
