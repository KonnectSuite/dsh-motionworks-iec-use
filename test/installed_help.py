import hashlib,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp import installed_help as H

class Help(unittest.TestCase):
    def test_html_is_inert_and_retains_shortcut_structure(self):
        result=H.parse_html(b'<html><head><title>Inline insert</title><script>do_not_execute()</script><style>hidden_css</style></head><body><h1>Insert</h1><p>Press &lt;F2&gt; or &lt;Tab&gt;.</p><table><tr><td>Ctrl</td><td>Connect</td></tr></table><img src="keys.gif" alt="Arrow keys"><object>hidden_object</object></body></html>')
        self.assertEqual(result['title'],'Inline insert')
        self.assertIn('Press <F2> or <Tab>.',result['text'])
        self.assertIn('Ctrl | Connect',result['text'])
        self.assertIn('keys.gif',result['image_references'])
        for hidden in ['do_not_execute','hidden_css','hidden_object']:self.assertNotIn(hidden,result['text'])

    def test_bound_catalog_query_cache_and_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'IDE';(root/'Help').mkdir(parents=True)
            archive=root/'Help'/'GraphEd001.chm';archive.write_bytes(b'installed-v1')
            cache=Path(directory)/'cache'
            pages=[dict(topic='inline.htm',title='Inserting blocks',text='Use F2 to insert blocks.\nPress Tab as an alternative.',image_references=[],topic_sha256='a'*64)]
            with patch.object(H,'IDE_ROOTS',[root]),patch.object(H,'cache_root',lambda:cache),patch.object(H,'decompile',return_value=pages) as extraction:
                self.assertEqual(H.search()['modules'][0]['module'],'GraphEd001')
                with self.assertRaises(ValueError):H.search(query='F2')
                with self.assertRaises(ValueError):H.search('../outside')
                result=H.search('GraphEd001','F2')
                self.assertEqual(result['results'][0]['topic'],'inline.htm')
                self.assertEqual(result['archive_sha256'],hashlib.sha256(b'installed-v1').hexdigest())
                self.assertFalse(result['action_performed'])
                self.assertIn('F2',H.search('GraphEd001',topic='inline.htm')['results'][0]['excerpt'])
                self.assertEqual(extraction.call_count,1)
                with self.assertRaises(ValueError):H.search('GraphEd001',topic='../outside.htm')
                with self.assertRaises(ValueError):H.search('GraphEd001',topic='missing.htm')
                entry=next((cache/'installed-help').glob('*.json'));record=json.loads(entry.read_text());record['pages'][0]['text']='tampered';entry.write_text(json.dumps(record))
                with self.assertRaisesRegex(ValueError,'integrity'):H.search('GraphEd001','F2')
                archive.write_bytes(b'installed-v2');self.assertTrue(H.search('GraphEd001','F2')['results'])
                self.assertEqual(extraction.call_count,2)

if __name__=='__main__':unittest.main()
