import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',tools=new Map(i.defineTools().map(t=>[t.name,t]));
const records=[],evidence_path=workspace+'/.motionworks/verification/native-graph-listing-fbd-live.json';
let baseline;
try{
 baseline=await i.runCode('structure_snapshot',{project});assert.equal(baseline.pous.length,7);
 const created=await tools.get('mw_ide_pou_change').execute({project,baseline_saved:true,operation:'create',name:'CodexListingFBD',language:'FBD',pou_type:'PROGRAM'});
 records.push({created});assert.equal(created.verification.accepted,true);
 const assigned=await tools.get('mw_ide_task_change').execute({project,baseline_saved:true,operation:'assign',name:'BG',pou:'CodexListingFBD',instance:'CodexListingInstance'});
 records.push({assigned});assert.equal(assigned.verification.accepted,true);
 const listing=await tools.get('mw_ide_graphical_listing').execute({project,pou:'CodexListingFBD',baseline_saved:true});records.push({listing});
 writeFileSync(evidence_path,JSON.stringify({phase:'listing_observed',baseline,records},null,2));
 assert.equal(listing.accepted,true,JSON.stringify(listing));assert.equal(listing.network_count,0);assert.equal(listing.language,'FBD');
 const unassigned=await tools.get('mw_ide_task_change').execute({project,baseline_saved:true,operation:'unassign',name:'BG',instance:'CodexListingInstance',user_approved:true});
 records.push({unassigned});assert.equal(unassigned.verification.accepted,true);
 const cleanup=await tools.get('mw_ide_pou_change').execute({project,baseline_saved:true,operation:'delete',name:'CodexListingFBD',user_approved:true,references_reviewed:true});
 records.push({cleanup});assert.equal(cleanup.verification.accepted,true);
 for(const name of ['mw_ide_build','mw_ide_make']){const result=await tools.get(name).execute({});records.push({name,result});assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(baseline[key],after[key],key);
 writeFileSync(evidence_path,JSON.stringify({phase:'accepted',baseline,records,after},null,2));console.log(JSON.stringify({evidence_path,accepted:true,language:listing.language,network_count:listing.network_count}));
}catch(error){writeFileSync(evidence_path,JSON.stringify({phase:'stopped',baseline,records,error:error.message},null,2));throw error;}
finally{await i.stopBridge();}
