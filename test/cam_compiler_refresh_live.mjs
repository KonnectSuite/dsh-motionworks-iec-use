// Opt-in native Build evidence on the sole authorized disposable fixture.
// A refreshed project cache does not itself prove the library cache's source binding.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,readdirSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','cam-compiler-refresh-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false,source_binding_verified:false,insertion_eligible:false};
const digest=b=>createHash('sha256').update(b).digest('hex');
const sourceDigest=s=>digest(JSON.stringify(Object.fromEntries(['pous','tasks','globals','program_sources','translation_files'].map(k=>[k,s[k]]))));
function files(root){
 const result={};
 function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);assert.equal(lstatSync(path).isSymbolicLink(),false);
  if(entry.isDirectory())walk(path);else if(entry.isFile())result[path]=digest(readFileSync(path));
 }}
 walk(root);return result;
}
function artifact(path){const s=statSync(path);return {path,sha256:digest(readFileSync(path)),mtime_ms:s.mtimeMs,size:s.size};}
try{
 const baseline=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/arya-engineering-lifecycle.json'),'utf8'));
 assert.equal(baseline.project,project);
 const before=await i.runCode('structure_snapshot',{project});
 record.source_digest_before=sourceDigest(before);
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(before[key],baseline.saved[key],key);
 record.native_before=await i.verb('structure_snapshot',{},180000);assert.deepEqual(record.native_before,baseline.native);
 record.state_before=await i.verb('compile_state',{},30000);assert.equal(record.state_before.is_modified,false);assert.equal(record.state_before.is_compiled,true);
 const tool=i.defineTools().find(t=>t.name==='mw_code_block_interface');
 const args={project,name:'CamGenerator',library:'Cam_Toolbox_v375'};
 record.interface_before=await tool.execute(args);
 assert.equal(record.interface_before.insertion_eligible,false);
 const library=dirname(dirname(record.interface_before.worksheet_file));
 // worksheet_file is library/POE/CamGenerator/src.st1; include the entire library.
 const libraryRoot=dirname(library);
 const libraryBefore=files(libraryRoot);
 record.library_root=libraryRoot;
 record.library_file_count=Object.keys(libraryBefore).length;
 record.library_digest_before=digest(JSON.stringify(libraryBefore));
 const paths=[record.interface_before.compiler_dependency,record.interface_before.compiler_type_table,record.interface_before.cache_file];
 record.artifacts_before=paths.map(artifact);
 record.build_requested_at=new Date().toISOString();
 record.build=await i.defineTools().find(t=>t.name==='mw_ide_build').execute({});
 record.build_returned_at=new Date().toISOString();
 record.artifacts_after=paths.map(artifact);
 record.interface_after=await tool.execute(args);
 record.state_after=await i.verb('compile_state',{},30000);
 record.native_after=await i.verb('structure_snapshot',{},180000);
 const after=await i.runCode('structure_snapshot',{project});
 record.source_digest_after=sourceDigest(after);
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(after[key],before[key],key);
 assert.deepEqual(record.native_after,record.native_before);
 const libraryAfter=files(libraryRoot);
 record.library_digest_after=digest(JSON.stringify(libraryAfter));
 assert.deepEqual(libraryAfter,libraryBefore,'complete installed library unchanged');
 record.sources_unchanged=true;record.library_unchanged=true;
 assert.equal(record.state_after.is_modified,false);assert.equal(record.state_after.is_compiled,true);
 assert.equal(record.interface_after.insertion_eligible,false);
 assert.equal(record.interface_after.compiler_source_binding_verified,false);
 assert.deepEqual(record.interface_after.pins,record.interface_before.pins);
 record.project_artifacts_rewritten=record.artifacts_after.slice(0,2).every((a,n)=>a.mtime_ms>record.artifacts_before[n].mtime_ms&&a.mtime_ms>=Date.parse(record.build_requested_at)-2000&&a.mtime_ms<=Date.parse(record.build_returned_at)+2000);
 record.accepted=record.build.fresh_compile===true&&record.build.settled===true&&record.project_artifacts_rewritten;
 console.log(JSON.stringify({evidence:file,accepted:record.accepted,build:record.build.evidence_kind,project_artifacts_rewritten:record.project_artifacts_rewritten,sources_unchanged:true,library_unchanged:true,source_binding_verified:false,insertion_eligible:false}));
}catch(error){record.error=error.message;throw error;}
finally{writeFileSync(file,JSON.stringify(record,null,2));await i.stopBridge();}
