import sys,tempfile,unittest,struct
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.block_interfaces import parse_parameter_table,sources,inspect,_user_library_declarations
from motionworks_iec_mcp.variables import CompressedStreamError

PT=b'pouKind:\tFUNCTION_BLOCK\r\npouName:\tTimer\r\nparNum:\t2\r\nparameters:\r\n\tVAR_INPUT\tIN\tBOOL\tYES\tNO\r\n\tVAR_OUTPUT\tQ\tBOOL\tYES\tNO\r\n'
class Interfaces(unittest.TestCase):
    def test_named_user_library_worksheet_identity_and_refusals(self):
        declarations=b'VAR_INPUT\nRun : BOOL;\nEND_VAR\nVAR_OUTPUT\nReady : BOOL;\nEND_VAR\n'
        streams={'Variables.VB':declarations,'Variables.VGR':struct.pack('<III',0,0,2),'Variables.VB.sn':b'snapshot-not-declarations'}
        class Container:
            def stream_names(self):return list(streams)
            def read_stream(self,name):return streams[name]
        pou=SimpleNamespace(name='NamedBlock',declaration_stream_name=lambda:None,source=lambda:Container())
        node=SimpleNamespace(path='POE\\NamedBlock\\Variables.VGR\tignored',start_line=0)
        document=SimpleNamespace(warnings=[],lines=['8'],walk_with_ancestors=lambda:[(node,[])])
        class RootContainer:
            def __init__(self,*args):pass
            def read_stream(self,name):return b'fixture-tree'
        with patch('motionworks_iec_mcp.block_interfaces.CompoundFile',RootContainer),patch('motionworks_iec_mcp.block_interfaces.parse_document',return_value=document):
            table=_user_library_declarations('root',pou)
            self.assertEqual(table.source_stream,'Variables.VB');self.assertFalse(table.warnings)
            self.assertEqual([(v.name,v.section) for v in table.variables],[('Run','VAR_INPUT'),('Ready','VAR_OUTPUT')])
            streams['Other.VB']=declarations
            with self.assertRaisesRegex(ValueError,'ambiguous'):_user_library_declarations('root',pou)
            del streams['Other.VB'];node.path='POE/WrongBlock/Variables.VGR'
            with self.assertRaisesRegex(ValueError,'tree identity'):_user_library_declarations('root',pou)
            node.path='POE/NamedBlock/Variables.VGR';document.lines=['23']
            with self.assertRaisesRegex(ValueError,'tree identity'):_user_library_declarations('root',pou)
            document.lines=['8'];streams['Variables.VGR']=struct.pack('<III',0,0,3)
            self.assertTrue(_user_library_declarations('root',pou).warnings)
            streams['Variables.VGR']=b'short'
            with self.assertRaisesRegex(ValueError,'count unavailable'):_user_library_declarations('root',pou)
            streams['Variables.VGR']=struct.pack('<III',0,0,2);streams['Variables.VB']=bytes.fromhex('00000000cadac758')+b'unsupported'
            with self.assertRaises(CompressedStreamError):_user_library_declarations('root',pou)
    def test_declared_parameter_directions_and_bad_tables(self):
        result=parse_parameter_table(PT)
        self.assertEqual([p['direction'] for p in result['pins']],['input','output'])
        self.assertEqual(result['pins'][0]['native_attributes'],['YES','NO'])
        for data in [PT.replace(b'parNum:\t2',b'parNum:\t3'),PT.replace(b'VAR_OUTPUT',b'VAR_GUESS'),PT.replace(b'\tQ\t',b'\tIN\t'),PT.replace(b'FUNCTION_BLOCK',b'GUESS'),PT.replace(b'parNum:\t2',b'parNum:\t-1')]:
            with self.assertRaises(ValueError):parse_parameter_table(data)
    def test_bound_registry_and_alias_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'Project';root.mkdir();library=Path(temp)/'Firmware';library.mkdir()
            (root/'LIST.POU').write_text('PROGRAM\tMain\t\t\tPT=1\tMain\n')
            (root/'@LIBRARY.LST').write_text(f'Library List, V40\nFW;{library};Firmware;3\n')
            (library/'Firmware.POU').write_text('FUNCTION_BLOCK\tTimer\t\t\tPT=1\tTmr\n')
            native=[dict(name='Firmware',full_name=str(library/'Firmware.fwl'))]
            self.assertEqual(sources(root,native)[1]['binding'],'native_reference')
            with self.assertRaises(ValueError):sources(root,[dict(name='Firmware',full_name=str(library/'wrong.fwl'))])
            class Container:
                def __init__(self,*args):pass
                def stream_names(self):return ['Tmr.PT']
                def read_stream(self,name):self.assertion=name;return PT
            with patch('motionworks_iec_mcp.block_interfaces.CompoundFile',Container):
                result=inspect(root,native,'Timer','Firmware')
            self.assertEqual(result['source_stream'],'Tmr.PT')
            self.assertEqual(result['pins'][1]['section'],'VAR_OUTPUT')
            self.assertFalse(result['action_performed'])
            with self.assertRaises(ValueError):inspect(root,native,'Absent')

if __name__=='__main__':unittest.main()
