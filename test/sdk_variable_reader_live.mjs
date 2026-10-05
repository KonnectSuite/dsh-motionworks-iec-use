// Read-only complete native package equivalence on the sole disposable fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','sdk-reader-package-'+randomUUID()+'.json');
const original=process.env.MW_DISABLE_SDK_READER;
const record={project,accepted:false,controller_downloaded:false,observations:[]};
const keys=['pous','tasks','globals','program_sources','translation_files'];
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
function modeLog(){
 const root=join(tmpdir(),'dsh-motionworks-ipc');
 const logs=readdirSync(root).filter(n=>n.startsWith(process.pid+'-')).map(n=>join(root,n,'bridge.log'));
 assert.ok(logs.length);logs.sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
 return readFileSync(logs[0],'utf8');
}
try{
 record.before=await i.runCode('structure_snapshot',{project});
 const baseline=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/arya-engineering-lifecycle.json'),'utf8'));
 for(const key of keys)assert.deepEqual(record.before[key],baseline.saved[key],key);
 for(const disabled of [true,false]){
  await i.stopBridge();process.env.MW_DISABLE_SDK_READER=disabled?'1':'0';
  const started=Date.now(),snapshot=await i.verb('pou_package_snapshot',{},180000);
  const log=modeLog();assert.ok(log.includes(disabled?'disabled by diagnostic override':'SDK variable reader enabled: verified installed SDK'));
  record.observations.push({disabled,elapsed_ms:Date.now()-started,snapshot});retain();
 }
 assert.deepEqual(record.observations[1].snapshot,record.observations[0].snapshot);
 assert.equal(Object.values(record.observations[1].snapshot.declarations).reduce((n,s)=>n+s.variables.length,0),429);
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of keys)assert.deepEqual(record.after[key],record.before[key],key);
 const state=await i.verb('compile_state',{},30000);assert.equal(state.is_modified,false);assert.equal(state.is_compiled,true);
 record.accepted=true;retain();console.log(JSON.stringify({accepted:true,evidence:file,elapsed_ms:record.observations.map(o=>o.elapsed_ms),declarations:429}));
}catch(error){record.error=error.message;retain();throw error;}
finally{await i.stopBridge();if(original===undefined)delete process.env.MW_DISABLE_SDK_READER;else process.env.MW_DISABLE_SDK_READER=original;}
