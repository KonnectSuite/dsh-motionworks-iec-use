// Opt-in read-only startup refusal around an observed disposable Save As dialog.
// This harness never opens/answers dialogs, saves, closes, launches or compiles.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),directory=join(workspace,'.motionworks/verification');
const mode=process.argv[2],resume=process.env.MW_STARTUP_MODAL_RECEIPT;
if(resume)assert.match(resume,/^startup-modal-[a-f0-9-]+\.json$/);
assert.ok(mode==='before'||resume,'Retained before receipt required');
const file=join(directory,resume??('startup-modal-'+randomUUID()+'.json'));
const record=mode==='before'?{project,accepted:false,controller_action:false,events:[]}:JSON.parse(readFileSync(file));assert.equal(record.project,project);
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const act=async(name,args={})=>{const value=await tools.get(name).execute(args);record.events.push({name,args,value});retain();return value;};
try{
 if(mode==='before'){
  const prior=JSON.parse(readFileSync(join(directory,'arya-checkpoint-chat.json')));record.baseline_id=prior.baseline_id;
  const compared=await act('mw_ide_verify',{project,mode:'compare_baseline',baseline_id:record.baseline_id,baseline_saved:true});assert.equal(compared.accepted,true);
  record.state=await act('mw_ide_state');assert.equal(record.state.blocked,false);assert.equal(record.state.ide_minimized,false);
  record.status=await act('mw_ide_status');assert.equal(record.status.active_project.replaceAll('\\','/').toLowerCase().replace(/\.mwt$/,''),project.replaceAll('\\','/').toLowerCase());
  record.compile=await act('mw_ide_compile_state');assert.equal(record.compile.is_modified,false);assert.equal(record.compile.is_compiled,true);
  record.phase='awaiting_observed_fixture_modal';
 }else if(mode==='blocked'){
  assert.equal(record.phase,'awaiting_observed_fixture_modal');
  const state=await act('mw_ide_state');assert.equal(state.ide_window,record.state.ide_window);assert.equal(state.blocked,true);assert.equal(state.ide_enabled,false);assert.equal(state.trial_dialog,false);
  const dialog=state.dialogs.filter(d=>d.enabled&&/^Save\/Zip project as$/i.test(d.title));assert.equal(dialog.length,1);assert.ok(dialog[0].buttons.some(b=>b.label==='Cancel'));
  record.modal=dialog[0];retain();
  const start=Date.now();let refusal;
  try{await act('mw_ide_start',{project});}catch(error){refusal=error.message;}
  record.start_elapsed_ms=Date.now()-start;record.refusal=refusal;retain();
  assert.match(refusal??'',/Existing IDE frame .* blocked by an observed modal: Save\/Zip project as/);assert.ok(refusal.includes(dialog[0].handle));
  assert.match(refusal,/No COM operation, dialog answer or duplicate IDE launch was attempted/);assert.ok(record.start_elapsed_ms<20000,'Known modal refusal should not wait 300s');
  const after=await act('mw_ide_state');assert.equal(after.ide_window,state.ide_window);assert.equal(after.ide_enabled,false);assert.ok(after.dialogs.some(d=>d.handle===dialog[0].handle&&d.enabled));
  record.phase='modal_refusal_verified';
 }else if(mode==='after'){
  assert.equal(record.phase,'modal_refusal_verified');const state=await act('mw_ide_state');assert.equal(state.ide_window,record.state.ide_window);assert.equal(state.blocked,false);assert.equal(state.dialog_count,0);
  const status=await act('mw_ide_status');assert.equal(status.active_project,record.status.active_project);
  assert.deepEqual(await act('mw_ide_compile_state'),record.compile);
  const compared=await act('mw_ide_verify',{project,mode:'compare_baseline',baseline_id:record.baseline_id,baseline_saved:true});assert.equal(compared.accepted,true);assert.ok(Object.values(compared.comparison.checks).every(x=>x===true));
  record.phase='cleaned';record.accepted=true;record.cleanup_verified=true;
 }else throw Error('Use before, blocked or after');
}catch(error){record.error=error.message;retain();throw error;}
finally{retain();await i.stopBridge();console.log(JSON.stringify({phase:record.phase,accepted:record.accepted,cleanup_verified:record.cleanup_verified??false,evidence:file}));}
