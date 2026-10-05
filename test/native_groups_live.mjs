// Explicit disposable fixture only. Retain every step; never retry a failed action.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const directory=join(workspace,'.motionworks/verification');
const path=join(directory,'native-groups-live-'+randomUUID()+'.json');
const baseline=JSON.parse(readFileSync(join(directory,'toolbox-graph-299eeadd-536c-4b46-9905-20b3bd1c93d0.json'),'utf8'));
assert.equal(baseline.accepted,true);assert.equal(baseline.cleanup_verified,true);
const record={project,phase:'requested',events:[],accepted:false};
const retain=()=>writeFileSync(path,JSON.stringify(record,null,2));
const same=(a,b)=>{for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);};
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={},refusal=false){
 record.phase=name;record.pending={name,args};retain();
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});delete record.pending;retain();
 console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted,evidence_path:result.evidence_path}));
 if(refusal){assert.equal(result.accepted,false);assert.equal(result.action_performed,false);}
 else if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 else if(typeof result.accepted==='boolean')assert.equal(result.accepted,true,JSON.stringify(result));
 return result;
}
try{
 record.before=await i.runCode('structure_snapshot',{project});same(record.before,baseline.baseline);retain();
 const start=await act('mw_ide_start');assert.ok(!start.foreign_project);
 const open=await act('mw_ide_open',{path:project+'.mwt'});assert.equal(open.matches_request,true);
 assert.equal((await act('mw_ide_compile_state')).is_modified,false);
 same(await i.runCode('structure_snapshot',{project}),record.before);
 const pou='CodexNativeGroupProbe';
 assert.ok(!record.before.pous.some(p=>p.name===pou));
 await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
 for(const scope of [{pou},{}]){
  const name=scope.pou?'CodexLocalGroup':'CodexGlobalGroup',renamed=name+'Renamed';
  await act('mw_ide_variable_group_change',{...scope,operation:'create',name});
  const variable=scope.pou?'CodexLocalMember':'CodexGlobalMember';
  await act('mw_ide_variable_change',{...scope,operation:'add',declaration:{name:variable,type:'INT',section:scope.pou?'VAR':'VAR_GLOBAL',group:name,address:null,initial_value:'3',description:null},flags:{retain:true,opc:true}});
  await act('mw_ide_variable_group_change',{...scope,operation:'rename',name,new_name:renamed});
  await act('mw_ide_variable_group_change',{...scope,operation:'delete',name:renamed,user_approved:true},true);
  await act('mw_ide_variable_change',{...scope,operation:'delete',name:variable,user_approved:true,references_reviewed:true});
  await act('mw_ide_variable_group_change',{...scope,operation:'delete',name:renamed,user_approved:true});
 }
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
 assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
 record.after=await i.runCode('structure_snapshot',{project});same(record.before,record.after);
 record.phase='cleaned';record.accepted=true;retain();
 console.log(JSON.stringify({accepted:true,evidence_path:path}));
}catch(error){record.failed_phase=record.phase;record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({accepted:false,error:error.message,evidence_path:path}));process.exitCode=1;}
finally{await i.stopBridge();}
