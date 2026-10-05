// Reviewed native source/compile acceptance; auto mode uses public mw_ide_fb_insert.
// Exact disposable fixture only. No desktop input, controller or runtime action.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexCamProof',instance='CodexCamProofInstance';
const mode=process.argv[2]??'run';assert.ok(['run','graph','auto','cleanup'].includes(mode));
const resume=process.env.MW_CAM_NATIVE_EVIDENCE;
if(mode==='cleanup')assert.match(resume??'',/^cam-native-[a-f0-9-]+\.json$/);
else assert.equal(resume,undefined);
const file=join(workspace,'.motionworks/verification',resume??('cam-native-'+randomUUID()+'.json'));
const record=mode==='cleanup'?JSON.parse(readFileSync(file,'utf8')):{project,pou,instance,requested_graph:mode==='graph',phase:'requested',events:[],accepted:false,controller_downloaded:false};
assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.instance,instance);
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={}){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});retain();
 console.log(JSON.stringify({tool:name,accepted:result.verification?.accepted??result.accepted,evidence:file}));
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 if(typeof result.accepted==='boolean')assert.equal(result.accepted,true);
 return result;
}
const keys=['pous','tasks','globals','program_sources','translation_files'];
function same(a,b){for(const key of keys)assert.deepEqual(a[key],b[key],key);}
function collateral(current){
 assert.deepEqual(current.globals,record.baseline.globals);
 assert.deepEqual(current.pous.filter(p=>p.name!==pou),record.baseline.pous);
 const tasks=current.tasks.map(t=>({...t,instances:t.instances.filter(x=>x.name!==instance)}));
 assert.deepEqual(tasks,record.baseline.tasks);
 for(const key of ['program_sources','translation_files']){
  const original=Object.fromEntries(Object.entries(current[key]).filter(([path])=>!path.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/')));
  assert.deepEqual(original,record.baseline[key],key);
 }
}
function manifest(root){
 const result={};
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,e.name);assert.equal(lstatSync(path).isSymbolicLink(),false);
  if(e.isDirectory())walk(path);else if(e.isFile())result[path]=createHash('sha256').update(readFileSync(path)).digest('hex');
 }}walk(root);return result;
}
async function compile(){
 const before=await i.runCode('structure_snapshot',{project});
 const build=await act('mw_ide_build');assert.equal(build.fresh_compile,true);assert.equal(build.is_compiled,true);
 const make=await act('mw_ide_make');assert.equal(make.is_compiled,true);assert.equal(make.is_modified,false);
 assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
 same(before,await i.runCode('structure_snapshot',{project}));
}
async function cleanup(){
 assert.ok(record.baseline&&record.native_baseline&&record.library_before);
 assert.equal((await act('mw_ide_compile_state')).is_modified,false);
 const current=await i.runCode('structure_snapshot',{project});collateral(current);
 const assigned=current.tasks.flatMap(t=>t.instances.filter(x=>x.name===instance).map(x=>({task:t.name,...x})));
 if(assigned.length){assert.equal(assigned.length,1);assert.equal(assigned[0].task,'BG');assert.equal(assigned[0].type,pou);await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance,user_approved:true});}
 const scratch=current.pous.filter(p=>p.name===pou);assert.ok(scratch.length<=1);
 if(scratch.length)await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 await compile();record.after=await i.runCode('structure_snapshot',{project});same(record.after,record.baseline);
 assert.deepEqual(await i.verb('structure_snapshot',{},180000),record.native_baseline);
 assert.deepEqual(manifest(record.library_root),record.library_before);
 record.cleanup_verified=true;record.accepted=record.call_compile_verified===true&&(!record.requested_graph||record.compiled_graph_verified===true);
 record.phase='cleaned';retain();
}
try{
 if(mode==='cleanup'){await cleanup();}
 else{
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  record.baseline=await i.runCode('structure_snapshot',{project});
  if(mode==='auto'){
   const checkpoint=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/startup-trial-7b8164f8-3209-4733-b042-0d69e677a2ae.json'),'utf8'));
   assert.equal(checkpoint.accepted,true);same(record.baseline,checkpoint.after);record.auto_insertion=true;
  }else same(record.baseline,JSON.parse(readFileSync(join(workspace,'.motionworks/verification/arya-engineering-lifecycle.json'),'utf8')).saved);
  record.native_baseline=await i.verb('structure_snapshot',{},180000);
  assert.ok(!record.baseline.pous.some(p=>p.name===pou));
  record.interface=await act('mw_code_block_interface',{name:'CamGenerator',library:'Cam_Toolbox_v375'});
  assert.equal(record.interface.evidence_kind,'installed-compiled-block-interface');assert.equal(record.interface.insertion_eligible,false);
  assert.deepEqual(record.interface.pins.map(p=>[p.name,p.type,p.direction]),[['CamData','CamSegmentStruct','in_out'],['CamTable','Y_MS_CAM_STRUCT','in_out'],['Execute','BOOL','input'],['TableSize','UDINT','input'],['Done','BOOL','output'],['Busy','BOOL','output'],['Error','BOOL','output'],['ErrorID','UINT','output']]);
  record.library_root=dirname(dirname(dirname(record.interface.worksheet_file)));record.library_before=manifest(record.library_root);retain();
  await act('mw_ide_pou_change',{operation:'create',name:pou,pou_type:'PROGRAM',language:'ST'});
  record.phase='created';retain();
  for(const [name,type] of [['CamDataLocal','CamSegmentStruct'],['CamTableLocal','Y_MS_CAM_STRUCT'],['DoneOut','BOOL'],['BusyOut','BOOL'],['ErrorOut','BOOL'],['ErrorIDOut','UINT'],['ProbeCam','CamGenerator']]){
   if(mode==='auto'&&name==='ProbeCam')continue;
   await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
  }
  const code='ProbeCam(CamData := CamDataLocal, CamTable := CamTableLocal, Execute := FALSE, TableSize := UDINT#2880);\r\nCamDataLocal := ProbeCam.CamData;\r\nCamTableLocal := ProbeCam.CamTable;\r\nDoneOut := ProbeCam.Done;\r\nBusyOut := ProbeCam.Busy;\r\nErrorOut := ProbeCam.Error;\r\nErrorIDOut := ProbeCam.ErrorID;\r\n';
  record.reviewed_code=code;retain();
  if(mode==='auto'){
   record.insertion=await act('mw_ide_fb_insert',{pou,block:'CamGenerator',library:'Cam_Toolbox_v375',instance:'ProbeCam',expected_body:'',compiler_verified:true,bindings:{CamData:'CamDataLocal',CamTable:'CamTableLocal',Execute:'FALSE',TableSize:'UDINT#2880',Done:'DoneOut',Busy:'BusyOut',Error:'ErrorOut',ErrorID:'ErrorIDOut'}});
   assert.deepEqual(record.insertion.completed_phases,['instance_declared','call_inserted']);
   record.auto_interface=JSON.parse(readFileSync(record.insertion.evidence_path,'utf8')).plan.interface;
   assert.equal(record.auto_interface.evidence_kind,'fresh-bound-compiled-block-interface');
   assert.equal(record.auto_interface.compiler_source_binding_verified,false);
   assert.equal(record.auto_interface.insertion_eligible,true);retain();
  }else await act('mw_ide_code_change',{pou,expected_body:'',code});
  await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
  record.phase='assigned';record.call_compile_started_ms=Date.now();retain();await compile();
  record.compiler_source=await i.runCode('compiled_source_evidence',{project,pou});
  assert.equal(record.compiler_source.pou,pou);assert.equal(record.compiler_source.artifacts.length,4);
  assert.ok(record.compiler_source.artifacts.every(a=>a.modified_ms>=record.call_compile_started_ms-2000&&a.modified_ms<=Date.now()+2000),'Fresh scratch compiler artifacts required');
  record.readback=await act('mw_code_read_text',{pou});
  assert.equal(record.readback.body.replaceAll('\r',''),code.replaceAll('\r',''));
  collateral(await i.runCode('structure_snapshot',{project}));
  assert.deepEqual(manifest(record.library_root),record.library_before);
  record.call_compile_verified=true;record.phase='compiled_call';retain();
  if(record.requested_graph){
   const saved=await i.runCode('structure_snapshot',{project});
   const target=saved.pous.find(p=>p.name===pou);
   await act('mw_ide_pou_convert',{pou,language:'FBD',expected_body_sha256:target.body_sha256,conversion_reviewed:true});
   record.phase='converted';retain();
   record.graphical_listing=await act('mw_ide_graphical_listing',{pou,limit:50});
   assert.equal(record.graphical_listing.has_more,false);
   assert.equal(record.graphical_listing.compiler_dependency_freshness_verified,true);
   const symbols=record.graphical_listing.networks.flatMap(n=>n.lines.flatMap(l=>l.symbols));
   for(const pin of record.interface.pins){
    const resolved=symbols.filter(s=>s.instance?.name==='ProbeCam'&&s.declaration?.name===pin.name);
    assert.ok(resolved.length>0,'Missing compiled pin '+pin.name);
    for(const symbol of resolved){assert.equal(symbol.resolved,true);assert.equal(symbol.block_type,'CamGenerator');assert.equal(symbol.pin_direction,pin.direction);}
   }
   const graph=await i.runCode('structure_snapshot',{project});
   assert.equal(graph.pous.find(p=>p.name===pou).language,'FBD');
   assert.deepEqual(graph.pous.find(p=>p.name===pou).variables,target.variables);
   collateral(graph);await compile();
   assert.deepEqual(manifest(record.library_root),record.library_before);
   record.compiled_graph_verified=true;record.phase='compiled_graph';retain();
  }
  await cleanup();
 }
 console.log(JSON.stringify({accepted:record.accepted,cleanup_verified:record.cleanup_verified,evidence:file}));
}catch(error){record.failures??=[];record.failures.push({phase:record.phase,error:error.message});retain();throw error;}
finally{await i.stopBridge();}
