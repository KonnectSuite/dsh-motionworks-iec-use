import assert from 'node:assert/strict';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(scope,args){
  const result=await tools.get(`mw_ide_${scope}_change`).execute({project,baseline_saved:true,...args});
  console.log(JSON.stringify({scope,operation:args.operation,accepted:result.verification.accepted,errors:result.verification.errors,
    native_matches_plan:result.native_result.native_matches_plan,pou_count:result.native_result.snapshot.pous.length,task_count:result.native_result.snapshot.tasks.length}));
  assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
}
try {
  if(process.argv.includes('--types')||process.argv.includes('--function')){
    for(const [name,pou_type,return_type] of [['CodexGuardedFB','FUNCTION_BLOCK',undefined],['CodexGuardedFunction','FUNCTION','INT']].filter(row=>!process.argv.includes('--function')||row[1]==='FUNCTION')){
      await act('pou',{operation:'create',name,pou_type,return_type});
      await act('pou',{operation:'delete',name,user_approved:true,references_reviewed:true});
    }
  }else if(process.argv.includes('--tasks')){
    await act('task',{operation:'create',name:'CxGuard'});
    await act('task',{operation:'edit',name:'CxGuard',settings_changes:{INTERVAL:'T#20ms',PRIORITY:'5'}});
    await act('task',{operation:'assign',name:'CxGuard',pou:'TopCutterFFCamSetup',instance:'CodexNamedInstance'});
    await act('task',{operation:'unassign',name:'CxGuard',instance:'CodexNamedInstance',user_approved:true});
    await act('task',{operation:'delete',name:'CxGuard',user_approved:true});
  }else{
    await act('pou',{operation:'create',name:'CodexGuardedPou'});
    await act('pou',{operation:'rename',name:'CodexGuardedPou',new_name:'CodexGuardedRenamed',references_reviewed:true});
    await act('pou',{operation:'copy',name:'CodexGuardedRenamed',new_name:'CodexGuardedCopy'});
    await act('pou',{operation:'delete',name:'CodexGuardedCopy',references_reviewed:true,user_approved:true});
    await act('pou',{operation:'delete',name:'CodexGuardedRenamed',references_reviewed:true,user_approved:true});
  }
}finally{await i.stopBridge();}
