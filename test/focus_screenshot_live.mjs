// Read-only capture and source-preservation proof on the sole authorized fixture.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const stem=join(workspace,'.motionworks/verification/focus-capture-'+randomUUID());
const record={project,accepted:false,controller_downloaded:false};
try{
 const status=await i.verb('status',{},30000);
 assert.equal(resolve(status.active_project).toLowerCase(),resolve(project+'.mwt').toLowerCase());
 record.before=await i.runCode('structure_snapshot',{project});
 record.capture=await i.defineTools().find(t=>t.name==='mw_ide_screenshot').execute({});
 assert.ok(record.capture.path);copyFileSync(record.capture.path,stem+'.png');
 record.log=readFileSync(join(i.IPC_DIR,'bridge.log'),'utf8').split('\n').filter(line=>line.includes(record.capture.path)&&line.includes('focus preserved')).at(-1);
 assert.ok(record.log,'Native preserved-focus evidence absent');
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 record.state=await i.verb('compile_state',{},30000);assert.equal(record.state.is_modified,false);assert.equal(record.state.is_compiled,true);
 record.accepted=true;console.log(JSON.stringify({accepted:true,evidence:stem+'.json',image:stem+'.png',log:record.log}));
}catch(e){record.error=e.message;throw e;}finally{writeFileSync(stem+'.json',JSON.stringify(record,null,2));await i.stopBridge();}
