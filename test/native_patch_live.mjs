// Opt-in lifecycle on the named disposable fixture only. Never uses a controller.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexPatchProbe';
const resume=process.env.MW_NATIVE_PATCH_RESUME;
const finish=process.env.MW_NATIVE_PATCH_FINISH;
assert.ok(!(resume&&finish),'Choose one evidence continuation');
if(resume)assert.match(resume,/^native-patch-live-[a-f0-9-]+\.json$/);
if(finish)assert.match(finish,/^native-patch-live-[a-f0-9-]+\.json$/);
const evidence_path=workspace+'/.motionworks/verification/'+(resume??finish??('native-patch-live-'+randomUUID()+'.json'));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const record=resume||finish?JSON.parse(readFileSync(evidence_path,'utf8')):{project,pou,phase:'requested',events:[],accepted:false,controller_downloaded:false};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
async function call(name,args={}){
  const result=await tools.get(name).execute({project,baseline_saved:true,...args});
  record.events.push({name,args,result});retain();
  console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted,
    is_compiled:result.is_compiled,trial_dialog:result.trial_dialog,trial_answered:result.trial_answered,evidence_path:result.evidence_path}));
  if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
  return result;
}
async function compile(){
  for(const name of ['mw_ide_build','mw_ide_make']){
    const result=await call(name);assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);
  }
}
try{
  const trial=await call('mw_ide_trial');
  record.trial_before=trial;
  await call('mw_ide_start');
  const opened=await call('mw_ide_open',{path:project+'.mwt'});assert.equal(opened.matches_request,true);
  const status=await call('mw_ide_compile_state');
  if(finish){
    assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.phase,'stopped');
    const deleted=record.events.findLast(e=>e.name==='mw_ide_pou_change');
    assert.equal(deleted.args.operation,'delete');assert.equal(deleted.result.verification.accepted,true);
    const native=await i.verb('structure_snapshot',{},30000);
    assert.deepEqual(native,deleted.result.expected_native);
    const saved=await i.runCode('structure_snapshot',{project});
    for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(saved[key],record.baseline[key],key);
    record.cleanup_compile_modified=record.error;
    if(status.is_modified){const saved=await call('mw_ide_save');assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);}
    await compile();
    record.after=await i.runCode('structure_snapshot',{project});
    for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.baseline[key],key);
    record.phase='cleaned';record.accepted=true;retain();
    console.log(JSON.stringify({accepted:true,phase:record.phase,evidence_path}));
    process.exitCode=0;
  }else{
  assert.equal(status.is_modified,false);
  const body=Array.from({length:2322},(_,n)=>`(* Exact patch preservation line ${n} *)`).join('\n')+'\nIF FALSE THEN\n    RETURN;\nEND_IF;\n';
  if(resume){
    assert.equal(record.project,project);assert.equal(record.pou,pou);
    assert.equal(record.phase,'stopped');assert.match(record.error,/expected_body\/hash/);
    const completed=record.events.findLast(e=>e.name==='mw_ide_code_change');
    assert.equal(completed?.result.verification.accepted,true);
    assert.ok(completed.result.evidence_path.startsWith(workspace+'\\.motionworks\\verification\\'));
    const saved=JSON.parse(readFileSync(completed.result.evidence_path,'utf8')).saved_result;
    const current=await i.runCode('structure_snapshot',{project});
    for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(current[key],saved[key],key);
    assert.equal((await call('mw_code_read_text',{pou})).body.replace(/\r\n/g,'\n'),body);
    record.original_error=record.error;record.phase='resumed_hash_contract';retain();
  }else{
    record.baseline=await i.runCode('structure_snapshot',{project});
    assert.ok(!record.baseline.pous.some(p=>p.name===pou),'Existing scratch POU: inspect evidence before continuing');
    record.phase='baseline';retain();
    await call('mw_ide_pou_change',{operation:'create',name:pou});
    record.phase='created';retain();
    await call('mw_ide_code_change',{pou,expected_body:'',code:body});
  }
  const inventory=await call('mw_code_pous');
  const target=inventory.pous.find(p=>p.name===pou);assert.match(target.text_body_sha256,/^[a-f0-9]{64}$/);
  const readable=await call('mw_code_read_text',{pou});
  assert.equal(target.text_body_sha256,createHash('sha256').update(readable.body).digest('hex'));
  const changes=[{find:'IF FALSE THEN',replace:'IF TRUE THEN'},{find:'(* Exact patch preservation line 900 *)',replace:'(* Verified exact patch line 900 *)'}];
  await call('mw_ide_code_change',{pou,expected_body_sha256:target.text_body_sha256,changes});
  record.phase='patched';retain();
  const read=await call('mw_code_read_text',{pou});
  assert.equal(read.body.replace(/\r\n/g,'\n'),body.replace(changes[0].find,changes[0].replace).replace(changes[1].find,changes[1].replace));
  await assert.rejects(tools.get('mw_ide_code_change').execute({project,pou,baseline_saved:true,expected_body_sha256:target.text_body_sha256,changes}),/expected_body\/hash/);
  const current=(await call('mw_code_pous')).pous.find(p=>p.name===pou);
  await assert.rejects(tools.get('mw_ide_code_change').execute({project,pou,baseline_saved:true,expected_body_sha256:current.text_body_sha256,changes:[{find:'no such snippet',replace:''}]}),/found 0/);
  assert.equal((await call('mw_code_read_text',{pou})).body,read.body);
  await compile();
  record.phase='compiled';retain();
  await call('mw_ide_code_change',{pou,expected_body:read.body,code:''});
  await call('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
  await compile();
  record.after=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.baseline[key],key);
  record.phase='cleaned';record.accepted=true;retain();
  console.log(JSON.stringify({accepted:true,phase:record.phase,evidence_path}));
  }
}catch(error){record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({phase:record.phase,error:error.message,evidence_path}));throw error;}
finally{await i.stopBridge();}
