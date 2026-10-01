import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const tools=new Map(i.defineTools().map(t=>[t.name,t])),records=[];
async function act(args){
 const result=await tools.get('mw_ide_pou_change').execute({project,baseline_saved:true,...args});
 records.push({args,result});console.log(JSON.stringify({args,verification:result.verification,evidence_path:result.evidence_path}));
 assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));return result;
}
try{
 const original=await i.runCode('structure_snapshot',{project});
 assert.equal(original.pous.length,7);
 assert.ok(!original.pous.some(p=>/^CodexGraph/i.test(p.name)),'Inspect any previous probe before mutation');
 for(const language of ['FBD','LD']){
  for(const [suffix,pou_type,return_type] of [['Program','PROGRAM',undefined],['FB','FUNCTION_BLOCK',undefined],['Function','FUNCTION','INT']]){
   const name='CodexGraph'+language+suffix;
   const created=await act({operation:'create',name,language,pou_type,return_type});
   const saved=(await i.runCode('structure_snapshot',{project})).pous.find(p=>p.name===name);
   assert.equal(saved.language,language);assert.equal(saved.body_blank,true);assert.deepEqual(saved.variables,[]);
   // The compiler requires a VAR_INPUT interface for FUNCTIONs, even unused
   // ones. Creation deliberately starts blank; add the test signature natively.
   if(pou_type==='FUNCTION'){
    const declaration={name:'InputValue',type:'INT',section:'VAR_INPUT',group:'Default',address:null,initial_value:null,description:null};
    const result=await tools.get('mw_ide_variable_change').execute({project,pou:name,baseline_saved:true,operation:'add',declaration});
    records.push({name:'mw_ide_variable_change',pou:name,result});assert.equal(result.verification.accepted,true);
   }
  }
 }
 const beforeCompile=await i.runCode('structure_snapshot',{project});
 for(const name of ['mw_ide_build','mw_ide_make']){
  const result=await tools.get(name).execute({});records.push({name,result});
  console.log(JSON.stringify({name,is_compiled:result.is_compiled,is_modified:result.is_modified,evidence_kind:result.evidence_kind,elapsed_s:result.elapsed_s}));
  assert.equal(result.is_compiled,true);
  if(result.is_modified){
   const saved=await i.verb('save',{},30000);records.push({name:'post_compile_save',result:saved});
   assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);assert.equal(saved.is_compiled,true);
  }else assert.equal(result.is_modified,false);
  if(name==='mw_ide_build')assert.equal(result.evidence_kind,'observed_compile_transition');
 }
 const afterCompile=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(beforeCompile[key],afterCompile[key],key);
 for(const name of original.pous.map(p=>p.name))assert.ok(afterCompile.pous.some(p=>p.name===name));
 for(const name of afterCompile.pous.filter(p=>/^CodexGraph/.test(p.name)).map(p=>p.name))await act({operation:'delete',name,user_approved:true,references_reviewed:true});
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(original[key],after[key],key);
 const evidence_path=join(workspace,'.motionworks','verification','native-graph-creation-live-'+randomUUID()+'.json');
 writeFileSync(evidence_path,JSON.stringify({project,original,records,beforeCompile,afterCompile,after},null,2));console.log(JSON.stringify({evidence_path}));
}finally{await i.stopBridge();}
