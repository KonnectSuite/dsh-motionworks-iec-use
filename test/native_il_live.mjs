import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexILProbe';
const evidence_path=workspace+'/.motionworks/verification/native-il-live-'+randomUUID()+'.json';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const record={project,pou,phase:'requested',events:[],baseline:JSON.parse(readFileSync(workspace+'/.motionworks/verification/native-il-before.json','utf8'))};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
async function act(name,args={}){const result=await tools.get(name).execute({project,baseline_saved:true,...args});record.events.push({name,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
async function change(code){const body=await tools.get('mw_code_read_text').execute({project,pou});record.events.push({name:'mw_code_read_text',result:body});retain();assert.equal(body.language,'IL');assert.equal(body.body_error,null);return act('mw_ide_code_change',{pou,expected_body:body.body,code});}
async function compile(){
 const before=await i.runCode('structure_snapshot',{project});
 for(const name of ['mw_ide_build','mw_ide_make']){const result=await tools.get(name).execute({});record.events.push({name,result});retain();assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 const after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(before[key],after[key],key);
}
try {
 record.initial=await i.runCode('structure_snapshot',{project});assert.equal(record.initial.pous.length,8);retain();
 const read=await tools.get('mw_code_read_text').execute({project,pou});assert.equal(read.body,'(* Native IL format & comment probe *)\r\nRET\r\n');
 await act('mw_ide_pou_change',{operation:'create',name:'CodexILBlank',language:'IL',pou_type:'PROGRAM'});
 await act('mw_ide_pou_change',{operation:'delete',name:'CodexILBlank',user_approved:true,references_reviewed:true});
 for(const name of ['Run','Alternate','Stop','Ready'])await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type:'BOOL',section:'VAR',group:'Default',address:null,initial_value:'FALSE',description:null}});
 const code='(* Native IL lifecycle & comment verification *)\nLD Run\nOR Alternate\nANDN Stop\nST Ready\nRET\n';
 await change(code);
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance:'CodexILInstance'});
 await compile();
 await assert.rejects(()=>tools.get('mw_ide_code_change').execute({project,pou,baseline_saved:true,expected_body:'stale',code:'RET\n'}),/expected_body/);
 await change('(* Edited IL body *)\nLD Run\nANDN Stop\nST Ready\nRET\n');
 await compile();
 await act('mw_ide_pou_change',{operation:'copy',name:pou,new_name:'CodexILCopy'});
 await act('mw_ide_pou_change',{operation:'rename',name:'CodexILCopy',new_name:'CodexILRenamed',references_reviewed:true});
 await act('mw_ide_pou_change',{operation:'delete',name:'CodexILRenamed',user_approved:true,references_reviewed:true});
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexILInstance',user_approved:true});
 await change('');
 const empty=await tools.get('mw_code_read_text').execute({project,pou});assert.equal(empty.body,'');
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 await compile();
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.baseline[key],record.after[key],key);
 record.phase='cleaned';retain();console.log(JSON.stringify({phase:record.phase,evidence_path,accepted:true}));
}catch(error){record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({evidence_path,error:error.message}));throw error;}
finally{await i.stopBridge();}
