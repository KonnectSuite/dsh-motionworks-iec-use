// Read-only before/after verification for the explicitly authorized Arya test.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification/arya-engineering-lifecycle.json');
const mode=process.argv[2];assert.ok(['baseline','check','audit'].includes(mode));
try{
 const state=await i.verb('compile_state',{},30000);assert.equal(state.is_modified,false);
 const saved=await i.runCode('structure_snapshot',{project});
 const native=await i.verb('structure_snapshot',{},180000);
 if(mode==='baseline'){
  assert.equal(saved.pous.length,7);assert.equal(saved.globals.length,164);
  const prior=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/ld-branch-df0f0799-47e8-4b87-b07f-437bbe83dd7d.json'),'utf8'));
  assert.equal(prior.accepted,true);assert.equal(prior.cleanup_verified,true);
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(saved[key],prior.after[key],key);
  writeFileSync(file,JSON.stringify({project,phase:'baseline',saved,native,state},null,2));
 }else{
  const baseline=JSON.parse(readFileSync(file,'utf8'));assert.equal(baseline.project,project);assert.ok(baseline.phase==='baseline'||mode==='check'&&baseline.phase==='cleaned');
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(saved[key],baseline.saved[key],key);
  assert.deepEqual(native,baseline.native);assert.equal(state.is_compiled,true);
  if(mode==='audit')writeFileSync(file,JSON.stringify({...baseline,phase:'cleaned',after:{saved,native,state},cleanup_verified:true},null,2));
 }
 console.log(JSON.stringify({mode,verified:true,evidence:file,pous:saved.pous.length,globals:saved.globals.length}));
}finally{await i.stopBridge();}
