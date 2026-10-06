// Opt-in: review an invalid proposed protected-block call without writing it.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','compiled-review-invalid-'+randomUUID()+'.json');
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const record={project,accepted:false,source_edit_performed:false,controller_action:false};
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
try{
 const finish=process.env.MOTIONWORKS_REVIEW_FINISH;
 if(finish){
  assert.match(finish,/^compiled-review-invalid-[a-f0-9-]+\.json$/);
  const previous=JSON.parse(readFileSync(join(workspace,'.motionworks/verification',finish)));
  assert.equal(previous.accepted,false);assert.equal(previous.phase,'invalid_call_detected');
  assert.equal(previous.comparison.error,'Baseline integrity or workspace/project binding differs');
  record.before=previous.before;record.review=previous.review;record.contract=previous.contract;
  record.proposed_body=previous.proposed_body;record.resumed_from=finish;record.prior_refusal=previous.comparison;
  record.after=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files']){
   assert.deepEqual(record.after[key],previous.after[key],key);assert.deepEqual(record.after[key],record.before[key],key);
  }
  record.phase='checkpoint_only_reconciled';retain();
 }else{
 record.before=await i.runCode('structure_snapshot',{project});
 const resume=process.env.MOTIONWORKS_REVIEW_RESUME;
 if(resume){
  assert.match(resume,/^compiled-review-invalid-[a-f0-9-]+\.json$/);
  const previous=JSON.parse(readFileSync(join(workspace,'.motionworks/verification',resume)));
  assert.equal(previous.accepted,false);assert.equal(previous.phase,'review_requested');
  assert.match(previous.error,/compiler dependency\/type table not regenerated/);
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],previous.before[key],key);
  record.prior_failure=resume;record.failure_sources_reconciled=true;
 }
 record.initial_state=await i.verb('compile_state',{},30000);
 assert.equal(record.initial_state.is_modified,false);assert.equal(record.initial_state.is_compiled,true);
 const target=record.before.pous.find(p=>p.name==='TopCutterCamSetup');
 assert.ok(target.variables.some(v=>v.name==='fbCamGen'&&v.type==='CamGenerator'));
 record.proposed_body='fbCamGen(Execute := FALSE, TableSize := FALSE, UnknownPin := TRUE, Done := FALSE, CamData := UDINT#0, CamTable := UDINT#0);';
 record.phase='review_requested';retain();
 record.review=await tools.get('mw_code_check_program').execute({project,pou:'TopCutterCamSetup',body:record.proposed_body,
  installed_interfaces:true,refresh_compiler:true,baseline_saved:true,interface_libraries:{CamGenerator:'Cam_Toolbox_v375'}});
 const report=record.review.result;
 assert.equal(report.verification,'static_review_only');assert.equal(report.interface_resolution,'bound_compiled_requested');
 record.contract=report.installed_interfaces.find(c=>c.type==='CamGenerator');
 assert.equal(record.contract.status,'fresh_bound_compiled_contract');
 assert.equal(record.contract.citation.protected_source_decoded,false);
 assert.equal(record.contract.citation.compiler_cache_freshness_verified,false);
 for(const code of ['unknown-fb-parameter','fb-parameter-direction','fb-parameter-type','fb-inout-needs-variable','fb-output-needs-variable']){
  const findings=report.findings.filter(f=>f.code===code);assert.ok(findings.length,code);
  assert.ok(findings.every(f=>f.severity==='error'&&f.reference.library==='Cam_Toolbox_v375'&&f.reference.compile_acceptance_only===true),code);
 }
 record.phase='invalid_call_detected';retain();
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 }
 record.comparison=await tools.get('mw_ide_verify').execute({project,mode:'compare_baseline',baseline_saved:true,
  baseline_id:'3dde62fa-1761-4a24-a88b-88d56add5266.3c724d7c906674684098ad735de3dec9f60be4f066ba96e10a8a9a5751cde3f1'});
 assert.equal(record.comparison.accepted,true);assert.equal(Object.keys(record.comparison.comparison.checks).length,7);
 assert.ok(Object.values(record.comparison.comparison.checks).every(x=>x===true));
 record.state=await i.verb('compile_state',{},30000);assert.equal(record.state.is_modified,false);assert.equal(record.state.is_compiled,true);
 record.phase='verified';record.accepted=true;
}catch(error){record.error=error.message;throw error;}
finally{retain();await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,evidence:file,phase:record.phase,errors:record.review?.result?.errors}));}
