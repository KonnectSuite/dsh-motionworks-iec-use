import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {lstatSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {alignSavedNative} from './pou-package.js';

const sourceKeys=['pous','tasks','globals','program_sources','translation_files'];
const flags=['retain','pdd','opc','disabled','not_on_plc','redundant'];
export const checkpointDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source=s=>Object.fromEntries(sourceKeys.map(k=>[k,s[k]]));

// Read only paths returned by the exact native project library model.
export function libraryBaseline(libraries){
 if(!Array.isArray(libraries)||libraries.length>64)throw Error('Complete bounded native library inventory required');
 const names=new Set(),paths=new Set(),entries=[];let filesRead=0,total=0;
 function metadata(path){const m=lstatSync(path);if(m.isSymbolicLink())throw Error('Linked library entry refused');return m;}
 function add(path,files){
  const before=metadata(path);if(!before.isFile())throw Error('Regular library file required');
  total+=before.size;if(++filesRead>20000||total>256*1024*1024)throw Error('Bound library manifest exceeds limit');
  const bytes=readFileSync(path),after=statSync(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Library file changed during read');
  files.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 function walk(root,files){
  if(!metadata(root).isDirectory())throw Error('Bound library directory required');
  for(const e of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const path=join(root,e.name),m=metadata(path);
   if(m.isDirectory())walk(path,files);else if(m.isFile())add(path,files);else throw Error('Unsupported library entry');
  }
 }
 for(const library of libraries){
  if(typeof library.name!=='string'||!library.name||typeof library.logical_name!=='string'||!library.logical_name||typeof library.full_name!=='string'||!library.full_name)throw Error('Incomplete native library binding');
  const name=library.name.toLowerCase(),path=library.full_name.toLowerCase();
  if(names.has(name)||paths.has(path))throw Error('Duplicate native library binding');names.add(name);paths.add(path);
  const files=[];
  if(/\.mwt$/i.test(path)){add(library.full_name,files);walk(library.full_name.replace(/\.mwt$/i,''),files);}
  else if(/\.fwl$/i.test(path)){walk(dirname(library.full_name),files);if(!files.some(f=>f.path.toLowerCase()===path))throw Error('Bound firmware library file missing');}
  else throw Error('Unsupported native library format; complete library preservation unverified');
  entries.push({binding:library,files});
 }
 return entries;
}

export function validateCheckpointSnapshot(saved,native){
 for(const k of sourceKeys)if(saved[k]===undefined||saved[k]===null)throw Error('Incomplete saved snapshot: '+k);
 if(!Array.isArray(saved.pous)||!Array.isArray(saved.tasks)||!Array.isArray(saved.globals)||typeof saved.program_sources!=='object'||Array.isArray(saved.program_sources)||typeof saved.translation_files!=='object'||Array.isArray(saved.translation_files))throw Error('Invalid saved snapshot shape');
 if(!native?.structure||!native.declarations||!Array.isArray(native.libraries))throw Error('Incomplete native package snapshot');
 const expected=['globals',...saved.pous.map(p=>'pou:'+p.name)].sort();
 if(!same(Object.keys(native.declarations).sort(),expected))throw Error('Native declaration scope inventory incomplete');
 for(const scope of Object.values(native.declarations)){
  if(!Array.isArray(scope.variables)||!Array.isArray(scope.groups))throw Error('Native declaration/group inventory incomplete');
  for(const group of scope.groups)if(typeof group.name!=='string'||typeof group.read_only!=='boolean')throw Error('Native group metadata incomplete');
  for(const v of scope.variables)for(const f of flags)if(typeof v[f]!=='boolean')throw Error('Native declaration flag unavailable: '+f);
 }
 alignSavedNative(saved,native);
}

// No compiler, save, navigation, source mutation or rollback callback exists.
export async function captureCheckpoint(args,deps){
 if(args.baseline_saved!==true)throw Error('Reconcile saved edits before checkpoint capture/comparison');
 const beforeState=await deps.status();if(beforeState.is_modified!==false)throw Error('Unsaved/unknown native state; checkpoint unverified');
 const savedBefore=await deps.saved(),native=await deps.native();validateCheckpointSnapshot(savedBefore,native);
 const libraries=await deps.libraries(native.libraries),savedAfter=await deps.saved();
 if(!Array.isArray(libraries)||libraries.length!==native.libraries.length||libraries.some((entry,n)=>!same(entry.binding,native.libraries[n])||!Array.isArray(entry.files)||!entry.files.length||entry.files.some(f=>typeof f.path!=='string'||!f.path||! /^[a-f0-9]{64}$/.test(f.sha256??''))||new Set(entry.files.map(f=>f.path.toLowerCase())).size!==entry.files.length))throw Error('Complete bound library file manifest required');
 if(!same(source(savedBefore),source(savedAfter)))throw Error('Saved source/declaration/task/translation state changed during capture');
 const afterState=await deps.status();if(afterState.is_modified!==false)throw Error('Native state became modified during capture');
 await deps.identity();
 return {saved:source(savedAfter),native,libraries,state:afterState};
}

export function compareCheckpoint(before,current){
 const checks=Object.fromEntries(sourceKeys.map(k=>['saved.'+k,same(before.saved[k],current.saved[k])]));
 checks.native_package=same(before.native,current.native);
 checks.bound_library_files=same(before.libraries,current.libraries);
 return {accepted:Object.values(checks).every(Boolean),checks,changed:Object.keys(checks).filter(k=>!checks[k]),
  evidence_kind:'complete-saved-native-library-comparison',fresh_compile_verified:false,
  note:'Compares supported saved source streams, declarations, task settings, translations, full native package and all bound library files. Excludes compiler output and root IDE logs/bookkeeping; does not prove runtime behavior or a fresh Build.'};
}
