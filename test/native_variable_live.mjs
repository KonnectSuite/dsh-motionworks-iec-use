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
async function scoped(args){
  const r=await change.execute({project,baseline_saved:true,...args});
  console.log(JSON.stringify({scope:args.pou??'globals',operation:r.operation,accepted:r.verification.accepted,errors:r.verification.errors,count:r.native_result.variables.length}));
  assert.equal(r.verification.accepted,true,JSON.stringify(r.verification));
}
try {
  if(process.argv.includes('--globals-externals')) {
    const global={...declaration,name:'CodexScopeSmoke',section:'VAR_GLOBAL',group:'User Variables'};
    const external={...global,section:'VAR_EXTERNAL',group:'Default',initial_value:null};
    await scoped({operation:'add',declaration:global});
    await scoped({operation:'edit',name:global.name,declaration:{...global,initial_value:'9'}});
    await scoped({operation:'add',pou:'TopCutterCutControl',declaration:external});
    await scoped({operation:'edit',pou:'TopCutterCutControl',name:external.name,declaration:{...external,description:'Edited external smoke'}});
    await scoped({operation:'delete',pou:'TopCutterCutControl',name:external.name,user_approved:true,references_reviewed:true});
    await scoped({operation:'delete',name:global.name,user_approved:true,references_reviewed:true});
  } else {
  await act({operation:'add',declaration});
  await act({operation:'edit',name:declaration.name,declaration:{...declaration,initial_value:'9',description:'Edited native API smoke'}});
  // This unused declaration was created by this test; deletion is explicitly scoped.
  await act({operation:'delete',name:declaration.name,user_approved:true,references_reviewed:true});
  }
} finally {await i.stopBridge();}
