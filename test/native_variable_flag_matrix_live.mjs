// Opt-in native flag combinations and local/global/external/string scope proof.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexFlagMatrix';
const resume=process.env.MW_FLAG_MATRIX_RESUME;
if(resume)assert.match(resume,/^native-variable-flag-matrix-[a-f0-9-]+\.json$/);
const evidence_path=workspace+'/.motionworks/verification/'+(resume??('native-variable-flag-matrix-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(evidence_path,'utf8')):{project,pou,cursor:0,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const fields=['retain','pdd','opc','disabled','not_on_plc','redundant'];
const off=Object.fromEntries(fields.map(f=>[f,false])),on=Object.fromEntries(fields.map(f=>[f,true]));
const base={type:'INT',section:'VAR',group:'Default',address:null,initial_value:'7',description:'Flag matrix proof'};
const local={...base,name:'LocalFlags'},text={...base,name:'TextFlags',type:'STRING',initial_value:"'{PDD}'"};
const global={...base,name:'CodexFlagMatrixG',section:'VAR_GLOBAL',group:'User Variables'};
const external={...global,section:'VAR_EXTERNAL',group:'Default',initial_value:null};
const steps=[{tool:'mw_ide_pou_change',args:{operation:'create',name:pou,language:'ST'}}];
for(const [scope,decl] of [[{pou},local],[{pou},text],[{},global],[{pou},external]]) {
 steps.push({tool:'mw_ide_variable_change',args:{...scope,operation:'add',declaration:decl}});
 // Publish/PLC metadata and the disabled wrapper are tested together, with a
 // complete native read-back. Globals/externals also test each flag separately.
 const variants=[on,off];
 if(decl===global||decl===external)for(const field of fields)variants.push({...off,[field]:true},off);
 for(const flags of variants)steps.push({tool:'mw_ide_variable_change',args:{...scope,operation:'edit',name:decl.name,declaration:decl,flags}});
}
steps.push({tool:'mw_ide_variable_change',args:{pou,operation:'delete',name:global.name,user_approved:true,references_reviewed:true}},
 {tool:'mw_ide_variable_change',args:{operation:'delete',name:global.name,user_approved:true,references_reviewed:true}},
 {tool:'mw_ide_pou_change',args:{operation:'delete',name:pou,user_approved:true,references_reviewed:true}},
 {tool:'mw_ide_build',args:{}},{tool:'mw_ide_make',args:{}});
async function verifyFlags(step,result) {
 if(step.tool!=='mw_ide_variable_change'||!step.args.flags)return;
 const native=await i.verb('variable_snapshot',step.args.pou?{pou:step.args.pou}:{},30000);
 assert.deepEqual(native.variables,result.native_result.variables);
 const target=native.variables.find(v=>v.name===step.args.name);
 for(const field of fields)assert.equal(target[field],step.args.flags[field]);
 record.events.push({tool:'independent_native_snapshot',scope:step.args.pou??'globals',target});retain();
}
try {
 if(resume) {
  assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.phase,'stopped');
  const step=steps[record.cursor],last=record.events.at(-1);
  assert.equal(step.tool,'mw_ide_variable_change');assert.equal(last.tool,step.tool);assert.deepEqual(last.args,step.args);
  assert.equal(last.result.native_result.saved,true);assert.equal(last.result.native_result.is_modified,false);
  const native=await i.verb('variable_snapshot',step.args.pou?{pou:step.args.pou}:{},30000);
  assert.deepEqual(native.variables,last.result.native_result.variables);
  const saved=await i.runCode(step.args.pou?'read_st':'globals',{project,...(step.args.pou?{pou:step.args.pou}:{})});
  assert.equal(i.compareVariables(last.result.expected_variables,saved.variables).accepted,true);
  assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
  await verifyFlags(step,last.result);record.cursor++;record.phase='resumed_exact_receipt';retain();
 } else {
  record.before=await i.runCode('structure_snapshot',{project});
  assert.equal(record.before.pous.length,7);retain();
 }
 while(record.cursor<steps.length) {
  const step=steps[record.cursor];
  const result=await tools.get(step.tool).execute({project,baseline_saved:true,...step.args});
  record.events.push({...step,result});retain();
  assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));
  if(step.tool==='mw_ide_build'||step.tool==='mw_ide_make')assert.equal(result.is_compiled,true);
  await verifyFlags(step,result);record.cursor++;retain();
 }
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
 record.phase='cleaned';record.accepted=true;retain();
} catch(e){record.phase='stopped';record.error=String(e);retain();throw e;}
finally {await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted??false,evidence_path}));}
