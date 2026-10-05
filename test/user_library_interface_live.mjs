// Opt-in, read-only public toolbox interfaces on the sole authorized fixture.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','user-library-interfaces-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false,interfaces:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=s=>hash(JSON.stringify(Object.fromEntries(['pous','tasks','globals','program_sources','translation_files'].map(k=>[k,s[k]]))));
try{
 record.before=digest(await i.runCode('structure_snapshot',{project}));
 const tool=i.defineTools().find(t=>t.name==='mw_code_block_interface');
 for(const args of [{name:'ReadMotorSpeed',library:'PLCopen_Toolbox_v375'},{name:'CommWatchdog',library:'Yaskawa_Toolbox_v375'}]){
  const response=await tool.execute({project,...args}),r=response.result??response;
  assert.equal(r.name,args.name);assert.equal(r.library,args.library);assert.equal(r.binding,'native_reference');
  assert.equal(r.source_stream,'Variables.VB');assert.equal(r.origin,'user_library_declarations');assert.equal(r.action_performed,false);
  assert.equal(r.source_sha256,hash(readFileSync(r.source_file)));assert.equal(r.registry_sha256,hash(readFileSync(r.reference_registry)));
  const pins=r.pins.map(p=>[p.name,p.type,p.direction]);
  if(args.name==='ReadMotorSpeed')assert.deepEqual(pins,[['Axis','AXIS_REF','in_out'],['Execute','BOOL','input'],['Done','BOOL','output'],['Busy','BOOL','output'],['Error','BOOL','output'],['ErrorID','UINT','output'],['MaxRPM','LREAL','output'],['RatedRPM','LREAL','output']]);
  else assert.deepEqual(pins,[['Valid','BOOL','output'],['Enable','BOOL','input'],['HeartBeat','DINT','input'],['WatchDog','DINT','input'],['OK','BOOL','output'],['Error','BOOL','output'],['ErrorID','UINT','output']]);
  record.interfaces.push(r);
 }
 await assert.rejects(tool.execute({project,name:'CamGenerator',library:'Cam_Toolbox_v375'}),error=>{record.compressed_refusal=error.message;return /Variables\.VB.*compressed container/.test(error.message)});
 record.after=digest(await i.runCode('structure_snapshot',{project}));assert.equal(record.after,record.before);
 record.state=await i.verb('compile_state',{},30000);assert.equal(record.state.is_modified,false);assert.equal(record.state.is_compiled,true);
 record.accepted=true;console.log(JSON.stringify({accepted:true,evidence:file,interfaces:record.interfaces.map(r=>({name:r.name,pins:r.pins.length})),compressed_interface_supported:false}));
}catch(error){record.error=error.message;throw error;}
finally{writeFileSync(file,JSON.stringify(record,null,2));await i.stopBridge();}
