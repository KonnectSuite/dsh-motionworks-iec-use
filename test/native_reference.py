"""Optional regression against user-supplied native data; edits disposable copies only."""
import json, os, shutil, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code' / 'engine'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'code'))
import mw_code
from motionworks_iec_mcp import transaction, writer, grid, pou_writer, ide
from motionworks_iec_mcp.errors import MotionWorksError
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
        batch = {'project': str(root), 'pou': pou, 'dry_run': False,
                 'variables': [
                     {'name': 'BatchNativeA', 'type': 'BOOL', 'donor': 'xPermit', 'initial_value': 'FALSE'},
                     {'name': 'BatchNativeB', 'type': 'BOOL', 'donor': 'xPermit', 'initial_value': 'TRUE'}]}
        before_batch = transaction.hash_tree(root)
        bad_batch = dict(batch, variables=[batch['variables'][0],
                                           {'name': 'ImpossibleType', 'type': 'NO_SUCH_IEC_TYPE'}])
        try:
            transaction.run(root, lambda: mw_code.verb_var_add_many(bad_batch))
            raise AssertionError('An invalid second item must fail the batch')
        except MotionWorksError:
            pass
        assert transaction.hash_tree(root) == before_batch, 'failed native batch did not fully roll back'
        result = transaction.run(root, lambda: mw_code.verb_var_add_many(batch))
        assert result['applied'] == 2 and result['failed'] == 0, result
        assert validate(root)['ok'], validate(root)
        print('PASS native batch atomic rollback and two-variable commit with verified worksheet grids')
        candidates = [p for p in sorted((root/'POE').iterdir())
                      if p.is_dir() and len(pou_writer._template_guids(p)) == 4]
        assert candidates, 'Fixture needs a supported four-GUID clone donor'
        plan = pou_writer.plan_pou_creation(root, 'RegressionClone', candidates[0].name)
        transaction.run(root, lambda: {'result': pou_writer.apply_pou_creation(plan, backup_dir=ws/'clone-backup')})
        assert validate(root)['ok'], validate(root)
        from motionworks_iec_mcp.project import Project
        donor = next(v.name for v in Project(root).pou('RegressionClone').declarations().variables
                     if v.type_name == 'BOOL' and v.section == 'VAR')
        apply(writer.plan_variable_add(root, 'RegressionClone', 'CloneFlag', 'BOOL', donor=donor, initial_value='FALSE'))
        print('PASS native POU clone, preserved usages, registry/view/tree updates and subsequent declaration addition')
assert transaction.hash_tree(source) == original
print('PASS original supplied data unchanged; no IDE launched')
