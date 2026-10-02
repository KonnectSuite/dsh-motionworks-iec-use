import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexConvertProbe';
const language=process.env.MOTIONWORKS_CONVERSION_LANGUAGE??'FBD';assert.ok(['FBD','LD'].includes(language));
const evidence_path=join(workspace,'.motionworks/verification/public-conversion-live-'+randomUUID()+'.json');
const record={project,pou,language,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(tool,args={}){const result=await tools.get(tool).execute({project,baseline_saved:true,...args});record.events.push({tool,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
function sources(a,b){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);}
function verifyConversion(before,after){
 assert.deepEqual(before.globals,after.globals);assert.deepEqual(before.tasks,after.tasks);
 assert.deepEqual(before.pous.filter(p=>p.name!==pou),after.pous.filter(p=>p.name!==pou));
 const original=before.pous.find(p=>p.name===pou),converted=after.pous.find(p=>p.name===pou);
 assert.equal(converted.language,language);assert.equal(converted.body_blank,false);
 assert.deepEqual(original.variables,converted.variables);
 for(const key of ['program_sources','translation_files'])for(const file of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
  if(!file.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/'))assert.deepEqual(before[key][file],after[key][file],file);
 }
}
try{
 record.baseline=await i.runCode('structure_snapshot',{project});assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou,pou_type:'PROGRAM',language:'ST'});
 for(const [name,type,initial_value] of [['Run','BOOL','FALSE'],['Ready','BOOL','FALSE'],['Elapsed','TIME','T#0ms']])await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value,description:null}});
 await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'ProbeTimer',expected_body:'',bindings:{IN:'Run',PT:'T#100ms',Q:'Ready',ET:'Elapsed'}});
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance:'CodexConvertInstance'});
 record.before_conversion=await i.runCode('structure_snapshot',{project});record.phase='conversion_requested';retain();
 record.discovery=await tools.get('mw_code_pous').execute({project});retain();
 const expected_body_sha256=record.discovery.pous.find(p=>p.name===pou).body_sha256;
 assert.equal(expected_body_sha256,record.before_conversion.pous.find(p=>p.name===pou).body_sha256);
 record.native_conversion=await act('mw_ide_pou_convert',{pou,language,expected_body_sha256,conversion_reviewed:true});
 record.after_conversion=await i.runCode('structure_snapshot',{project});verifyConversion(record.before_conversion,record.after_conversion);retain();
 assert.equal(record.native_conversion.network_count,1);
 const conversionReceipt=JSON.parse(readFileSync(record.native_conversion.evidence_path,'utf8'));
 const bindings=conversionReceipt.result.listing.symbol_bindings;
 for(const [token,name] of [['@IV 1','Run'],['@IV 2','Ready'],['@IV 3','Elapsed'],['@IFB 4','ProbeTimer']])assert.equal(bindings[token]?.name,name,token);
 record.graphical_symbols_verified=true;retain();
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexConvertInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 for(const tool of ['mw_ide_build','mw_ide_make']){const result=await tools.get(tool).execute({});record.events.push({tool,result});retain();assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 record.after=await i.runCode('structure_snapshot',{project});sources(record.baseline,record.after);record.phase='cleaned';retain();console.log(JSON.stringify({evidence_path,native_conversion:record.native_conversion}));
}catch(error){record.phase='stopped';record.error=error.message;retain();throw error;}
finally{await i.stopBridge();}
