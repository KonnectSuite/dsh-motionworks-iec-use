// Native toolbox generation, observed constant edit and exact fixture cleanup.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexToolboxGraph',instance='CodexToolboxInstance';
const mode=process.argv[2],resume=process.env.MW_TOOLBOX_GRAPH_EVIDENCE;
if(resume)assert.match(resume,/^toolbox-graph-[a-f0-9-]+\.json$/);
assert.ok(mode==='prepare'||resume,'Retained evidence required');
const path=join(workspace,'.motionworks/verification',resume??('toolbox-graph-'+randomUUID()+'.json'));
const record=mode==='prepare'?{project,pou,instance,phase:'requested',events:[],accepted:false,controller_downloaded:false}:JSON.parse(readFileSync(path,'utf8'));
assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.instance,instance);
const retain=()=>writeFileSync(path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={}){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});record.events.push({name,args,result});retain();
 console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted,evidence_path:result.evidence_path}));
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 if(typeof result.accepted==='boolean')assert.equal(result.accepted,true,JSON.stringify(result));
 return result;
}
function same(a,b){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);}
function collateral(a,b){
 for(const key of ['tasks','globals'])assert.deepEqual(a[key],b[key],key);
 assert.deepEqual(a.pous.filter(p=>p.name!==pou),b.pous.filter(p=>p.name!==pou));
 assert.deepEqual(a.pous.find(p=>p.name===pou).variables,b.pous.find(p=>p.name===pou).variables);
 for(const key of ['program_sources','translation_files'])for(const file of new Set([...Object.keys(a[key]),...Object.keys(b[key])]))
  if(!file.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/'))assert.deepEqual(a[key][file],b[key][file],file);
}
const instruction=line=>line.raw.replace(/^(@BPV\s+)?\d+\s+\d+\s+\d+\s+/,'').trim().replace(/\s+/g,' ');
function generatedGraph(listing){
 assert.equal(listing.has_more,false);assert.equal(listing.network_count,2);assert.equal(listing.networks.length,2);
 const all=listing.networks.flatMap(n=>n.lines);
 for(const name of ['ProbeTimer','ProbeRetentive'])assert.equal(all.filter(l=>instruction(l).startsWith('CAL ')&&l.symbols.some(s=>s.resolved&&s.declaration?.name===name)).length,1);
 const lines=listing.networks[1].lines;
 const pins=lines.map((l,index)=>({index,line:l,pin:l.symbols.find(s=>s.instance?.name==='ProbeRetentive'&&s.declaration?.name==='Accum')})).filter(p=>p.pin);
 assert.equal(pins.length,2);
 for(const p of pins){assert.equal(p.pin.resolved,true);assert.equal(p.pin.pin_direction,'in_out');assert.equal(p.pin.block_type,'TON_Retentive');}
 const input=pins.find(p=>instruction(p.line).startsWith('ST ')),output=pins.find(p=>instruction(p.line).startsWith('LD '));
 assert.ok(input&&output);assert.equal(typeof input.pin.token,'string');assert.equal(input.pin.token,output.pin.token);
 const from=lines[input.index-1],to=lines[output.index+1];
 assert.ok(from.symbols.some(s=>s.resolved&&!s.instance&&s.declaration?.name==='Accum'));
 assert.ok(to.symbols.some(s=>s.resolved&&!s.instance&&s.declaration?.name==='Accum'));
 assert.equal(instruction(from).replace(/^LD /,''),instruction(to).replace(/^ST /,''));
 return listing.networks.map(n=>n.lines.map(instruction));
}
try{
 if(mode==='prepare'){
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  record.baseline=await i.runCode('structure_snapshot',{project});assert.ok(!record.baseline.pous.some(p=>p.name===pou));retain();
  await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
  for(const [name,type] of [['Run','BOOL'],['Ready','BOOL'],['Elapsed','TIME'],['Accum','TIME'],['RetQ','BOOL']])
   await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
  const timer=await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'ProbeTimer',expected_body:'',bindings:{IN:'Run',PT:'T#100ms',Q:'Ready',ET:'Elapsed'}});
  await act('mw_ide_fb_insert',{pou,block:'TON_Retentive',library:'Yaskawa_Toolbox_v375',instance:'ProbeRetentive',expected_body_sha256:timer.text_body_sha256,bindings:{Accum:'Accum',Enable:'Run',Preset:'T#100ms',Reset:'FALSE',Q:'RetQ'}});
  await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
  record.before_conversion=await i.runCode('structure_snapshot',{project});retain();
 }
 if(mode==='resume_conversion'){
  assert.equal(record.phase,'stopped');
  const failure=record.events.at(-1);
  assert.equal(failure.name,'mw_ide_pou_convert');
  assert.equal(failure.result.action_performed,false);
  assert.equal(failure.result.conversion_attempted,false);
  const receipt=JSON.parse(readFileSync(failure.result.evidence_path,'utf8'));
  assert.equal(receipt.phase,'stopped');
  assert.ok(!receipt.events.some(e=>e.name==='conversion'));
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  same(await i.runCode('structure_snapshot',{project}),record.before_conversion);
  record.previous_failure={phase:record.failed_phase,error:record.error};
  record.phase='reconciled_before_conversion';retain();
 }
 if(mode==='prepare'||mode==='resume_conversion'){
  const discovery=await act('mw_code_pous');
  await act('mw_ide_pou_convert',{pou,language:'FBD',expected_body_sha256:discovery.pous.find(p=>p.name===pou).body_sha256,conversion_reviewed:true});
  record.graph=await i.runCode('structure_snapshot',{project});collateral(record.before_conversion,record.graph);
  record.native=await i.verb('variable_snapshot',{pou},30000);
  record.listing=await act('mw_ide_graphical_listing',{pou,limit:50});assert.equal(record.listing.accepted,true);
  record.make=await act('mw_ide_make');assert.equal(record.make.is_compiled,true);assert.equal(record.make.is_modified,false);
  const errors=await act('mw_ide_errors',{pane:'Errors'});assert.equal(errors.count,0);
  await act('mw_ide_open_worksheet',{pou,kind:'code'});
  record.phase='prepared_graph';retain();console.log(JSON.stringify({phase:record.phase,evidence_path:path,network_count:record.listing.network_count}));
 }else if(mode==='verify_canvas'){
  assert.equal(record.phase,'prepared_graph');
  const expected=generatedGraph(record.listing);
  const pins=record.listing.networks[1].lines.map((line,index)=>({line,index})).filter(p=>p.line.symbols.some(s=>s.resolved&&s.instance?.name==='ProbeRetentive'&&s.declaration?.name==='Preset'&&s.pin_direction==='input'));
  assert.equal(pins.length,1);const position=pins[0].index-1;
  assert.equal(expected[1][position],'LD @TYP:12# 0S100000000');
  expected[1][position]='LD @TYP:12# 0S200000000';
  const saved=await act('mw_ide_save');assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);
  record.edited=await i.runCode('structure_snapshot',{project});collateral(record.graph,record.edited);
  assert.notEqual(record.graph.pous.find(p=>p.name===pou).body_sha256,record.edited.pous.find(p=>p.name===pou).body_sha256);
  assert.deepEqual(await i.verb('variable_snapshot',{pou},30000),record.native);
  record.edited_listing=await act('mw_ide_graphical_listing',{pou,limit:50});
  assert.deepEqual(generatedGraph(record.edited_listing),expected,'Only the selected Retentive Preset constant may change');
  const make=await act('mw_ide_make');assert.equal(make.is_compiled,true);assert.equal(make.is_modified,false);
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  record.phase='edited_graph';record.constant_edit_verified=true;retain();
  console.log(JSON.stringify({phase:record.phase,constant_edit_verified:true,evidence_path:path}));
 }else if(mode==='verify_restoration'){
  assert.equal(record.phase,'probe_removed_collateral_unresolved');
  const repairPath=join(workspace,'.motionworks/verification/fixture-group-restore.json');
  const repair=JSON.parse(readFileSync(repairPath,'utf8').replace(/^\uFEFF/,''));
  assert.equal(repair.phase,'native_verified');assert.equal(repair.project,project);
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  same(await i.runCode('structure_snapshot',{project}),record.baseline);
  const native=await i.verb('variable_snapshot',{},60000);
  assert.deepEqual(native.variables,repair.after);
  assert.deepEqual(native.groups,repair.groups.map(g=>({...g,name:g.name===' n'?'System Variables':g.name})));
  for(const name of ['mw_ide_build','mw_ide_make']){const result=await act(name);assert.equal(result.is_compiled,true);assert.equal((await act('mw_ide_compile_state')).is_modified,false);}
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  record.after=await i.runCode('structure_snapshot',{project});same(record.baseline,record.after);
  record.phase='cleaned_without_conversion';record.accepted=false;record.cleanup_verified=true;record.restoration_evidence=repairPath;retain();
  repair.phase='full_baseline_verified';repair.accepted=true;
  // This first run retained its expected projection under "before". Recover
  // the raw rows from the exact earlier receipt checked before the setter.
  const original=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/pou-conversion-2cabe2f0-ecbe-4e47-afc7-4022c5283f7a.json'),'utf8'));
  repair.before=original.events.find(e=>e.name==='native').value.declarations.globals.variables;
  repair.before_source='pou-conversion-2cabe2f0-ecbe-4e47-afc7-4022c5283f7a.json';
  writeFileSync(repairPath,JSON.stringify(repair,null,2));
  console.log(JSON.stringify({phase:record.phase,cleanup_verified:true,evidence_path:path}));
 }else if(mode==='cleanup_after_unassign'){
  assert.equal(record.phase,'stopped');
  const failure=record.events.at(-1);
  assert.equal(failure.name,'mw_ide_task_change');assert.equal(failure.args.operation,'unassign');
  const receipt=JSON.parse(readFileSync(failure.result.evidence_path,'utf8'));
  assert.equal(receipt.action_performed,true);assert.equal(receipt.native_result.native_matches_plan,true);
  assert.equal(receipt.native_result.is_modified,false);
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  same(await i.runCode('structure_snapshot',{project}),receipt.saved_result);
  record.collateral_failure=receipt.verification;record.unassign_saved=receipt.saved_result;retain();
  await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
  for(const name of ['mw_ide_build','mw_ide_make']){const result=await act(name);assert.equal(result.is_compiled,true);assert.equal((await act('mw_ide_compile_state')).is_modified,false);}
  record.after=await i.runCode('structure_snapshot',{project});
  assert.ok(!record.after.pous.some(p=>p.name===pou));
  assert.deepEqual(record.after.tasks,record.baseline.tasks);
  assert.deepEqual(record.after.pous,record.baseline.pous);
  record.phase='probe_removed_collateral_unresolved';record.accepted=false;record.cleanup_verified=false;record.probe_removed=true;retain();
  console.log(JSON.stringify({phase:record.phase,probe_removed:true,cleanup_verified:false,evidence_path:path}));
 }else if(mode==='cleanup'||mode==='cleanup_stopped'){
  const completed=mode==='cleanup';
  if(completed){
   assert.ok(['prepared_graph','edited_graph'].includes(record.phase));
   generatedGraph(record.edited_listing??record.listing);
   same(await i.runCode('structure_snapshot',{project}),record.edited??record.graph);
   assert.deepEqual(await i.verb('variable_snapshot',{pou},30000),record.native);
  }else{
   assert.equal(record.phase,'stopped');
   const failure=record.events.at(-1);
   assert.equal(failure.name,'mw_ide_pou_convert');
   assert.equal(failure.result.action_performed,false);
   assert.equal(failure.result.conversion_attempted,false);
   assert.equal((await act('mw_ide_compile_state')).is_modified,false);
   same(await i.runCode('structure_snapshot',{project}),record.before_conversion);
   record.previous_failure={phase:record.failed_phase,error:record.error};retain();
  }
  await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance,user_approved:true});
  await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
  for(const name of ['mw_ide_build','mw_ide_make']){const result=await act(name);assert.equal(result.is_compiled,true);assert.equal((await act('mw_ide_compile_state')).is_modified,false);}
  record.after=await i.runCode('structure_snapshot',{project});same(record.baseline,record.after);
  record.phase=completed?'cleaned':'cleaned_without_conversion';record.accepted=completed;record.cleanup_verified=true;retain();console.log(JSON.stringify({phase:record.phase,accepted:record.accepted,cleanup_verified:true,evidence_path:path}));
 }else throw Error('Expected prepare, resume_conversion, verify_canvas, verify_restoration, cleanup, cleanup_stopped or cleanup_after_unassign');
}catch(error){record.failed_phase=record.phase;record.phase='stopped';record.error=error.message;retain();throw error;}
finally{await i.stopBridge();}
