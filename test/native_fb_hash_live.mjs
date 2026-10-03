// Opt-in native IEC + Yaskawa toolbox insertion on the disposable fixture only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexFbHash',instance='CodexFbHashInstance';
const resume=process.env.MW_FB_HASH_RESUME;
const cleanupOnly=process.env.MW_FB_HASH_CLEANUP==='1';
if(cleanupOnly)assert.ok(resume,'Cleanup requires retained evidence');
if(resume)assert.match(resume,/^native-fb-hash-[a-f0-9-]+\.json$/);
const evidence_path=join(workspace,'.motionworks/verification',resume??('native-fb-hash-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(evidence_path,'utf8')):{project,pou,phase:'requested',events:[],accepted:false,controller_downloaded:false};
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
async function act(name,args={}){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});retain();
 console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted,call:result.call,evidence_path:result.evidence_path}));
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 return result;
}
async function digest(){return (await act('mw_code_pous')).pous.find(p=>p.name===pou).text_body_sha256;}
async function targetEvidence(started){
 record.compiler_source=await i.runCode('compiled_source_evidence',{project,pou});
 assert.equal(record.compiler_source.pou,pou);assert.equal(record.compiler_source.artifacts.length,4);
 assert.ok(record.compiler_source.artifacts.every(a=>a.modified_ms>=started&&a.modified_ms<=Date.now()));retain();
}
async function compile(proveTarget=false){
 const before=await i.runCode('structure_snapshot',{project}),started=Date.now();
 for(const name of ['mw_ide_build','mw_ide_make']){
  const result=await act(name);
  assert.equal(result.is_compiled,true);
  const status=await act('mw_ide_compile_state');assert.equal(status.is_modified,false);
  if(name==='mw_ide_build')assert.equal(result.evidence_kind,'observed_compile_transition');
 }
 const errors=await act('mw_ide_errors',{pane:'Errors'});assert.equal(errors.count,0);
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(after[key],before[key],key);
 if(proveTarget)await targetEvidence(started);
}
try{
 let compiledResume=false;
 if(resume){
  assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.phase,'stopped');
  const lastBuild=record.events.findLast(e=>e.name==='mw_ide_build');
  compiledResume=record.error==='ValueError: Exact graphical POU required';
  if(compiledResume){
   assert.equal(lastBuild.result.evidence_kind,'observed_compile_transition');
   assert.equal(lastBuild.result.is_compiled,true);assert.equal(lastBuild.result.settled,true);
   const make=record.events.findLast(e=>e.name==='mw_ide_make');assert.equal(make.result.is_compiled,true);assert.equal(make.result.is_modified,false);
  }else assert.equal(lastBuild.result.evidence_kind,'completion_unverified');
  const permitted=new Set(['mw_ide_build','mw_code_read_text','mw_ide_state','mw_ide_compile_state','mw_ide_save',...(compiledResume?['mw_ide_make']:[])]);
  assert.ok(record.events.slice(record.events.indexOf(lastBuild)+1).every(e=>permitted.has(e.name)),'Unexpected action since unverified Build');
  const task=record.events.findLast(e=>e.name==='mw_ide_task_change');assert.equal(task.args.operation,'assign');
  assert.equal(task.result.verification.accepted,true);
  const receipt=JSON.parse(readFileSync(task.result.evidence_path,'utf8'));
  const current=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(current[key],receipt.saved_result[key],key);
  assert.deepEqual(await i.verb('structure_snapshot',{},30000),task.result.expected_native);
  const fb=record.events.findLast(e=>e.name==='mw_ide_fb_insert');
  const fbReceipt=JSON.parse(readFileSync(fb.result.evidence_path,'utf8'));
  assert.equal((await act('mw_code_read_text',{pou})).body,fbReceipt.code_result.body);
  const state=await act('mw_ide_state');assert.equal(state.blocked,false);assert.equal(state.ide_enabled,true);
  record.original_error=record.error;record.resumed_saved_baseline=current;
  const status=await act('mw_ide_compile_state');
  if(compiledResume){assert.equal(status.is_compiled,true);assert.equal(status.is_modified,false);await targetEvidence(statSync(task.result.evidence_path).mtimeMs);}
  if(status.is_modified){
   const native=await i.verb('variable_snapshot',{pou},30000);
   const saved=await act('mw_ide_save');assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);
   const after=await i.runCode('structure_snapshot',{project});
   for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(after[key],current[key],key);
   assert.deepEqual(await i.verb('variable_snapshot',{pou},30000),native);
  }
  record.phase='compile_reconciled';retain();
 }else{
 assert.equal((await act('mw_ide_compile_state')).is_modified,false);
 record.baseline=await i.runCode('structure_snapshot',{project});
 assert.ok(!record.baseline.pous.some(p=>p.name===pou),'Existing scratch POU: inspect retained evidence');retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou});
 for(const [name,type] of [['TimerQ','BOOL'],['TimerET','TIME'],['Accum','TIME'],['RetQ','BOOL']])
  await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
 const body=Array.from({length:2322},(_,n)=>`(* Preserved toolbox test comment ${n} *)`).join('\n')+'\n(* FB insertion anchor *)\n';
 await act('mw_ide_code_change',{pou,expected_body:'',code:body});
 const before=(await act('mw_code_read_text',{pou})).body;
 const firstHash=await digest();
 await assert.rejects(tools.get('mw_ide_fb_insert').execute({project,pou,baseline_saved:true,block:'TON',library:'IEC',instance:'MustNotExist',expected_body_sha256:'0'.repeat(64),bindings:{IN:'FALSE'},before:'(* FB insertion anchor *)'}),/readable hash/);
 assert.equal((await act('mw_code_read_text',{pou})).variables.length,4);
 const timer=await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'BasicTimer',expected_body_sha256:firstHash,before:'(* FB insertion anchor *)',bindings:{IN:'FALSE',PT:'T#100ms',Q:'TimerQ',ET:'TimerET'}});
 assert.equal(timer.text_body_sha256,await digest());
 const retentive=await act('mw_ide_fb_insert',{pou,block:'TON_Retentive',library:'Yaskawa_Toolbox_v375',instance:'RetentiveTimer',expected_body_sha256:timer.text_body_sha256,before:'(* FB insertion anchor *)',bindings:{Accum:'Accum',Enable:'FALSE',Preset:'T#100ms',Reset:'TRUE',Q:'RetQ'}});
 assert.equal(retentive.text_body_sha256,await digest());
 const after=(await act('mw_code_read_text',{pou})).body;
 assert.equal(after,before.replace('(* FB insertion anchor *)',timer.call+retentive.call+'(* FB insertion anchor *)'));
 record.phase='inserted';retain();
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
 }
 if(!cleanupOnly){if(!compiledResume)await compile(true);record.phase='compiled';retain();}
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance,user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 if(!cleanupOnly)await compile();
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.baseline[key],key);
 record.phase=cleanupOnly?'cleaned_compile_unverified':'cleaned';record.accepted=!cleanupOnly;retain();console.log(JSON.stringify({phase:record.phase,accepted:record.accepted,evidence_path}));
}catch(error){record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({error:error.message,evidence_path}));throw error;}
finally{await i.stopBridge();}
