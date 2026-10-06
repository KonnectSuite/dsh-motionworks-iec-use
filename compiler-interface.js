import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {readFileSync,readdirSync,lstatSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
const keys=['pous','tasks','globals','program_sources','translation_files'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source=s=>Object.fromEntries(keys.map(k=>[k,s[k]]));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);

export function compilerArtifacts(block,project){
 return [block.compiler_dependency,block.compiler_type_table].map(path=>{
  if(lstatSync(path).isSymbolicLink()||!realpathSync(path).toLowerCase().startsWith(realpathSync(project).toLowerCase()+sep))throw Error('Compiler artifact outside exact project');
  const before=statSync(path),bytes=readFileSync(path),after=statSync(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Compiler artifact changed during read');
  return {path,modified_ms:after.mtimeMs,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
}
export function compiledLibraryManifest(block,libraries){
 const matches=libraries.filter(l=>l.name===block.library);
 if(matches.length!==1)throw Error('Exact native library binding required');
 const wrapper=matches[0].full_name,root=wrapper.replace(/\.mwt$/i,'');
 if(root===wrapper||resolve(dirname(dirname(dirname(block.worksheet_file)))).toLowerCase()!==resolve(root).toLowerCase()||resolve(block.reference_registry).toLowerCase()!==resolve(join(root,'LIST.POU')).toLowerCase())throw Error('Compiled source/cache root differs from bound native library');
 const files=[];let total=0;
 function add(path){
  if(lstatSync(path).isSymbolicLink())throw Error('Linked library file refused');
  const before=statSync(path);total+=before.size;
  if(files.length>=10000||total>256*1024*1024)throw Error('Library manifest exceeds bound');
  const bytes=readFileSync(path),after=statSync(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Library file changed during read');
  files.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 function walk(dir){
  if(lstatSync(dir).isSymbolicLink())throw Error('Linked library directory refused');
  for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(lstatSync(path).isSymbolicLink())throw Error('Linked library entry refused');if(entry.isDirectory())walk(path);else if(entry.isFile())add(path);else throw Error('Unsupported library entry');}
 }
 add(wrapper);walk(root);return {files,digest:digest(files)};
}

// This proves the current project's compiled contract, not protected source
// decoding or regeneration of the installed library's own cache.
export async function compilerInterface(args,deps){
 if(args.baseline_saved!==true||!args.name||!args.library)throw Error('Exact block/library and saved baseline required');
 const state=await deps.status();
 if(state.is_modified!==false)throw Error('Reconcile native edits before compiler interface verification');
 const native=await deps.native(),before=await deps.saved();
 const block=await deps.interface(native.libraries),catalog=await deps.catalog(native.libraries);
 if(block.evidence_kind!=='installed-compiled-block-interface'||block.insertion_eligible!==false||block.kind!=='FUNCTION_BLOCK'||block.hidden||block.name!==args.name||block.library!==args.library||block.compiler_pin_types_verified!==true)throw Error('Complete diagnostic compiled interface required');
 for(const field of ['source_sha256','registry_sha256','worksheet_sha256','cache_sha256','compiler_dependency_sha256','compiler_type_table_sha256'])if(!hash(block[field]))throw Error('Incomplete compiled provenance: '+field);
 for(const field of ['source_file','reference_registry','worksheet_file','cache_file','compiler_dependency','compiler_type_table'])if(typeof block[field]!=='string'||!block[field])throw Error('Incomplete compiled path: '+field);
 if(!Array.isArray(block.pins)||!block.pins.length||!Number.isInteger(block.source_declaration_count)||block.source_declaration_count<block.pins.length||!Number.isInteger(block.compiler_declaration_count)||block.compiler_declaration_count<block.source_declaration_count)throw Error('Incomplete compiled declaration counts');
 const bound=native.libraries.filter(l=>l.name===block.library);if(bound.length!==1)throw Error('Exact native library absent or ambiguous');
 if(catalog.unavailable_libraries?.length)throw Error('Incomplete installed block catalog cannot prove unique binding');
 const matches=catalog.blocks.filter(b=>b.name.toLowerCase()===block.name.toLowerCase());
 if(matches.length!==1||matches[0].library!==block.library||matches[0].kind!=='FUNCTION_BLOCK')throw Error('Compiled block binding is ambiguous across project/libraries');
 const library=await deps.library(block,native.libraries),artifacts=await deps.artifacts(block);
 if(!library.files?.length||!hash(library.digest)||artifacts.length!==2||artifacts.some(a=>!hash(a.sha256)||!Number.isFinite(a.modified_ms)))throw Error('Complete library and compiler artifact baseline required');
 const started=Date.now(),build=await deps.build();
 if(build.fresh_compile!==true||build.settled!==true||build.is_compiled!==true)throw Error('Fresh native Build not verified; no automatic retry');
 const make=await deps.make();
 const ended=Date.now();
 if(make.is_compiled!==true||make.is_modified!==false)throw Error('Native Make did not settle the saved compiler state');
 const currentNative=await deps.native(),after=await deps.saved();
 if(!same(source(before),source(after))||!same(native,currentNative))throw Error('Sources/native declarations, groups, tasks or libraries changed during verification');
 const current=await deps.interface(currentNative.libraries),currentLibrary=await deps.library(current,currentNative.libraries),fresh=await deps.artifacts(current);
 if(!same(library,currentLibrary))throw Error('Installed library changed during native Build');
 for(const field of ['name','library','kind','hidden','source_file','source_sha256','registry_sha256','worksheet_file','worksheet_sha256','cache_file','cache_sha256','compiler_dependency','compiler_type_table','pins','source_declaration_count','compiler_declaration_count'])if(!same(block[field],current[field]))throw Error('Compiled interface identity/declarations changed: '+field);
 if(current.compiler_pin_types_verified!==true||fresh.length!==2||fresh.some((a,n)=>a.path!==artifacts[n].path||a.modified_ms<=artifacts[n].modified_ms||a.modified_ms<started-2000||a.modified_ms>ended+2000||!hash(a.sha256)))throw Error('Exact compiler dependency/type table not regenerated by this Build/Make sequence');
 const finalStatus=await deps.status();
 if(finalStatus.is_compiled!==true||finalStatus.is_modified!==false)throw Error('Native state changed after compiler interface verification');
 return {...current,evidence_kind:'fresh-bound-compiled-block-interface',
  project_compiler_freshness_verified:true,compiler_library_binding_verified:true,
  compiler_source_binding_verified:false,compiler_cache_freshness_verified:false,
  insertion_eligible:true,compile_acceptance_only:true,action_performed:true,bound_library:bound[0],
  source_baseline_digest:digest(source(before)),library_manifest_digest:library.digest,
  verified_at_ms:Date.now(),compiler_artifacts:fresh,compiler_started_at_ms:started,compiler_completed_at_ms:ended,build,make,
  note:'Current native compiled contract matched the unique bound installed block and its complete explicit cached declarations, with complete source/native/library preservation. Eligible only for this compiled contract; protected worksheet decoding and library-cache regeneration are not proved. Fresh Build/Make of each inserted call remains required.'};
}
