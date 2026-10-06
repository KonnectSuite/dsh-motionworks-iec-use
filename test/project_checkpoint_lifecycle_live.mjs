// Authorized disposable empty-POU change detection and cleanup, exact fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexCheckpointProof';
const prior=process.env.MW_CHECKPOINT_RECEIPT;
assert.match(prior??'',/^checkpoint-live-[a-f0-9-]+\.json$/);
const baselineReceipt=JSON.parse(readFileSync(join(workspace,'.motionworks/verification',prior)));
assert.equal(baselineReceipt.accepted,true);
const baseline=JSON.parse(readFileSync(baselineReceipt.capture.baseline_path));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const resume=process.env.MW_CHECKPOINT_RESUME;if(resume)assert.match(resume,/^checkpoint-lifecycle-[a-f0-9-]+\.json$/);
const file=join(workspace,'.motionworks/verification',resume??('checkpoint-lifecycle-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(file)):{accepted:false,cleanup_verified:false,project,pou,baseline_id:baselineReceipt.capture.baseline_id,events:[],controller_action:false};
assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.baseline_id,baselineReceipt.capture.baseline_id);
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
let created=false,deleteAttempted=false;
async function act(name,args={}){const definition=tools.get(name),input={project,...args};if(definition.parameters.properties.baseline_saved)input.baseline_saved=true;const value=await definition.execute(input);record.events.push({name,args,value});retain();return value;}
async function cleanup(){
 const current=await i.runCode('structure_snapshot',{project});
 assert.ok(!current.tasks.some(t=>t.instances.some(x=>x.type===pou)));
 assert.ok(current.pous.filter(p=>p.name!==pou).every(p=>!p.identifiers.includes(pou.toUpperCase())));
 assert.equal(current.pous.find(p=>p.name===pou)?.body_blank,true);
 deleteAttempted=true;const deleted=await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});assert.equal(deleted.verification?.accepted??deleted.accepted,true);
 const build=await act('mw_ide_build');assert.equal(build.fresh_compile,true);assert.equal(build.is_compiled,true);
 assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);await act('mw_ide_errors',{pane:'Warnings'});
 const make=await act('mw_ide_make');assert.equal(make.is_modified,false);assert.equal(make.is_compiled,true);
 const comparison=await act('mw_ide_verify',{mode:'compare_baseline',baseline_id:record.baseline_id});
 assert.equal(comparison.accepted,true,JSON.stringify(comparison));record.cleanup_verified=true;record.cleanup=comparison;retain();
}
try{
 const saved=await i.runCode('structure_snapshot',{project});
 if(resume){
  const priorCreates=record.events.filter(e=>e.name==='mw_ide_pou_change'&&e.args.operation==='create');assert.equal(priorCreates.length,1);assert.equal(priorCreates[0].args.name,pou);assert.equal(priorCreates[0].value.verification.accepted,true);
  assert.equal(record.events.length,1,'Resume only the inspected acknowledged creation, never failed or repeated mutations');
  assert.equal(saved.pous.filter(p=>p.name===pou).length,1);assert.equal(saved.pous.find(p=>p.name===pou).body_blank,true);
  assert.deepEqual(saved.pous.filter(p=>p.name!==pou),baseline.snapshot.saved.pous);
  for(const k of ['tasks','globals'])assert.deepEqual(saved[k],baseline.snapshot.saved[k]);
  for(const k of ['program_sources','translation_files'])assert.deepEqual(Object.fromEntries(Object.entries(saved[k]).filter(([path])=>!path.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/'))),baseline.snapshot.saved[k]);
  record.harness_error_reconciled=record.error;delete record.error;created=true;retain();
 }else{
  for(const k of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(saved[k],baseline.snapshot.saved[k]);
  assert.ok(!saved.pous.some(p=>p.name.toLowerCase()===pou.toLowerCase()));
  const made=await act('mw_ide_pou_change',{operation:'create',name:pou,pou_type:'PROGRAM',language:'ST'});assert.equal(made.verification?.accepted??made.accepted,true);created=true;
 }
 const changed=await act('mw_ide_verify',{mode:'compare_baseline',baseline_id:record.baseline_id});
 assert.equal(changed.accepted,false);assert.equal(changed.verdict,'preservation_changed');
 assert.ok(changed.comparison.changed.includes('saved.pous'));assert.ok(changed.comparison.changed.includes('native_package'));assert.equal(changed.comparison.checks.bound_library_files,true);
 record.changed=changed;retain();await cleanup();record.accepted=true;
}catch(error){record.error=error.message;retain();if(created&&!deleteAttempted)await cleanup();throw error;}
finally{retain();await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,cleanup_verified:record.cleanup_verified,evidence:file}));}
