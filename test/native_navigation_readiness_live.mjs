import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',records=[];
const tool=i.defineTools().find(t=>t.name==='mw_ide_open_worksheet');
const evidence_path=join(workspace,'.motionworks','verification','native-navigation-readiness-live-'+randomUUID()+'.json');
let before;
try{
 before=await i.runCode('structure_snapshot',{project});assert.equal(before.pous.length,7);
 writeFileSync(evidence_path,JSON.stringify({phase:'baseline',before,records},null,2));
 for(const args of [{pou:'TopCutterCamSetup',kind:'code'},{pou:'TopCutterCamSetup',kind:'variables'},{pou:'ServoTaskSlow',kind:'code'},{kind:'variables'}]){
  const result=await tool.execute({project,...args});records.push({args,result});console.log(JSON.stringify(result));
  writeFileSync(evidence_path,JSON.stringify({phase:'navigation_observed',before,records},null,2));
  assert.equal(result.accepted,true);assert.equal(result.native_navigation_verified,true);
  assert.equal(result.ui_responsive,true);assert.equal(result.editor_caption_matches,true);
  assert.equal(result.editor_settled,true);assert.ok(result.ready_observations>=2);
  assert.equal(result.keyboard_focus_verified,false);assert.equal(result.modified_state_unchanged,true);
  const inspection=await tool.execute({project,...args,inspect_only:true});
  records.push({args:{...args,inspect_only:true},result:inspection});
  assert.equal(inspection.accepted,true);assert.equal(inspection.action_performed,false);
  assert.equal(inspection.method,'native_com_inspection');assert.equal(inspection.keyboard_focus_verified,false);
  // If inspect_only were ignored, this would open another document and pass.
  const wrong=args.pou==='TopCutterCamSetup'?{pou:'ServoTaskSlow',kind:'variables'}:{pou:'TopCutterCamSetup',kind:'variables'};
  const mismatch=await tool.execute({project,...wrong,inspect_only:true});
  records.push({args:{...wrong,inspect_only:true},result:mismatch});
  assert.equal(mismatch.accepted,false);assert.equal(mismatch.action_performed,false);
  assert.equal(mismatch.logical_name,result.logical_name);
 }
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.equal(JSON.stringify(before[key]),JSON.stringify(after[key]),key);
 writeFileSync(evidence_path,JSON.stringify({phase:'accepted',before,records,after},null,2));console.log(JSON.stringify({evidence_path}));
}catch(error){
 writeFileSync(evidence_path,JSON.stringify({phase:'stopped',before,records,error:error.message},null,2));
 throw Error(error.message+'; inspect '+evidence_path);
}finally{await i.stopBridge();}
