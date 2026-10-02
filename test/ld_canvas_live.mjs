import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexLadderProbe';
const evidence_path=workspace+'/.motionworks/verification/ld-canvas-live.json';
const ts=new Map(i.defineTools().map(t=>[t.name,t]));
const mode=process.argv[2];
const record=mode==='prepare'?{project,pou,phase:'requested',events:[]}:JSON.parse(readFileSync(evidence_path,'utf8'));
if(record.error){(record.prior_stops??=[]).push({phase:record.phase,error:record.error});delete record.error;}
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
async function act(name,args={}) {const result=await ts.get(name).execute(args);record.events.push({name,args,result});retain();return result;}
function matchGraph() {
 assert.equal(record.listing.accepted,true);assert.equal(record.listing.network_count,1);
 const lines=record.listing.networks[0].lines;
 assert.deepEqual(lines.map(l=>l.raw.trim().split(/\s+/).slice(-3)),[
  ['LD','@IV','1'],['OR','@IV','2'],['ANDN','@IV','3'],['ST','@IV','4']]);
 assert.deepEqual(lines.map(l=>l.symbols[0].declaration.name),['Run','Alternate','Stop','Ready']);
 assert.ok(lines.every(l=>l.symbols.length===1&&l.symbols[0].resolved));
 record.instruction_match={accepted:true,expression:'Ready := (Run OR Alternate) AND NOT Stop',runtime_behavior_verified:false};
 retain();
}
try {
 if(mode==='prepare') {
  record.before=await i.runCode('structure_snapshot',{project});assert.equal(record.before.pous.length,7);
  assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);retain();
  assert.equal((await act('mw_ide_pou_change',{project,name:pou,operation:'create',language:'LD',pou_type:'PROGRAM',baseline_saved:true})).verification.accepted,true);
  for(const name of ['Run','Alternate','Stop','Ready']) {
   const declaration={name,type:'BOOL',section:'VAR',group:'Default',address:null,initial_value:'FALSE',description:null};
   assert.equal((await act('mw_ide_variable_change',{project,pou,operation:'add',declaration,baseline_saved:true})).verification.accepted,true);
  }
  assert.equal((await act('mw_ide_task_change',{project,name:'BG',operation:'assign',pou,instance:'CodexLadderInstance',baseline_saved:true})).verification.accepted,true);
  record.prepared=await i.runCode('structure_snapshot',{project});
  assert.equal((await act('mw_ide_open_worksheet',{project,pou,kind:'code'})).accepted,true);
  record.phase='prepared';retain();console.log(JSON.stringify({phase:record.phase,evidence_path}));
 } else if(mode==='verify') {
  const save=await act('mw_ide_save');assert.equal(save.saved,true);assert.equal(save.is_modified,false);
  record.graph=await i.runCode('structure_snapshot',{project});
  record.native_variables=await i.verb('variable_snapshot',{pou},30000);
  const preparedVariables=record.events.filter(e=>e.name==='mw_ide_variable_change').at(-1).result.native_result.variables;
  assert.deepEqual(record.native_variables.variables,preparedVariables,'complete native declaration fields/flags');
  for(const key of ['tasks','globals'])assert.deepEqual(record.prepared[key],record.graph[key],key);
  const bodyTranslation='POE/'+pou+'/'+pou.toUpperCase()+'Translation.xml';
  const collateralTranslations=s=>Object.fromEntries(Object.entries(s.translation_files).filter(([key])=>key!==bodyTranslation));
  assert.deepEqual(collateralTranslations(record.prepared),collateralTranslations(record.graph),'collateral translations');
  record.body_translation_change={path:bodyTranslation,before:record.prepared.translation_files[bodyTranslation]??null,after:record.graph.translation_files[bodyTranslation]??null};
  for(const [key,value] of Object.entries(record.prepared.program_sources))
   if(!key.toLowerCase().startsWith(('POE/'+pou+'/').toLowerCase()))assert.deepEqual(record.graph.program_sources[key],value,key);
  for(const p of record.prepared.pous.filter(p=>p.name!==pou))assert.deepEqual(p,record.graph.pous.find(x=>x.name===p.name),p.name);
  assert.deepEqual(record.prepared.pous.find(p=>p.name===pou).variables,record.graph.pous.find(p=>p.name===pou).variables);
  record.listing=await act('mw_ide_graphical_listing',{project,pou,baseline_saved:true,limit:50});
  assert.equal(record.listing.accepted,true,JSON.stringify(record.listing));
  matchGraph();
  record.make=await act('mw_ide_make');assert.equal(record.make.is_compiled,true);assert.equal(record.make.is_modified,false);
  record.phase='graph_verified';retain();console.log(JSON.stringify({phase:record.phase,networks:record.listing.networks,evidence_path}));
 } else if(mode==='cleanup') {
  matchGraph();
  assert.equal((await act('mw_ide_task_change',{project,name:'BG',operation:'unassign',instance:'CodexLadderInstance',baseline_saved:true,user_approved:true})).verification.accepted,true);
  assert.equal((await act('mw_ide_pou_change',{project,name:pou,operation:'delete',baseline_saved:true,user_approved:true,references_reviewed:true})).verification.accepted,true);
  for(const name of ['mw_ide_build','mw_ide_make']){const result=await act(name);assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
  record.after=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],record.after[key],key);
  record.phase='cleaned';retain();console.log(JSON.stringify({phase:record.phase,evidence_path}));
 } else throw Error('Expected prepare, verify or cleanup');
} catch(error) {record.phase='stopped';record.error=error.message;retain();throw error;}
finally {await i.stopBridge();}
