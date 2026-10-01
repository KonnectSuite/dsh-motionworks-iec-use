import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexGuardedCode';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args){
  const result=await tools.get(name).execute({project,baseline_saved:true,...args});
  console.log(JSON.stringify({tool:name,verification:result.verification,evidence_path:result.evidence_path,body:result.body}));
  assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
  return result;
}
try{
  await act('mw_ide_pou_change',{operation:'create',name:pou});
  const code='(* Native guarded code & comment verification *)\nIF FALSE THEN\n    RETURN;\nEND_IF;\n';
  await act('mw_ide_code_change',{pou,expected_body:'',code});
  const sourcesBeforeCompile=await i.runCode('structure_snapshot',{project});
  const compilation=[];
  for(const name of ['mw_ide_build','mw_ide_make']){
    const result=await tools.get(name).execute({});
    compilation.push({tool:name,result});
    console.log(JSON.stringify({tool:name,is_compiled:result.is_compiled,is_modified:result.is_modified,evidence_kind:result.evidence_kind,elapsed_s:result.elapsed_s}));
    assert.equal(result.is_compiled,true);
    assert.equal(result.is_modified,false);
    if(name==='mw_ide_build')assert.equal(result.evidence_kind,'observed_compile_transition');
  }
  const sourcesAfterCompile=await i.runCode('structure_snapshot',{project});
  assert.deepEqual(sourcesAfterCompile.program_sources,sourcesBeforeCompile.program_sources);
  assert.deepEqual(sourcesAfterCompile.translation_files,sourcesBeforeCompile.translation_files);
  const compilationEvidence=join(workspace,'.motionworks','verification','native-code-live-build-'+randomUUID()+'.json');
  writeFileSync(compilationEvidence,JSON.stringify({project,pou,compilation,sourcesBeforeCompile,sourcesAfterCompile},null,2));
  console.log(JSON.stringify({compilationEvidence}));
  const old=await i.runCode('read_st',{project,pou});
  await assert.rejects(tools.get('mw_ide_code_change').execute({project,pou,baseline_saved:true,expected_body:'stale',code:'RETURN;'}),/expected_body/);
  await act('mw_ide_code_change',{pou,expected_body:old.body,code:'(* Cleared test body *)\n'});
  const current=await i.runCode('read_st',{project,pou});
  await act('mw_ide_code_change',{pou,expected_body:current.body,code:''});
  await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
}finally{await i.stopBridge();}
