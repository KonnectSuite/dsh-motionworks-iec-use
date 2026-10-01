// Opt-in only: mutations are confined to the existing disposable IDE fixture.
import assert from 'node:assert/strict';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const change=tools.get('mw_ide_variable_change');
const declaration={name:'CodexGuardedSmoke',type:'INT',section:'VAR',group:'Default',address:null,initial_value:'7',description:'Guarded native API smoke'};
async function act(args){
  const r=await change.execute({project,pou:'TopCutterCutControl',baseline_saved:true,...args});
  console.log(JSON.stringify({operation:r.operation,accepted:r.verification.accepted,errors:r.verification.errors,method:r.native_result.method,count:r.native_result.variables.length}));
  assert.equal(r.verification.accepted,true,JSON.stringify(r.verification));
}
try {
  await act({operation:'add',declaration});
  await act({operation:'edit',name:declaration.name,declaration:{...declaration,initial_value:'9',description:'Edited native API smoke'}});
  // This unused declaration was created by this test; deletion is explicitly scoped.
  await act({operation:'delete',name:declaration.name,user_approved:true,references_reviewed:true});
} finally {await i.stopBridge();}
