// Opt-in refusal test on the one explicitly authorized disposable fixture.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),wrapper=project+'.mwt';
const file=join(workspace,'.motionworks/verification/stage-open-guard-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false};
const call=(name,args={})=>i.defineTools().find(t=>t.name===name).execute(args);
const snapshot=()=>{
 const files=[];
 const visit=path=>{if(statSync(path).isDirectory())for(const name of readdirSync(path).sort())visit(join(path,name));else files.push({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});};
 for(const path of [project,wrapper,project+'.identity.json'])visit(path);
 return files;
};
try{
 record.before_state=await i.verb('ide_state',{},45000);
 const observeExisting=process.argv[2]==='observe-existing';
 if(record.before_state.ide_running&&!observeExisting)throw Error('Fixture startup requires no current IDE; never replace a field session');
 if(!record.before_state.ide_running){
  if(observeExisting)throw Error('Observed startup handle disappeared; do not relaunch');
  record.start=await call('mw_ide_start',{project});
  if(record.start.foreign_project)throw Error('Another project restored during startup; leave it open');
 }else record.observed_existing_fixture=true;
 let status=await i.verb('status',{},30000);
 if(!status.is_project_open){if(observeExisting)throw Error('Existing IDE has no confirmed fixture project; leave it untouched');await call('mw_ide_open',{path:wrapper});}
 status=await i.verb('status',{},30000);
 assert.equal(resolve(status.active_project).toLowerCase(),resolve(wrapper).toLowerCase());
 record.before=snapshot();
 await assert.rejects(call('mw_ide_stage',{source:join(workspace,'TopCutterS5.mwt'),replace_existing:true}),error=>{record.refusal=error.message;return /staged project is open in the IDE/.test(error.message);});
 record.after=snapshot();assert.deepEqual(record.after,record.before);
 record.accepted=true;console.log(JSON.stringify({accepted:true,evidence:file,files_preserved:record.before.length,trial_answered:record.start?.trial_answered}));
}catch(e){record.error=e.message;throw e;}finally{writeFileSync(file,JSON.stringify(record,null,2));await i.stopBridge();}
