import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.st_comments import resolve_comments

class Comments(unittest.TestCase):
    def test_native_comment_resolution_and_missing_references(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'MainTranslation.xml'
            path.write_text('<TranslationDocument><ItemList><item id="1"><translation xml:lang="undefined"> A &amp; B\nnext </translation></item></ItemList></TranslationDocument>',encoding='utf-16')
            self.assertEqual(resolve_comments('(*\x071,1\x07*)',path),'(* A & B\nnext *)')
            for body in ['(*\x071,2\x07*)','(*\x072,1\x07*)','\x07unknown']:
                with self.assertRaises(ValueError):resolve_comments(body,path)
            self.assertEqual(resolve_comments('RETURN;',Path('absent')),'RETURN;')

if __name__=='__main__':unittest.main()
