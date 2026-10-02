// Opt-in read-only acceptance against the sole disposable open project.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const module=await import(process.env.MW_WRITABLE_PLUGIN_MODULE??'../index.js');
const i=module.__internals,project=workspace+'/.motionworks/stage/TopCutterS5';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const evidence_path=workspace+'/.motionworks/verification/native-writable-bindings-'+randomUUID()+'.json';
const record={project,pou:'TopCutterCamSetup',mutation_performed:false,reviews:[]};
try {
 record.before=await i.runCode('structure_snapshot',{project});
 record.native_before=await i.verb('compile_state',{},30000);
 assert.equal(record.native_before.is_modified,false);
 for(const literal of ['T#100ms',"'not storage'",'REAL#1.25']) {
  const result=(await tools.get('mw_code_check_program').execute({project,pou:record.pou,
   installed_interfaces:true,body:`fbCamSelect(CamTable := ${literal}, Done => ${literal});`})).result;
  const findings=result.findings.filter(f=>['fb-inout-needs-variable','fb-output-needs-variable'].includes(f.code));
  assert.equal(findings.length,2,literal);
  assert.ok(findings.every(f=>f.severity==='error'&&f.reference.source_sha256&&f.reference.library==='PLCopenPlus_v_2_2a'));
  record.reviews.push({literal,result});
 }
 record.valid=(await tools.get('mw_code_check_program').execute({project,pou:record.pou,
  installed_interfaces:true,body:'fbCamSelect(CamTable := CamTable, Done => TopCutterCamReady);'})).result;
 assert.equal(record.valid.errors,0);
 assert.ok(!record.valid.findings.some(f=>f.code==='fb-writable-binding-unresolved'));
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 record.native_after=await i.verb('compile_state',{},30000);
 assert.equal(record.native_after.is_modified,false);
 record.accepted=true;
} catch(e) {record.accepted=false;record.error=String(e);throw e;}
finally {writeFileSync(evidence_path,JSON.stringify(record,null,2));await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,evidence_path}));}
