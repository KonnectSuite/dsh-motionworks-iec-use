import sys, unittest, tempfile
from pathlib import Path
from types import SimpleNamespace as S
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.task_bindings import resolve, inspect

class Bindings(unittest.TestCase):
    def document(self, resource='Resource'):
        children=[S(name='DifferentInstance',line=0,children=[]),S(name='Second',line=3,children=[])]
        task=S(name='FastTsk',path=f'C\\Configuration\\R\\{resource}\\FastTsk\t\t\tCYCLIC',children=children)
        return S(warnings=[],lines=['params','DifferentInstance','ProgramType','params','Second','Other'],walk_with_ancestors=lambda:[(task,[])]),task
    def test_exact_program_type_order_and_resources(self):
        document,task=self.document()
        result=resolve(document,['ProgramType','Other'])
        self.assertEqual(result[0]['instances'],[{'name':'DifferentInstance','type':'ProgramType','order':1},{'name':'Second','type':'Other','order':2}])
        second,other=self.document('Resource2')
        document.walk_with_ancestors=lambda:[(task,[]),(other,[])]
        self.assertEqual(len(resolve(document,['ProgramType','Other'])),2)
    def test_warning_duplicate_or_unknown_cannot_be_exact(self):
        for change in ['warning','unknown','duplicate','kind']:
            document,task=self.document()
            if change=='warning':document.warnings=['bad count']
            if change=='unknown':document.lines[2]='Missing'
            if change=='duplicate':task.children[1].name='DifferentInstance'
            if change=='kind':task.path=task.path.replace('CYCLIC','GUESS')
            with self.assertRaises(ValueError):resolve(document,['ProgramType','Other'])
    def test_settings_join_hashes_and_changed_source_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'src.st1').write_bytes(b'container')
            (root/'LIST.POU').write_text('PROGRAM\tProgramType\nPROGRAM\tOther\nPROGRAM\tUnassigned\n')
            resource=root/'C/Configuration/R/Resource';resource.mkdir(parents=True)
            settings=resource/'FastTsk.SET';settings.write_text('TASK FastTsk\n(TYPE := CYCLIC,\nINTERVAL := T#4ms,\nPRIORITY := 0,\nWATCHDOG_ENABLED := YES\n);')
            document,_=self.document()
            with patch('motionworks_iec_mcp.task_bindings.CompoundFile') as container,patch('motionworks_iec_mcp.task_bindings.parse_document',return_value=document):
                container.return_value.read_stream.return_value=b'tree'
                result=inspect(root)
            self.assertEqual(result['unassigned'],['Unassigned'])
            self.assertEqual(result['bindings'][0]['settings']['INTERVAL'],'T#4ms')
            self.assertEqual(len(result['source_hashes']),3)
            def mutate(*args):
                (root/'LIST.POU').write_text('PROGRAM\tChanged\n');return document
            with patch('motionworks_iec_mcp.task_bindings.CompoundFile') as container,patch('motionworks_iec_mcp.task_bindings.parse_document',side_effect=mutate):
                container.return_value.read_stream.return_value=b'tree'
                with self.assertRaisesRegex(ValueError,'changed during read'):inspect(root)
if __name__=='__main__':unittest.main()
