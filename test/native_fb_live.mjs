import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexFbProof';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const records=[];
async function act(name,args){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 records.push({name,args,result});
 console.log(JSON.stringify({tool:name,verification:result.verification,evidence_path:result.evidence_path,call:result.call}));
 assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));return result;
}
try{
 const original=await i.runCode('structure_snapshot',{project});
 await act('mw_ide_pou_change',{operation:'create',name:pou});
 for(const [name,type] of [['TimerQ','BOOL'],['TimerET','TIME'],['Accum','TIME'],['RetQ','BOOL']])
  await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
 await assert.rejects(tools.get('mw_ide_fb_insert').execute({project,pou,baseline_saved:true,expected_body:'',block:'TON',library:'IEC',instance:'MustNotExist',bindings:{Q:'Accum'}}),/type mismatch/);
 assert.equal((await i.runCode('read_st',{project,pou})).variables.length,4);
 await act('mw_ide_fb_insert',{pou,expected_body:'',block:'TON',library:'IEC',instance:'BasicTimer',bindings:{IN:'FALSE',PT:'T#100ms',Q:'TimerQ',ET:'TimerET'}});
 const body=(await i.runCode('read_st',{project,pou})).body;
 await act('mw_ide_fb_insert',{pou,expected_body:body,block:'TON_Retentive',library:'Yaskawa_Toolbox_v375',instance:'RetentiveTimer',bindings:{Accum:'Accum',Enable:'FALSE',Preset:'T#100ms',Reset:'TRUE',Q:'RetQ'}});
 const beforeCompile=await i.runCode('structure_snapshot',{project});
 for(const name of ['mw_ide_build','mw_ide_make']){
  const result=await tools.get(name).execute({});records.push({name,result});
  console.log(JSON.stringify({tool:name,accepted:result.accepted,is_compiled:result.is_compiled,is_modified:result.is_modified,evidence_kind:result.evidence_kind,elapsed_s:result.elapsed_s}));
  assert.equal(result.accepted,true);assert.equal(result.is_compiled,true);
  if(result.is_modified){
   const saved=await i.verb('save',{},30000);records.push({name:'post_compile_save',result:saved});
   assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);assert.equal(saved.is_compiled,true);
   const afterSave=await i.runCode('structure_snapshot',{project});
   assert.deepEqual(beforeCompile.program_sources,afterSave.program_sources);
   assert.deepEqual(beforeCompile.translation_files,afterSave.translation_files);
  }else assert.equal(result.is_modified,false);
  if(name==='mw_ide_build')assert.equal(result.evidence_kind,'observed_compile_transition');
 }
 const afterCompile=await i.runCode('structure_snapshot',{project});
 assert.deepEqual(beforeCompile.program_sources,afterCompile.program_sources);
 assert.deepEqual(beforeCompile.translation_files,afterCompile.translation_files);
 const path=join(workspace,'.motionworks','verification','native-fb-live-'+randomUUID()+'.json');
 writeFileSync(path,JSON.stringify({project,pou,records,original,beforeCompile,afterCompile},null,2));console.log(JSON.stringify({evidence_path:path}));
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 const after=await i.runCode('structure_snapshot',{project});
 assert.deepEqual(original.program_sources,after.program_sources);
 assert.deepEqual(original.translation_files,after.translation_files);
 assert.deepEqual(original.pous,after.pous);assert.deepEqual(original.tasks,after.tasks);assert.deepEqual(original.globals,after.globals);
}finally{await i.stopBridge();}
