import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const python=process.env.MOTIONWORKS_NATIVE_PROBE_PYTHON;
assert.ok(python);assert.equal(spawnSync(python,['-B','-c','import win32com.client'],{windowsHide:true}).status,0);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),pou='CodexConvertProbe';
const evidence_path=join(workspace,'.motionworks/verification/native-conversion-live-'+randomUUID()+'.json');
const record={project,pou,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(tool,args={}){const result=await tools.get(tool).execute({project,baseline_saved:true,...args});record.events.push({tool,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
function sources(a,b){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);}
function verifyConversion(before,after){
 assert.deepEqual(before.globals,after.globals);assert.deepEqual(before.tasks,after.tasks);
 assert.deepEqual(before.pous.filter(p=>p.name!==pou),after.pous.filter(p=>p.name!==pou));
 const original=before.pous.find(p=>p.name===pou),converted=after.pous.find(p=>p.name===pou);
 assert.equal(converted.language,'FBD');assert.equal(converted.body_blank,false);
 assert.deepEqual(original.variables,converted.variables);
 for(const key of ['program_sources','translation_files'])for(const file of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
  if(!file.replaceAll('\\','/').toLowerCase().startsWith('poe/'+pou.toLowerCase()+'/'))assert.deepEqual(before[key][file],after[key][file],file);
 }
}
const COM=String.raw`
import sys,json
from pathlib import Path
import win32com.client
project,name=sys.argv[1:]
app=win32com.client.Dispatch('Ade.Application.550')
assert Path(app.ActiveProject.FullName).resolve()==Path(project).resolve()
assert app.ActiveProject.IsModified is False
assert app.ActiveProject.IsCompiled is True
p=app.ActiveProject.Pous.Item(name)
assert p.ReadOnly is False and p.PouLanguage==2
before=[app.ActiveProject.Pous.Item(i).Name for i in range(1,app.ActiveProject.Pous.Count+1)]
try:
 result=p.Convert(3)
 print(json.dumps(dict(accepted=True,result=str(result),language=app.ActiveProject.Pous.Item(name).PouLanguage,modified=app.ActiveProject.IsModified,pous_before=before,pous_after=[app.ActiveProject.Pous.Item(i).Name for i in range(1,app.ActiveProject.Pous.Count+1)])))
except Exception as e:
 print(json.dumps(dict(accepted=False,error=str(e),language=app.ActiveProject.Pous.Item(name).PouLanguage,modified=app.ActiveProject.IsModified)))
if app.ActiveProject.IsModified:app.ActiveProject.Save()
`;
try{
 record.baseline=await i.runCode('structure_snapshot',{project});assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou,pou_type:'PROGRAM',language:'ST'});
 for(const [name,type,initial_value] of [['Run','BOOL','FALSE'],['Ready','BOOL','FALSE'],['Elapsed','TIME','T#0ms']])await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value,description:null}});
 await act('mw_ide_fb_insert',{pou,block:'TON',library:'IEC',instance:'ProbeTimer',expected_body:'',bindings:{IN:'Run',PT:'T#100ms',Q:'Ready',ET:'Elapsed'}});
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou,instance:'CodexConvertInstance'});
 const build=await tools.get('mw_ide_build').execute({});record.events.push({tool:'mw_ide_build',result:build});retain();assert.equal(build.is_compiled,true);assert.equal(build.is_modified,false);
 record.before_conversion=await i.runCode('structure_snapshot',{project});record.phase='conversion_requested';retain();
 const result=spawnSync(python,['-B','-c',COM,project+'.mwt',pou],{encoding:'utf8',windowsHide:true,timeout:45000});
 if(result.error||result.status!==0)throw Error('Conversion outcome requires inspection: '+(result.error?.message||result.stderr));
 record.native_conversion=JSON.parse(result.stdout);record.after_conversion=await i.runCode('structure_snapshot',{project});retain();
 if(record.native_conversion.accepted){verifyConversion(record.before_conversion,record.after_conversion);assert.equal(record.native_conversion.language,3);const listing=await tools.get('mw_ide_graphical_listing').execute({project,pou,baseline_saved:true,limit:10});record.events.push({tool:'mw_ide_graphical_listing',result:listing});retain();assert.equal(listing.accepted,true);assert.equal(listing.network_count,1);}
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexConvertInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 for(const tool of ['mw_ide_build','mw_ide_make']){const result=await tools.get(tool).execute({});record.events.push({tool,result});retain();assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 record.after=await i.runCode('structure_snapshot',{project});sources(record.baseline,record.after);record.phase='cleaned';retain();console.log(JSON.stringify({evidence_path,native_conversion:record.native_conversion}));
}catch(error){record.phase='stopped';record.error=error.message;retain();throw error;}
finally{await i.stopBridge();}
