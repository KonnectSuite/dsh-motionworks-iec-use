import {isDeepStrictEqual as same} from 'node:util';
import {alignSavedNative} from './pou-package.js';
const sourceKeys=['pous','tasks','globals','program_sources','translation_files'];
const exact=(saved,name)=>saved.pous.find(p=>p.name===name);
const identical=(a,b)=>sourceKeys.every(k=>same(a[k],b[k]));
const inside=(file,name)=>file.replaceAll('\\','/').toLowerCase().startsWith('poe/'+name.toLowerCase()+'/');

// Native conversion replaces a POU's source language. It is never a text write
// into a graphical container, and compile success does not prove canvas wiring.
export async function convertPou(args,deps){
 if(args.baseline_saved!==true||args.conversion_reviewed!==true)throw Error('Saved baseline and explicit conversion review required');
 if(!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(args.pou??'')||!['FBD','LD'].includes(args.language))throw Error('Exact POU and FBD/LD destination required');
 if(!/^[a-f0-9]{64}$/.test(args.expected_body_sha256??''))throw Error('Exact saved body SHA-256 required');
 const state=await deps.status();if(state.is_modified!==false)throw Error('Unsaved or unknown native baseline');
 const before=await deps.saved(),native=await deps.snapshot(),pou=exact(before,args.pou),meta=native.structure.pous.find(p=>p.name===args.pou);
 alignSavedNative(before,native);
 const flags=['retain','pdd','opc','disabled','not_on_plc','redundant'];
 if(Object.values(native.declarations).some(sheet=>!Array.isArray(sheet.variables)||!Array.isArray(sheet.groups)||sheet.variables.some(v=>flags.some(k=>typeof v[k]!=='boolean'))||sheet.groups.some(g=>typeof g.read_only!=='boolean')))throw Error('Complete native declaration flags/groups are unknown');
 if(!pou||!meta||meta.read_only!==false||!['ST','FBD','LD'].includes(pou.language)||pou.language===args.language)throw Error('Exact writable POU in a different supported language required');
 if(pou.body_sha256!==args.expected_body_sha256)throw Error('Stale POU body; inspect current source before conversion');
 const build_started_ms=Date.now();
 const build=await deps.build(),compiled=await deps.saved(),compiledNative=await deps.snapshot(),compiledState=await deps.status();
 if(!identical(before,compiled)||!same(native,compiledNative))throw Error('Fresh Build changed saved/native source baseline');
 if(build.is_compiled!==true||build.evidence_kind!=='observed_compile_transition'||compiledState.is_compiled!==true||compiledState.is_modified!==false)throw Error('Fresh compiled saved state unverified');
 const source=await deps.source();
 if(source.pou!==args.pou||source.language!==pou.language||!Array.isArray(source.artifacts)||source.artifacts.length!==4||source.artifacts.some(a=>!Number.isFinite(a.modified_ms)||a.modified_ms<build_started_ms||a.modified_ms>Date.now()))throw Error('Exact source POU compiler artifacts were not regenerated during this Build');
 const result=await deps.mutate({pou:args.pou,language:args.language,before_state:compiledNative,before_files:compiled.file_hashes});
 const after=await deps.saved(),afterNative=await deps.snapshot(),afterState=await deps.status(),errors=[];
 const converted=exact(after,args.pou);
 if(result.name!==args.pou||result.saved!==true||result.language!==({FBD:3,LD:4}[args.language])||afterState.is_modified!==false)errors.push('Native conversion/save not proven');
 if(!converted||converted.language!==args.language||converted.type!==pou.type||converted.return_type!==pou.return_type||!same(converted.variables,pou.variables))errors.push('Converted language/type/declarations differ from plan');
 if(pou.body_blank===false&&converted?.body_blank!==false)errors.push('Populated source became blank');
 if(!same(before.pous.filter(p=>p.name!==args.pou),after.pous.filter(p=>p.name!==args.pou)))errors.push('Unrelated POU changed');
 for(const key of ['tasks','globals'])if(!same(before[key],after[key]))errors.push('Unrelated '+key+' changed');
 for(const key of ['program_sources','translation_files'])for(const file of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
  if(!inside(file,args.pou)&&!same(before[key][file],after[key][file]))errors.push('Unrelated source/translation changed: '+file);
 }
 const expectedNative=structuredClone(native);expectedNative.structure.pous.find(p=>p.name===args.pou).language=({FBD:3,LD:4}[args.language]);
 if(!same(expectedNative,afterNative))errors.push('Native inventory, libraries, groups or declaration flags differ from plan');
 const verification={accepted:!errors.length,errors};
 if(errors.length)return {verification,result,build,before,after,native_before:native,native_after:afterNative};
 // A separate fresh Build verifies the generated graphical source, with all
 // artifact identities and source preservation checked by graphicalListing.
 const listing=await deps.listing(),final=await deps.saved(),finalNative=await deps.snapshot();
 if(listing.accepted!==true||listing.compiler_cache_freshness_verified!==true||!identical(after,final)||!same(afterNative,finalNative))throw Error('Converted source compilation/listing or final native preservation unverified');
 return {verification,result,build,source,build_started_ms,listing,before,after,native_before:native,native_after:afterNative,layout_verified:false,wiring_verified:false};
}
