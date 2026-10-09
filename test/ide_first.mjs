import assert from 'node:assert/strict';
import {apply, __internals} from '../index.js';
const tools = new Map();
apply({get:()=>undefined,tools:{register:t=>tools.set(t.name,t)},on(){}});
const old = process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES;
delete process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES;
try {
  const names = ['mw_ide_rebuild', ...['write_st','var_add','var_edit','var_delete','var_add_many','pou_create','restore_pou','pou_delete'].map(n=>'mw_code_'+n)];
  for (const flag of [undefined,'1']) {
    if (flag===undefined) delete process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES;
    else process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES=flag;
    const registered = new Map();
    apply({get:()=>undefined,tools:{register:t=>registered.set(t.name,t)},on(){}});
    const catalog = new Set(__internals.defineTools().map(t=>t.name));
    for (const name of names) {
      assert.equal(registered.has(name),false,name);
      assert.equal(catalog.has(name),false,name);
    }
  }
  for (const operation of ['st','il','variables','pou','graphical','tasks','libraries','engineering']) {
    const guide = await tools.get('mw_ide_edit_guide').execute({operation});
    assert.equal(guide.mode,'ide-first');
    assert.equal(guide.action_performed,false);
    assert.ok(guide.steps.length>=5);
    assert.match(guide.steps[0],/Ask before the first backup/);
    assert.match(guide.steps[0],/mw_ide_attach.*backup_approved:true/);
    assert.match(guide.steps[0],/unsaved IDE changes/);
    assert.ok(Array.isArray(tools.get('mw_ide_edit_guide').output.render({},guide)));
  }
  await assert.rejects(tools.get('mw_ide_edit_guide').execute({operation:'download'}),/Unknown/);
  console.log('Nine retired tools absent even with legacy opt-in; eight read-only IDE guides passed');
} finally {
  if (old===undefined) delete process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES;
  else process.env.MOTIONWORKS_ALLOW_OFFLINE_WRITES=old;
}
