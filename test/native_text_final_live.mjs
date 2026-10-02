import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const baseline=JSON.parse(readFileSync(workspace+'/.motionworks/verification/native-il-before.json','utf8'));
const record={project,baseline,compilation:[]};
try {
 const tools=new Map(i.defineTools().map(t=>[t.name,t]));
 for(const name of ['mw_ide_build','mw_ide_make']){
  const result=await tools.get(name).execute({});record.compilation.push({name,result});
  assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);
 }
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(baseline[key],record.after[key],key);
 record.accepted=true;
 writeFileSync(workspace+'/.motionworks/verification/native-text-final-live.json',JSON.stringify(record,null,2));
 console.log(JSON.stringify({accepted:true,pous:record.after.pous.length,original_sources_restored:true}));
}finally{await i.stopBridge();}
