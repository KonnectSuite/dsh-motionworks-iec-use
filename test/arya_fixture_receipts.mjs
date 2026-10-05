// Opt-in read-only acceptance of the actual Arya chat's native tool receipts.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const log=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(log.session,'d637dc30-4a0d-470d-8c45-f88c710d2be0');
assert.equal(log.catalogCount,62);assert.equal(log.groupTool,true);assert.equal(log.lastRecord,'turn/end');
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='AryaSupportProbe',instance='AryaSupportInstance';
const calls=log.records.filter(r=>r.type==='tool/call').map(r=>({...r,args:JSON.parse(r.args)}));
const results=new Map(log.records.filter(r=>r.type==='tool/result').map(r=>[r.callId,r]));
const readErrors=[];
for(const call of calls){
 const result=results.get(call.callId);assert.ok(result,call.name+' pending');
 if(result.error){
  assert.ok(call.name==='mw_ide_task_model'&&result.text==='Error: unknown tool "mw_ide_task_model"'||call.name==='mw_code_validate'&&/outside the staging root/.test(result.text),call.name+': '+result.text);
  readErrors.push({seq:call.seq,name:call.name,error:result.text});
 }
}
const edits=new Set(['mw_ide_pou_change','mw_ide_variable_change','mw_ide_variable_group_change','mw_ide_fb_insert','mw_ide_task_change']);
const receipts=[];
for(const call of calls.filter(c=>edits.has(c.name))){
 assert.equal(resolve(call.args.project).toLowerCase(),project.toLowerCase());assert.equal(call.args.baseline_saved,true);
 if(call.name==='mw_ide_pou_change')assert.equal(call.args.name,pou);
 else if(call.name==='mw_ide_task_change'){assert.equal(call.args.name,'BG');assert.equal(call.args.instance,instance);if(call.args.operation==='assign')assert.equal(call.args.pou,pou);}
 else assert.equal(call.args.pou,pou);
 const result=JSON.parse(results.get(call.callId).text);assert.equal(result.verification?.accepted??result.accepted,true,call.name);
 if(result.evidence_path){
  const rel=relative(join(workspace,'.motionworks/verification'),resolve(result.evidence_path));assert.ok(rel&&!rel.startsWith('..')&&!rel.includes(':'));
  const raw=readFileSync(result.evidence_path);const retained=JSON.parse(raw);
  if(call.name==='mw_ide_fb_insert'){
   assert.equal(retained.phase,'verified');assert.deepEqual(retained.completed_phases,['instance_declared','call_inserted']);
   assert.equal(retained.code_result.verification.accepted,true);
   assert.equal(retained.code_result.body,'Delay(IN := Run, PT := T#50ms);\r\nReady := Delay.Q;\r\nElapsed := Delay.ET;\r\n');
  }
  receipts.push({tool:call.name,operation:call.args.operation,seq:call.seq,file:rel,sha256:createHash('sha256').update(raw).digest('hex')});
 }
}
const one=(name,predicate)=>{const matches=calls.filter(c=>c.name===name&&predicate(c.args));assert.equal(matches.length,1,name);return matches[0];};
const created=one('mw_ide_pou_change',a=>a.operation==='create');
one('mw_ide_variable_group_change',a=>a.operation==='create'&&a.name==='Probe');
const renamed=one('mw_ide_variable_group_change',a=>a.operation==='rename'&&a.name==='Probe'&&a.new_name==='Support');
const renameResult=JSON.parse(results.get(renamed.callId).text);assert.equal(renameResult.member_count,3);
const inserted=one('mw_ide_fb_insert',a=>a.block==='TON'&&a.library==='IEC'&&a.instance==='Delay');
assert.deepEqual(inserted.args.bindings,{IN:'Run',PT:'T#50ms',Q:'Ready',ET:'Elapsed'});
for(const [name,type] of [['Run','BOOL'],['Ready','BOOL'],['Elapsed','TIME']])one('mw_ide_variable_change',a=>a.operation==='add'&&a.declaration.name===name&&a.declaration.type===type&&a.declaration.group==='Probe');
const assigned=one('mw_ide_task_change',a=>a.operation==='assign');
const unassigned=one('mw_ide_task_change',a=>a.operation==='unassign'&&a.user_approved===true);
const deleted=one('mw_ide_pou_change',a=>a.operation==='delete'&&a.user_approved===true&&a.references_reviewed===true);
assert.ok(created.seq<inserted.seq&&inserted.seq<assigned.seq&&assigned.seq<unassigned.seq&&unassigned.seq<deleted.seq);
const builds=calls.filter(c=>c.name==='mw_ide_build');
assert.ok(builds.some(c=>c.seq>assigned.seq&&c.seq<unassigned.seq));assert.ok(builds.some(c=>c.seq>deleted.seq));
for(const build of builds)assert.match(results.get(build.callId).text,/compiled \(is_compiled=true/);
assert.ok(calls.some(c=>c.name==='mw_ide_make'&&c.seq>deleted.seq));
const make=calls.find(c=>c.name==='mw_ide_make'&&c.seq>deleted.seq);assert.match(results.get(make.callId).text,/already up to date|compiled \(is_compiled=true/);
const model=calls.find(c=>c.name==='mw_code_task_model'&&c.seq>deleted.seq);assert.ok(model,'Correct task-model follow-up required');assert.equal(results.get(model.callId).error,false);
const errors=calls.filter(c=>c.name==='mw_ide_errors'&&(c.args.pane??'Errors')==='Errors');assert.ok(errors.length>=2);
for(const call of errors)assert.match(results.get(call.callId).text,/0 (?:error|row|message)|empty|no (?:error|row|message)/i);
assert.ok(!calls.some(c=>['mw_code_sync_back','mw_ide_stage','mw_ide_open','mw_ide_close'].includes(c.name)));
const file=join(workspace,'.motionworks/verification/arya-engineering-receipts.json');
writeFileSync(file,JSON.stringify({session:log.session,accepted:true,unassisted_request_complete:false,followup_required:true,nonmutating_tool_errors:readErrors,controller_downloaded:false,scope:'assigned IEC TON ST lifecycle and local group rename, with assisted Make/task-model follow-up',receipts},null,2));
console.log(JSON.stringify({accepted:true,receipts:receipts.length,evidence:file}));
