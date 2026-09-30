"""Optional regression against user-supplied native data; edits disposable copies only."""
import json, os, shutil, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
from motionworks_iec_mcp import transaction, writer, grid, pou_writer, ide
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.validation import validate
source = Path(sys.argv[1]).resolve()
original = transaction.hash_tree(source)
with tempfile.TemporaryDirectory(prefix='mw-native-') as temp:
    ws = Path(temp)
    root = ws / '.motionworks' / 'stage' / 'Test'
    shutil.copytree(source, root)
    (root.parent / 'Test.identity.json').write_text(json.dumps({
        'workspace': str(ws), 'source': str(ws/'Original.mwt'),
        'source_directory': str(ws/'Original'), 'staged_directory': str(root),
        'staged_mwt': str(root)+'.mwt'}))
    with patch.dict(os.environ, {'MOTIONWORKS_MCP_WORKSPACE': str(ws), 'MOTIONWORKS_MCP_STAGE': str(root.parent)}), patch.object(transaction, 'ensure_ide_closed'), patch.object(ide, 'ensure_ide_closed'):
        assert validate(root)['ok'], validate(root)
        pou = 'TopCutterCutControl'
        def apply(plan):
            return transaction.run(root, lambda: {'result': writer.apply_declaration(plan, root)})
        apply(writer.plan_variable_add(root, pou, 'RegressionFlag', 'BOOL', donor='xPermit', initial_value='FALSE', description='Regression & native description'))
        apply(writer.plan_variable_edit(root, pou, 'RegressionFlag', new_name='RegressionFlagRenamed', initial_value='TRUE', description='Changed native description'))
        apply(writer.plan_variable_delete(root, pou, 'RegressionFlagRenamed'))
        print('PASS native add/edit/delete, translation sidecars, grid trailers, sibling read-back and transaction verification')
        plan = pou_writer.plan_pou_creation(root, 'RegressionClone', pou)
        transaction.run(root, lambda: {'result': pou_writer.apply_pou_creation(plan, backup_dir=ws/'clone-backup')})
        assert validate(root)['ok'], validate(root)
        apply(writer.plan_variable_add(root, 'RegressionClone', 'CloneFlag', 'BOOL', donor='xPermit', initial_value='FALSE'))
        print('PASS native POU clone, preserved usages, registry/view/tree updates and subsequent declaration addition')
assert transaction.hash_tree(source) == original
print('PASS original supplied data unchanged; no IDE launched')
