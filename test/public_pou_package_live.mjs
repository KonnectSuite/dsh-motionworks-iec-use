// Opt-in public package acceptance on the sole disposable smoke fixture.
// Exercises guarded export/import, collision refusal and exact cleanup.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),name='CodexGraphExchange';
const evidence_path=join(workspace,'.motionworks/verification/public-pou-package-live-'+randomUUID()+'.json');
const record={project,name,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(tool,args){const result=await tools.get(tool).execute({project,baseline_saved:true,...args});record.events.push({tool,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
function equalSources(before,after){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(before[key],after[key],key);}
try{
 record.baseline=await i.runCode('structure_snapshot',{project});assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'copy',name:'ServoTaskSlow',new_name:name});
 record.copied=await i.runCode('structure_snapshot',{project});retain();
 const exported=await act('mw_ide_pou_package',{operation:'export',pou:name});record.exported=exported;retain();
 const collision=await tools.get('mw_ide_pou_package').execute({project,baseline_saved:true,operation:'import',package_token:exported.package_token,dependencies_reviewed:true});assert.equal(collision.accepted,false);assert.equal(collision.action_performed,false);record.collision=collision;retain();
 equalSources(record.copied,await i.runCode('structure_snapshot',{project}));
 await act('mw_ide_pou_change',{operation:'delete',name,user_approved:true,references_reviewed:true});
 await act('mw_ide_pou_package',{operation:'import',package_token:exported.package_token,dependencies_reviewed:true});
 record.imported=await i.runCode('structure_snapshot',{project});equalSources(record.copied,record.imported);retain();
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou:name,instance:'CodexExchangeInstance'});
 const listing=await act('mw_ide_graphical_listing',{pou:name,limit:1});assert.equal(listing.network_count,5);
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexExchangeInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name,user_approved:true,references_reviewed:true});
 for(const tool of ['mw_ide_build','mw_ide_make']){const result=await tools.get(tool).execute({});record.events.push({tool,result});retain();assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 record.after=await i.runCode('structure_snapshot',{project});equalSources(record.baseline,record.after);
 record.phase='accepted';retain();console.log(JSON.stringify({accepted:true,evidence_path}));
}catch(error){record.phase='stopped';record.error=error.message;retain();throw error;}
finally{await i.stopBridge();}
