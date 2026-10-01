import sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.block_interfaces import parse_parameter_table,sources,inspect

PT=b'pouKind:\tFUNCTION_BLOCK\r\npouName:\tTimer\r\nparNum:\t2\r\nparameters:\r\n\tVAR_INPUT\tIN\tBOOL\tYES\tNO\r\n\tVAR_OUTPUT\tQ\tBOOL\tYES\tNO\r\n'
class Interfaces(unittest.TestCase):
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
