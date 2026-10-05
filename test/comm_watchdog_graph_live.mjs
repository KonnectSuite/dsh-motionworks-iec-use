// Opt-in fixture lifecycle. Canvas input is observed/performed separately.
// Run prepare only when desktop use is available; retain its receipt for resume.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const pou='CodexCommGraph',instance='CodexCommInstance',mode=process.argv[2];
assert.ok(['prepare','verify_canvas','cleanup','replay_listing'].includes(mode));
const resume=process.env.MW_COMM_GRAPH_EVIDENCE;
if(!['prepare','replay_listing'].includes(mode))assert.match(resume??'',/^comm-graph-[a-f0-9-]+\.json$/);
const file=join(workspace,'.motionworks/verification',resume??('comm-graph-'+randomUUID()+'.json'));
const record=['prepare','replay_listing'].includes(mode)?{project,pou,instance,phase:'requested',events:[],accepted:false,controller_downloaded:false}:JSON.parse(readFileSync(file,'utf8'));
assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.instance,instance);
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={}){
 const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});retain();
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 if(typeof result.accepted==='boolean')assert.equal(result.accepted,true,JSON.stringify(result));
 if(name==='mw_ide_build')assert.equal(result.fresh_compile,true);
 return result;
}
function same(a,b){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);}
function collateral(a,b){
 for(const key of ['tasks','globals'])assert.deepEqual(a[key],b[key],key);
 assert.deepEqual(a.pous.filter(p=>p.name!==pou),b.pous.filter(p=>p.name!==pou));
 assert.deepEqual(a.pous.find(p=>p.name===pou).variables,b.pous.find(p=>p.name===pou).variables);
 for(const key of ['program_sources','translation_files'])for(const path of new Set([...Object.keys(a[key]),...Object.keys(b[key])]))
  if(!path.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/'))assert.deepEqual(a[key][path],b[key][path],path);
}
const instruction=line=>line.raw.replace(/^(@BPV\s+)?\d+\s+\d+\s+\d+\s+/,'').trim().replace(/\s+/g,' ');
function graph(listing,blockInstance='ProbeWatchdog'){
 assert.equal(listing.accepted,true);assert.equal(listing.has_more,false);
 assert.equal(listing.network_count,1);assert.equal(listing.networks.length,1);
 const lines=listing.networks[0].lines;
 assert.equal(lines.filter(l=>instruction(l).startsWith('CAL ')&&l.symbols.some(s=>s.resolved&&s.declaration?.name===blockInstance)).length,1);
 for(const [name,direction] of [['Enable','input'],['HeartBeat','input'],['WatchDog','input'],['Valid','output'],['OK','output'],['Error','output'],['ErrorID','output']]){
  const pins=lines.flatMap(l=>l.symbols).filter(s=>s.instance?.name===blockInstance&&s.declaration?.name===name);
  assert.equal(pins.length,1,name);assert.equal(pins[0].resolved,true,name);
  assert.equal(pins[0].pin_direction,direction,name);assert.equal(pins[0].block_type,'CommWatchdog',name);
 }
 return lines.map(instruction);
}
// Actual retained compiler evidence represents DINT as a typed hexadecimal load.
const originalLoad='LD @TYP:4# 00#000003e8',replacementLoad='LD @TYP:4# 00#000007d0';
if(mode==='replay_listing'){
 const basename=process.argv[3];assert.match(basename??'',/^graphical-listing-[a-f0-9-]+\.json$/);
 const receipt=JSON.parse(readFileSync(join(workspace,'.motionworks/verification',basename),'utf8'));
 assert.equal(receipt.result.pou,'AryaToolboxProbe');
 const lines=receipt.result.networks[0].lines;
 const pin=lines.findIndex(l=>l.symbols.some(s=>s.instance?.name==='fbWatchdog'&&s.declaration?.name==='WatchDog'));
 assert.ok(pin>0);const instructions=graph(receipt.result,'fbWatchdog');
 assert.match(instructions[pin],/^ST /);assert.equal(instructions[pin-1],originalLoad);
 console.log('Retained native CommWatchdog listing: seven resolved pin directions and exact connected DINT load verified; no IDE invoked');
 process.exit(0);
}
try{
 const status=await i.verb('status',{},30000);
 assert.equal(resolve(status.active_project).toLowerCase(),resolve(project+'.mwt').toLowerCase());
 if(mode==='prepare'){
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  record.baseline=await i.runCode('structure_snapshot',{project});
  record.native_baseline=await i.verb('structure_snapshot',{},180000);
  assert.equal(record.baseline.pous.length,7);assert.ok(!record.baseline.pous.some(p=>p.name===pou));retain();
  await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST',pou_type:'PROGRAM'});
  for(const [name,type] of [['Run','BOOL'],['ValidOut','BOOL'],['OKOut','BOOL'],['ErrorOut','BOOL'],['ErrorIDOut','UINT']])
   await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
  await act('mw_ide_fb_insert',{pou,block:'CommWatchdog',library:'Yaskawa_Toolbox_v375',instance:'ProbeWatchdog',expected_body:'',bindings:{Enable:'Run',HeartBeat:'DINT#0',WatchDog:'DINT#1000',Valid:'ValidOut',OK:'OKOut',Error:'ErrorOut',ErrorID:'ErrorIDOut'}});
  await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
  record.before_conversion=await i.runCode('structure_snapshot',{project});
  const discovery=await act('mw_code_pous');
  await act('mw_ide_pou_convert',{pou,language:'FBD',expected_body_sha256:discovery.pous.find(p=>p.name===pou).body_sha256,conversion_reviewed:true});
  record.graph=await i.runCode('structure_snapshot',{project});collateral(record.before_conversion,record.graph);
  record.native=await i.verb('variable_snapshot',{pou},30000);
  record.listing=await act('mw_ide_graphical_listing',{pou,limit:50});
  record.instructions=graph(record.listing);
  const pin=record.listing.networks[0].lines.findIndex(l=>l.symbols.some(s=>s.instance?.name==='ProbeWatchdog'&&s.declaration?.name==='WatchDog'));
  assert.ok(pin>0);assert.match(record.instructions[pin],/^ST /);
  assert.equal(record.instructions[pin-1],originalLoad);
  record.operand_index=pin-1;
  const make=await act('mw_ide_make');assert.equal(make.is_compiled,true);assert.equal(make.is_modified,false);
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  await act('mw_ide_open_worksheet',{pou,kind:'code'});
  record.phase='prepared_graph';retain();
 }else if(mode==='verify_canvas'){
  assert.equal(record.phase,'prepared_graph');
  const saved=await act('mw_ide_save');assert.equal(saved.saved,true);assert.equal(saved.is_modified,false);
  record.edited=await i.runCode('structure_snapshot',{project});collateral(record.graph,record.edited);
  assert.notEqual(record.edited.pous.find(p=>p.name===pou).body_sha256,record.graph.pous.find(p=>p.name===pou).body_sha256);
  assert.deepEqual(await i.verb('variable_snapshot',{pou},30000),record.native);
  const expected=[...record.instructions];assert.equal(expected[record.operand_index],originalLoad);expected[record.operand_index]=replacementLoad;
  record.edited_listing=await act('mw_ide_graphical_listing',{pou,limit:50});
  assert.deepEqual(graph(record.edited_listing),expected,'Only the connected WatchDog constant may change');
  const make=await act('mw_ide_make');assert.equal(make.is_compiled,true);assert.equal(make.is_modified,false);
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  record.phase='edited_graph';record.constant_edit_verified=true;retain();
 }else{
  assert.ok(record.baseline&&record.native_baseline,'Original baselines required for cleanup');
  const state=await act('mw_ide_compile_state');assert.equal(state.is_modified,false,'Save and inspect any unsettled editor before cleanup');
  const current=await i.runCode('structure_snapshot',{project});
  assert.equal(current.pous.filter(p=>p.name===pou).length,1);
  for(const key of ['globals'])assert.deepEqual(current[key],record.baseline[key]);
  assert.deepEqual(current.pous.filter(p=>p.name!==pou),record.baseline.pous);
  await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance,user_approved:true});
  await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
  for(const name of ['mw_ide_build','mw_ide_make']){
   const result=await act(name);assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);
  }
  record.after=await i.runCode('structure_snapshot',{project});same(record.baseline,record.after);
  assert.deepEqual(await i.verb('structure_snapshot',{},180000),record.native_baseline);
  record.cleanup_verified=true;record.accepted=record.constant_edit_verified===true;
  record.phase='cleaned';retain();
 }
 console.log(JSON.stringify({phase:record.phase,accepted:record.accepted,evidence:file}));
}catch(error){record.failures??=[];record.failures.push({phase:record.phase,error:error.message});retain();throw error;}
finally{await i.stopBridge();}
