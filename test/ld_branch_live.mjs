// Explicit phases for a multi-object Ctrl+T branch in the disposable fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexBranchProbe',instance='CodexBranchInstance';
const mode=process.argv[2],resume=process.env.MW_BRANCH_EVIDENCE;
if(resume)assert.match(resume,/^ld-branch-[a-f0-9-]+\.json$/);
assert.ok(mode==='prepare'||resume);
const path=join(workspace,'.motionworks/verification',resume??('ld-branch-'+randomUUID()+'.json'));
const record=mode==='prepare'?{project,pou,instance,phase:'requested',events:[],accepted:false}:JSON.parse(readFileSync(path,'utf8'));
assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.instance,instance);
const retain=()=>writeFileSync(path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={}){
 record.pending={name,args};retain();const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});delete record.pending;retain();
 console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted}));
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 else if(typeof result.accepted==='boolean')assert.equal(result.accepted,true,JSON.stringify(result));
 return result;
}
const same=(a,b)=>{for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);};
function collateral(a,b){
 for(const key of ['tasks','globals'])assert.deepEqual(a[key],b[key],key);
 assert.deepEqual(a.pous.filter(p=>p.name!==pou),b.pous.filter(p=>p.name!==pou));
 const original=a.pous.find(p=>p.name===pou),now=b.pous.find(p=>p.name===pou);
 assert.deepEqual(original.variables,now.variables);assert.equal(now.language,'LD');assert.equal(now.type,'PROGRAM');
 const target='POE/'+pou+'/src.st1',old=a.program_sources[target],fresh=b.program_sources[target];
 for(const [name,hash] of Object.entries(old))if(!name.toUpperCase().endsWith('.GB'))assert.equal(fresh[name],hash,name);
 for(const key of ['program_sources','translation_files'])for(const name of new Set([...Object.keys(a[key]),...Object.keys(b[key])])){
  if(key==='program_sources'&&name===target)continue;
  if(key==='translation_files'&&name==='POE/'+pou+'/'+pou.toUpperCase()+'Translation.xml'&&
     ((a.empty_translation_files.includes(name)&&b[key][name]===undefined)||
      (a[key][name]===undefined&&b.empty_translation_files.includes(name))))continue;
  assert.deepEqual(a[key][name],b[key][name],name);
 }
}
function instructions(listing){
 assert.equal(listing.accepted,true);assert.equal(listing.has_more,false);assert.equal(listing.network_count,1);
 return listing.networks[0].lines.map(line=>{
  const op=line.raw.replace(/^(@BPV\s+)?\d+\s+\d+\s+\d+\s+/,'').trim().split(/\s+/)[0];
  assert.equal(line.symbols.length,1);const s=line.symbols[0];assert.equal(s.resolved,true);assert.ok(!s.instance);return [op,s.declaration.name];
 });
}
try{
 if(mode==='prepare'){
  assert.equal((await act('mw_ide_compile_state')).is_modified,false);
  record.before=await i.runCode('structure_snapshot',{project});assert.equal(record.before.pous.length,7);assert.equal(record.before.globals.length,164);
  const prior=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/native-group-grid-4772c014-fb2a-4d7a-a6d3-a625fbc8d5eb.json'),'utf8'));
  assert.equal(prior.accepted,true);same(record.before,prior.final);assert.ok(!record.before.pous.some(p=>p.name===pou));retain();
  await act('mw_ide_pou_change',{operation:'create',name:pou,language:'LD'});
  for(const name of ['Run','Enable','Alternate','Ready'])await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type:'BOOL',section:'VAR',group:'Default',address:null,initial_value:'FALSE',description:null}});
  await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
  record.prepared=await i.runCode('structure_snapshot',{project});record.native=await i.verb('variable_snapshot',{pou},30000);retain();
  await act('mw_ide_open_worksheet',{pou,kind:'code'});record.phase='prepared';retain();
 }else if(mode==='verify_serial'||mode==='reconcile_serial'||mode==='verify_branch'){
  const serial=mode!=='verify_branch';
  if(mode==='reconcile_serial'){
   assert.equal(record.phase,'stopped');assert.equal(record.events.at(-1).name,'mw_ide_save');
   assert.equal(record.events.at(-1).result.saved,true);assert.equal(record.events.at(-1).result.is_modified,false);
   assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
   record.previous_failure={phase:record.failed_phase,error:record.error};retain();
  }else{
   assert.equal(record.phase,serial?'prepared':'serial_verified');
   const save=await act('mw_ide_save');assert.equal(save.saved,true);assert.equal(save.is_modified,false);
  }
  const graph=await i.runCode('structure_snapshot',{project});record.observed_graph=graph;retain();collateral(record.prepared,graph);
  assert.deepEqual(record.native,await i.verb('variable_snapshot',{pou},30000));
  const listing=await act('mw_ide_graphical_listing',{pou,limit:50});
  const expected=serial?[['LD','Run'],['AND','Enable'],['ST','Ready']]:[['LD','Run'],['AND','Enable'],['OR','Alternate'],['ST','Ready']];
  assert.deepEqual(instructions(listing),expected);
  const make=await act('mw_ide_make');assert.equal(make.is_compiled,true);assert.equal(make.is_modified,false);
  record[serial?'serial':'branch']={graph,listing,expected};record.phase=serial?'serial_verified':'branch_verified';retain();
 }else if(mode==='cleanup'){
  assert.equal(record.phase,'branch_verified');
  await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance,user_approved:true});
  await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
  for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  record.after=await i.runCode('structure_snapshot',{project});same(record.before,record.after);
  record.phase='cleaned';record.accepted=true;record.cleanup_verified=true;retain();
 }else throw Error('Unknown explicit phase');
 console.log(JSON.stringify({phase:record.phase,accepted:record.accepted,evidence_path:path}));
}catch(error){record.failed_phase=record.phase;record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({accepted:false,error:error.message,evidence_path:path}));process.exitCode=1;}
finally{await i.stopBridge();}
