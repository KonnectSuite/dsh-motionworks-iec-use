// Opt-in fresh visible startup on the sole disposable fixture; no automatic retry.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),dir=join(workspace,'.motionworks/verification');
const file=join(dir,'startup-trial-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false,phase:'requested'};
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
try{
 const cleaned=JSON.parse(readFileSync(join(dir,'comm-graph-92b2b405-c83a-464d-94a5-897f23d9801d.json'),'utf8'));
 assert.equal(cleaned.accepted,true);assert.equal(cleaned.cleanup_verified,true);
 record.before=await i.runCode('structure_snapshot',{project});
 const same=(a,b)=>{for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);};
 same(record.before,cleaned.after);
 record.closed_state=await i.verb('ide_state',{},45000);
 assert.equal(record.closed_state.ide_running,false);assert.equal(record.closed_state.verifier_running,false);
 record.phase='fresh_start_requested';retain();
 record.start=await tools.get('mw_ide_start').execute({project});retain();
 assert.equal(record.start.already_running,false);assert.ok(record.start.ide_window);
 if(record.start.trial_dialog){assert.equal(record.start.trial_answered,true);assert.ok(['uia_invoke','posted_bm_click'].includes(record.start.trial_method));}
 record.trial_popup_verified=record.start.trial_dialog===true;
 record.ready_state=await i.verb('ide_state',{},45000);retain();
 assert.equal(record.ready_state.ide_running,true);assert.equal(record.ready_state.blocked,false);assert.equal(record.ready_state.ide_enabled,true);
 record.status=await i.verb('status',{},30000);
 assert.equal(resolve(record.status.active_project).toLowerCase(),resolve(project+'.mwt').toLowerCase());
 record.build=await tools.get('mw_ide_build').execute({project});retain();assert.equal(record.build.fresh_compile,true);assert.equal(record.build.is_compiled,true);
 record.make=await tools.get('mw_ide_make').execute({project});retain();assert.equal(record.make.is_compiled,true);assert.equal(record.make.is_modified,false);
 record.native=await i.verb('pou_package_snapshot',{},180000);
 const reference=JSON.parse(readFileSync(join(dir,'sdk-variable-flags-cleanup.json'),'utf8'));
 assert.deepEqual(record.native,reference.native);
 record.after=await i.runCode('structure_snapshot',{project});same(record.before,record.after);
 record.phase='fresh_start_verified';record.accepted=true;retain();
}catch(error){record.error=String(error);retain();throw error;}
finally{await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,trial_popup_verified:record.trial_popup_verified??false,evidence_path:file}));}
