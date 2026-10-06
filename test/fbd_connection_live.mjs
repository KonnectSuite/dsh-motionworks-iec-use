// Opt-in disposable native preparation. Graphical input is observed separately.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const directory=join(workspace,'.motionworks/verification'),project=join(workspace,'.motionworks/stage/TopCutterS5');
const pou='AryaWireProof',instance='AryaWireProofInstance';
assert.equal(process.argv[2],'prepare');
const prior=JSON.parse(readFileSync(join(directory,'arya-checkpoint-chat.json'))),file=join(directory,'fbd-connection-'+randomUUID()+'.json');
const record={project,pou,instance,baseline_id:prior.baseline_id,accepted:false,cleanup_verified:false,phase:'requested',controller_action:false,events:[]};
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2)),tools=new Map(i.defineTools().map(t=>[t.name,t]));
const act=async(name,args={})=>{const value=await tools.get(name).execute({project,baseline_saved:true,...args});record.events.push({name,args,value});retain();if(value.verification)assert.equal(value.verification.accepted,true);if(typeof value.accepted==='boolean')assert.equal(value.accepted,true);console.log(JSON.stringify({name,accepted:value.verification?.accepted??value.accepted,evidence:value.evidence_path}));return value;};
try{
 await act('mw_ide_verify',{mode:'compare_baseline',baseline_id:record.baseline_id});
 record.original=await i.runCode('structure_snapshot',{project});assert.ok(!record.original.pous.some(p=>p.name===pou));retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
 const flags={retain:false,pdd:false,opc:false,disabled:false,not_on_plc:false,redundant:false};
 for(const name of ['Run','Ready','RetQ'])await act('mw_ide_variable_change',{pou,operation:'add',flags,declaration:{name,type:'BOOL',section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
 const first=await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'FirstTimer',expected_body:'',bindings:{IN:'Run',PT:'T#100ms',Q:'Ready'}});
 await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'SecondTimer',expected_body_sha256:first.text_body_sha256,bindings:{PT:'T#100ms',Q:'RetQ'}});
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance});
 record.before_conversion=await i.runCode('structure_snapshot',{project});retain();
 const discovery=await act('mw_code_pous');const current=discovery.pous.find(p=>p.name===pou);assert.equal(current.language,'ST');
 await act('mw_ide_pou_convert',{pou,language:'FBD',expected_body_sha256:current.body_sha256,conversion_reviewed:true});
 record.listing=await act('mw_ide_graphical_listing',{pou});assert.equal(record.listing.has_more,false);
 const lines=record.listing.networks.flatMap(n=>n.lines);
 const freeInput=lines.filter(l=>l.symbols.some(s=>s.resolved&&s.instance?.name==='SecondTimer'&&s.declaration?.name==='IN'));
 assert.equal(freeInput.length,1);assert.match(freeInput[0].raw,/\t@FPNOP\t/);
 for(const name of ['FirstTimer','SecondTimer'])assert.equal(lines.filter(l=>/\tCAL\t/.test(l.raw)&&l.symbols.some(s=>s.resolved&&s.declaration?.name===name)).length,1);
 record.free_input_verified=true;
 record.saved=await i.runCode('structure_snapshot',{project});record.native=await i.verb('variable_snapshot',{pou},30000);retain();
 const compile=await act('mw_ide_compile_state');assert.equal(compile.is_modified,false);assert.equal(compile.is_compiled,true);
 await act('mw_ide_open_worksheet',{pou,kind:'code'});
 record.phase='prepared';record.preparation_verified=true;retain();
}catch(error){record.error=error.message;record.phase='stopped';retain();throw error;}
finally{retain();await i.stopBridge();console.log(JSON.stringify({phase:record.phase,preparation_verified:record.preparation_verified??false,evidence:file}));}
