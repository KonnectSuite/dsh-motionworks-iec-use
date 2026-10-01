import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const tools=new Map(i.defineTools().map(t=>[t.name,t])),records=[];
const normalized=text=>text.replace(/\r\n?/g,'\n');
async function act(name,args){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 records.push({name,args,result});console.log(JSON.stringify({name,verification:result.verification,evidence_path:result.evidence_path}));
 assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));return result;
}
try{
 const original=await i.runCode('structure_snapshot',{project});
 assert.ok(!original.pous.some(p=>/^CodexPop/i.test(p.name)),'Inspect any prior probe before another mutation');
 const source=await i.runCode('read_st',{project,pou:'TopCutterCamSetup'});
 assert.ok(source.body.length>4000&&source.variables.length>0,'Requires the known populated disposable fixture');
 await act('mw_ide_pou_change',{operation:'copy',name:'TopCutterCamSetup',new_name:'CodexPopCopy'});
 const copied=await i.runCode('read_st',{project,pou:'CodexPopCopy'});
 assert.equal(copied.body,source.body);assert.deepEqual(copied.variables,source.variables);
 assert.ok(copied.variables.some(v=>v.name==='iState'&&v.type==='INT'));
 const code=copied.body+'\r\n(* Disposable populated POU verification. *)\r\niState := INT#0;\r\n';
 await act('mw_ide_code_change',{pou:'CodexPopCopy',expected_body:copied.body,code});
 await act('mw_ide_pou_change',{operation:'rename',name:'CodexPopCopy',new_name:'CodexPopEdit',references_reviewed:true});
 const renamed=await i.runCode('read_st',{project,pou:'CodexPopEdit'});
 assert.equal(normalized(renamed.body),normalized(code));assert.deepEqual(renamed.variables,source.variables);
 const beforeCompile=await i.runCode('structure_snapshot',{project});
 for(const name of ['mw_ide_build','mw_ide_make']){
  const result=await tools.get(name).execute({});records.push({name,result});
  console.log(JSON.stringify({name,is_compiled:result.is_compiled,is_modified:result.is_modified,evidence_kind:result.evidence_kind,elapsed_s:result.elapsed_s}));
  assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);
  if(name==='mw_ide_build')assert.equal(result.evidence_kind,'observed_compile_transition');
 }
 const afterCompile=await i.runCode('structure_snapshot',{project});
 assert.deepEqual(beforeCompile.program_sources,afterCompile.program_sources);
 assert.deepEqual(beforeCompile.translation_files,afterCompile.translation_files);
 await act('mw_ide_pou_change',{operation:'delete',name:'CodexPopEdit',user_approved:true,references_reviewed:true});
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(original[key],after[key],key);
 const evidence_path=join(workspace,'.motionworks','verification','native-populated-live-'+randomUUID()+'.json');
 writeFileSync(evidence_path,JSON.stringify({project,original,records,beforeCompile,afterCompile,after},null,2));
 console.log(JSON.stringify({evidence_path}));
}finally{await i.stopBridge();}
