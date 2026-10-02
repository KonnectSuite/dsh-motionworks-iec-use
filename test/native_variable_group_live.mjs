// Opt-in phases around one observed native Variable Properties group edit.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexGroupProbe';
const file=workspace+'/.motionworks/verification/native-variable-group-live.json';
const phase=process.env.MOTIONWORKS_GROUP_PHASE;
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const saved=()=>i.runCode('structure_snapshot',{project});
let record;
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
async function act(tool,args={}) {const result=await tools.get(tool).execute({project,baseline_saved:true,...args});record.events.push({tool,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
try {
 if(phase==='prepare') {
  record={project,pou,phase:'started',events:[],baseline:await saved()};assert.equal(record.baseline.pous.length,7);retain();
  await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
  for(const name of ['Mover','Anchor'])await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type:'INT',section:'VAR',group:'Default',address:null,initial_value:'7',description:'Group move verification'}});
  record.phase='variables_prepared';retain();
  record.group_preparation=JSON.parse(execFileSync(join(process.env.SystemRoot??'C:/Windows','SysWOW64/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(import.meta.dirname,'native_variable_group_prepare.ps1'),'-ExpectedWorkspace',workspace],{encoding:'utf8',windowsHide:true}));retain();
 } else {
  record=JSON.parse(readFileSync(file,'utf8'));assert.equal(record.project,project);assert.equal(record.pou,pou);
  if(phase==='capture') {
   assert.equal(record.phase,'variables_prepared');
   record.before_move=await saved();record.native_before=await i.verb('variable_snapshot',{pou},30000);
   assert.ok(record.native_before.groups.some(g=>g.name==='Destination'&&!g.read_only));
   record.phase='group_prepared';retain();
   record.navigation=await tools.get('mw_ide_open_worksheet').execute({project,pou,kind:'variables'});
   assert.equal(record.navigation.accepted,true);retain();
  } else if(phase==='verify') {
   assert.equal(record.phase,'group_prepared');
   record.save=await tools.get('mw_ide_save').execute({});assert.equal(record.save.saved,true);
   record.after_move=await saved();record.native_after=await i.verb('variable_snapshot',{pou},30000);retain();
   const expected=record.native_before.variables.map(v=>v.name==='Mover'?{...v,group:'Destination'}:v);
   assert.deepEqual([...record.native_after.variables].sort((a,b)=>a.name.localeCompare(b.name)),expected.sort((a,b)=>a.name.localeCompare(b.name)));
   assert.deepEqual(record.native_after.groups,record.native_before.groups);
   const target=record.before_move.pous.find(p=>p.name===pou),after=record.after_move.pous.find(p=>p.name===pou);
   assert.deepEqual({...after,variables:[]},{...target,variables:[]});
   assert.deepEqual([...after.variables].sort((a,b)=>a.name.localeCompare(b.name)),target.variables.map(v=>v.name==='Mover'?{...v,group:'Destination'}:v).sort((a,b)=>a.name.localeCompare(b.name)));
   const sourcePath='POE/'+pou+'/src.st1';
   const retainedStreams=rows=>Object.fromEntries(Object.entries(rows).filter(([name])=>!name.toUpperCase().endsWith('.VB')&&!name.toUpperCase().endsWith('.VGR')));
   assert.deepEqual(retainedStreams(record.before_move.program_sources[sourcePath]),retainedStreams(record.after_move.program_sources[sourcePath]));
   for(const key of ['tasks','globals'])assert.deepEqual(record.before_move[key],record.after_move[key],key);
   assert.deepEqual(record.before_move.pous.filter(p=>p.name!==pou),record.after_move.pous.filter(p=>p.name!==pou));
   for(const key of ['program_sources','translation_files'])for(const [path,value] of Object.entries(record.before_move[key])) {
    if(!path.startsWith('POE/'+pou+'/'))assert.deepEqual(value,record.after_move[key][path],path);
   }
   record.phase='move_verified';retain();
   const body=(await i.runCode('read_text',{project,pou})).body;
   await act('mw_ide_code_change',{pou,expected_body:body,code:'Mover := Anchor;\r\n'});
   await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance:'CodexGroupInstance'});
   record.before_compile=await saved();retain();
   for(const tool of ['mw_ide_build','mw_ide_make']) {const result=await act(tool);assert.equal(result.is_compiled,true);if(tool==='mw_ide_make')assert.equal(result.is_modified,false);}
   record.after_compile=await saved();
   for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before_compile[key],record.after_compile[key],key);
   record.phase='compiled';retain();
  } else if(phase==='cleanup') {
   assert.equal(record.phase,'compiled');
   await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexGroupInstance',user_approved:true});
   await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
   for(const tool of ['mw_ide_build','mw_ide_make']) {const result=await act(tool);assert.equal(result.is_compiled,true);if(tool==='mw_ide_make')assert.equal(result.is_modified,false);}
   record.after=await saved();for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.baseline[key],record.after[key],key);
   record.phase='cleaned';record.accepted=true;retain();
  } else throw Error('Unknown explicit phase');
 }
 console.log(JSON.stringify({phase:record.phase,evidence_path:file}));
} finally {await i.stopBridge();}
