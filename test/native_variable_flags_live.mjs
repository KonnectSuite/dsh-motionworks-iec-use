// Opt-in: test explicit flag edits only in the sole disposable IDE fixture.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexFlagProbe';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const resume=process.env.MW_VARIABLE_FLAGS_RESUME;
if(resume)assert.match(resume,/^native-variable-flags-[a-f0-9-]+\.json$/);
const evidence_path=workspace+'/.motionworks/verification/'+(resume??('native-variable-flags-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(evidence_path,'utf8')):{project,pou,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const saved=()=>i.runCode('structure_snapshot',{project});
const declaration={name:'Flagged',type:'INT',section:'VAR',group:'Default',address:null,initial_value:'7',description:'Native flag probe'};
const fields=['retain','pdd','opc','disabled','not_on_plc','redundant'];
async function act(name,args={}) {
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});retain();
 assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));
 return result;
}
try {
 let start=0;
 if(resume) {
  assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.phase,'stopped');
  const knownReaderStop=/reading 'variables'/.test(record.error);
  const lastFlags=record.events.at(-1)?.args.flags??{};
  const lastField=Object.keys(lastFlags)[0];
  const knownAttributeStop=['pdd','opc','disabled','not_on_plc','redundant'].includes(lastField)&&lastFlags[lastField]===true;
  assert.ok(knownReaderStop||knownAttributeStop,'Only retained known harness/parser stops can resume');
  const last=record.events.at(-1);
  assert.equal(last.name,'mw_ide_variable_change');assert.equal(last.args.operation,'edit');
  assert.deepEqual(last.args.flags,knownReaderStop?{retain:true}:{[lastField]:true});
  if(knownReaderStop)assert.equal(last.result.verification.accepted,true);
  assert.deepEqual((await i.verb('variable_snapshot',{pou},30000)).variables,last.result.native_result.variables);
  assert.equal((await i.runCode('read_text',{project,pou})).body,'');
  const declarations=await i.runCode('read_st',{project,pou});
  assert.equal(i.compareVariables(last.result.expected_variables,declarations.variables).accepted,true);
  assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
  record.phase='resumed_after_exact_native_receipt';retain();start=knownReaderStop?1:fields.indexOf(lastField)*2+1;
 } else {
 record.before=await saved();assert.equal(record.before.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
 await act('mw_ide_variable_change',{pou,operation:'add',declaration:{...declaration,name:'Anchor'}});
 await act('mw_ide_variable_change',{pou,operation:'add',declaration,flags:{retain:true}});
 // Initial add exercises Retain=true; restore it, then test each setter both ways.
 await act('mw_ide_variable_change',{pou,operation:'edit',name:declaration.name,declaration,flags:{retain:false}});
 }
 const toggles=fields.flatMap(field=>[true,false].map(value=>({field,value})));
 for(let n=start;n<toggles.length;n++) {
  const {field,value}=toggles[n];
  await act('mw_ide_variable_change',{pou,operation:'edit',name:declaration.name,declaration,flags:{[field]:value}});
  const read=await tools.get('mw_ide_variables').execute({pou});
  const rows=read.pous.find(x=>x.pou===pou).variables;
  const target=rows.find(x=>x.name===declaration.name),anchor=rows.find(x=>x.name==='Anchor');
  assert.ok(target&&anchor);
  for(const flag of fields){assert.equal(target[flag],flag===field?value:false);assert.equal(anchor[flag],false);}
  record.events.push({name:'independent_native_read',field,value,rows});retain();
 }
 for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
 record.after=await saved();
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
 record.phase='cleaned';record.accepted=true;retain();
} catch(e){record.phase='stopped';record.error=String(e);retain();throw e;}
finally {await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted??false,evidence_path}));}
