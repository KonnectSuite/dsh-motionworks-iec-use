// Opt-in complete compiler-contract proof on the sole disposable fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {compilerInterface} from '../compiler-interface.js';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','compiler-interface-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false,events:[]};
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
const observe=async(name,fn)=>{const result=await fn();record.events.push({name,result});retain();return result;};
const digest=data=>createHash('sha256').update(data).digest('hex');
function artifact(path){assert.equal(lstatSync(path).isSymbolicLink(),false);assert.ok(realpathSync(path).toLowerCase().startsWith(realpathSync(project).toLowerCase()+'\\'));const s=statSync(path);return {path,modified_ms:s.mtimeMs,sha256:digest(readFileSync(path))};}
function library(block,libraries){
 const matches=libraries.filter(l=>l.name===block.library);assert.equal(matches.length,1);
 const wrapper=matches[0].full_name,root=wrapper.replace(/\.mwt$/i,'');
 assert.notEqual(root,wrapper);assert.equal(resolve(dirname(dirname(dirname(block.worksheet_file)))).toLowerCase(),resolve(root).toLowerCase());
 assert.equal(resolve(block.reference_registry).toLowerCase(),resolve(join(root,'LIST.POU')).toLowerCase());
 const files=[];
 function add(path){assert.equal(lstatSync(path).isSymbolicLink(),false);files.push({path,sha256:digest(readFileSync(path))});}
 function walk(dir){assert.equal(lstatSync(dir).isSymbolicLink(),false);for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);assert.equal(lstatSync(path).isSymbolicLink(),false);if(entry.isDirectory())walk(path);else if(entry.isFile())add(path);else throw Error('Unsupported library entry');}}
 add(wrapper);walk(root);return {files,digest:digest(JSON.stringify(files))};
}
try{
 const status=await i.verb('status',{},30000);assert.equal(resolve(status.active_project).toLowerCase(),resolve(project+'.mwt').toLowerCase());
 const args={name:'CamGenerator',library:'Cam_Toolbox_v375',baseline_saved:true};
 const tools=new Map(i.defineTools().map(t=>[t.name,t]));
 record.result=await compilerInterface(args,{
  status:()=>observe('state',()=>i.verb('compile_state',{},30000)),
  native:()=>observe('native',()=>i.verb('pou_package_snapshot',{},180000)),
  saved:()=>observe('saved',()=>i.runCode('structure_snapshot',{project})),
  interface:libs=>observe('interface',()=>i.runCode('block_interface',{project,...args,native_libraries:libs})),
  catalog:libs=>observe('catalog',()=>i.runCode('block_interface',{project,native_libraries:libs})),
  library:(block,libs)=>observe('library',async()=>library(block,libs)),
  artifacts:block=>observe('artifacts',async()=>[block.compiler_dependency,block.compiler_type_table].map(artifact)),
  build:()=>observe('build',()=>tools.get('mw_ide_build').execute({project})),
  make:()=>observe('make',()=>tools.get('mw_ide_make').execute({project})),
 });
 const checkpoint=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/startup-trial-7b8164f8-3209-4733-b042-0d69e677a2ae.json'),'utf8'));
 assert.equal(checkpoint.accepted,true);
 const native=record.events.filter(e=>e.name==='native').at(-1).result;
 const saved=record.events.filter(e=>e.name==='saved').at(-1).result;
 assert.deepEqual(native,checkpoint.native);
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(saved[key],checkpoint.after[key],key);
 assert.equal(record.result.insertion_eligible,true);assert.equal(record.result.compiler_source_binding_verified,false);
 record.accepted=true;retain();
}catch(error){record.error=String(error);retain();throw error;}
finally{await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,evidence_path:file}));}
