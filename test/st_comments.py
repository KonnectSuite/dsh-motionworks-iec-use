import sys,tempfile,unittest,hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'))
from motionworks_iec_mcp.st_comments import resolve_comments
import mw_code

class Comments(unittest.TestCase):
    def test_native_comment_resolution_and_missing_references(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'MainTranslation.xml'
            path.write_text('<TranslationDocument><ItemList><item id="1"><translation xml:lang="undefined"> A &amp; B\nnext </translation></item></ItemList></TranslationDocument>',encoding='utf-16')
            self.assertEqual(resolve_comments('(*\x071,1\x07*)',path),'(* A & B\nnext *)')
            for body in ['(*\x071,2\x07*)','(*\x072,1\x07*)','\x07unknown']:
                with self.assertRaises(ValueError):resolve_comments(body,path)
            self.assertEqual(resolve_comments('RETURN;',Path('absent')),'RETURN;')

    def test_inventory_hashes_exact_readable_st_and_il_including_comment_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'MainTranslation.xml'
            raw='(*\x071,1\x07*)\r\nRETURN;\r\n'
            for language in ['ST','IL']:
                def readable():return resolve_comments(raw,path)
                info=SimpleNamespace(name='Main',language=lambda:language,
                    body_stream=lambda:('Main.STB' if language=='ST' else 'Main.AB',language),
                    st_body=lambda:raw if language=='ST' else None,
                    source=lambda:SimpleNamespace(read_stream=lambda _:raw.encode('latin1')),
                    text_body_text=readable,st_body_text=readable,
                    declarations=lambda:SimpleNamespace(variables=[]))
                project=SimpleNamespace(pous=lambda:[info],pou=lambda _:info)
                hashes=[]
                for comment in ['Original comment','Changed comment']:
                    path.write_text(f'<TranslationDocument><ItemList><item id="1"><translation xml:lang="undefined">{comment}</translation></item></ItemList></TranslationDocument>',encoding='utf-16')
                    with patch.object(mw_code,'_project',return_value=project):
                        entry=mw_code.verb_pous({'project':'fixture'})['pous'][0]
                        body=mw_code.verb_read_st({'project':'fixture','pou':'Main'},text=True)['body']
                    self.assertEqual(entry['text_body_sha256'],hashlib.sha256(body.encode('utf-8')).hexdigest())
                    hashes.append(entry)
                self.assertEqual(hashes[0]['body_sha256'],hashes[1]['body_sha256'])
                self.assertNotEqual(hashes[0]['text_body_sha256'],hashes[1]['text_body_sha256'])
                path.unlink()
                with patch.object(mw_code,'_project',return_value=project):
                    entry=mw_code.verb_pous({'project':'fixture'})['pous'][0]
                self.assertNotIn('text_body_sha256',entry)
                self.assertIn('text_body_error',entry)

if __name__=='__main__':unittest.main()
