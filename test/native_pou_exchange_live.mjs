// Opt-in native exchange investigation on the sole disposable smoke fixture.
// Not a public import tool: no arbitrary package, overwrite or binary rewriting.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {join,relative} from 'node:path';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
// The bundled read-only engine Python does not include pywin32. Require an
// explicit native probe runtime and validate it before any project mutation.
const nativePython=process.env.MOTIONWORKS_NATIVE_PROBE_PYTHON;
assert.ok(nativePython,'Set MOTIONWORKS_NATIVE_PROBE_PYTHON to a Python with pywin32');
const runtime=spawnSync(nativePython,['-B','-c','import win32com.client'],{encoding:'utf8',windowsHide:true});
assert.equal(runtime.status,0,runtime.error?.message||runtime.stderr);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),name='CodexGraphExchange';
const destination=join(workspace,'.motionworks','ep-'+randomUUID().slice(0,8));
assert.ok(destination.length<128,'DDE argument buffer limit');
const evidence_path=join(workspace,'.motionworks/verification/native-pou-exchange-live-'+randomUUID()+'.json');
const record={project,destination,name,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
function manifest(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
 const path=join(directory,entry.name);assert.ok(!entry.isSymbolicLink());
 if(entry.isDirectory())return manifest(path);
 assert.ok(entry.isFile());const raw=readFileSync(path);
 return [{path:relative(destination,path),bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}];
});}
const COM=String.raw`
import sys,json
from pathlib import Path
import win32com.client
project,operation,name,destination=sys.argv[1:]
app=win32com.client.Dispatch('Ade.Application.550')
assert Path(app.ActiveProject.FullName).resolve()==Path(project).resolve()
assert app.ActiveProject.IsModified is False
names=[app.ActiveProject.Pous.Item(i).Name for i in range(1,app.ActiveProject.Pous.Count+1)]
assert (name in names)==(operation=='export')
assert operation in ['export','import']
command=('ExportPou '+name+' "'+destination+'"') if operation=='export' else ('ImportPou "'+destination+'"')
result=app.ExecuteDdeCommand(command)
modified=app.ActiveProject.IsModified
assert result==0
if operation=='import' and modified:app.ActiveProject.Save()
assert app.ActiveProject.IsModified is False
print(json.dumps(dict(command=command,result=result,modified_after_action=modified,modified_after_save=app.ActiveProject.IsModified)))
`;
function exchange(operation){
 record.phase=operation+'_requested';retain();
 const native=spawnSync(nativePython,['-B','-c',COM,project+'.mwt',operation,name,destination],{encoding:'utf8',windowsHide:true,timeout:45000});
 if(native.error||native.status!==0)throw Error('Native exchange outcome requires inspection: '+(native.error?.message||native.stderr));
 const result=JSON.parse(native.stdout);record.events.push({operation,result});retain();return result;
}
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(tool,args){const result=await tools.get(tool).execute({project,baseline_saved:true,...args});record.events.push({tool,args,result});retain();assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));return result;}
function equalSources(before,after){for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(before[key],after[key],key);}
try{
 record.baseline=await i.runCode('structure_snapshot',{project});assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'copy',name:'ServoTaskSlow',new_name:name});
 record.copied=await i.runCode('structure_snapshot',{project});retain();
 mkdirSync(destination);exchange('export');record.package_manifest=manifest(destination);retain();
 equalSources(record.copied,await i.runCode('structure_snapshot',{project}));
 await act('mw_ide_pou_change',{operation:'delete',name,user_approved:true,references_reviewed:true});
 assert.deepEqual(manifest(destination),record.package_manifest);exchange('import');
 record.imported=await i.runCode('structure_snapshot',{project});equalSources(record.copied,record.imported);retain();
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou:name,instance:'CodexExchangeInstance'});
 const listing=await act('mw_ide_graphical_listing',{pou:name,limit:1});assert.equal(listing.network_count,5);
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexExchangeInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name,user_approved:true,references_reviewed:true});
 for(const tool of ['mw_ide_build','mw_ide_make']){const result=await tools.get(tool).execute({});record.events.push({tool,result});retain();assert.equal(result.is_compiled,true);assert.equal(result.is_modified,false);}
 record.after=await i.runCode('structure_snapshot',{project});equalSources(record.baseline,record.after);
 record.phase='accepted';retain();console.log(JSON.stringify({accepted:true,evidence_path}));
}catch(error){record.phase='stopped';record.error=error.message;retain();throw error;}
finally{await i.stopBridge();}
