import {isDeepStrictEqual as same} from 'node:util';
const sourceKeys=['pous','tasks','globals','program_sources','translation_files'];
const identical=(before,after)=>sourceKeys.every(k=>same(before[k],after[k]));
const exact=(rows,name)=>rows.find(p=>p.name===name);
const prefix=(file,name)=>file.replaceAll('\\','/').toLowerCase().startsWith('poe/'+name.toLowerCase()+'/');
function aligned(saved,native){
 const fields=['name','type','section','group','address','initial_value','description'];
 const projectRows=rows=>rows.map(v=>Object.fromEntries(fields.map(k=>[k,k==='description'?(v[k]?.trim()||null):v[k]??null]))).sort((a,b)=>a.name.localeCompare(b.name));
 // COM omits worksheet comments on externals. Verify those through the exact
 // saved translation/body baseline, while preserving raw native rows separately.
 const declarationRows=rows=>projectRows(rows.map(v=>v.section==='VAR_EXTERNAL'?{...v,description:null}:v));
 if(saved.pous.length!==native.structure.pous.length||!same(projectRows(saved.globals),projectRows(native.declarations.globals.variables)))throw Error('Saved/native package inventories or globals disagree');
 for(const pou of saved.pous){
  const meta=exact(native.structure.pous,pou.name),declarations=native.declarations['pou:'+pou.name];
  if(!meta||meta.type!==pou.type||meta.language!==({ST:2,FBD:3,LD:4}[pou.language])||!declarations||!same(declarationRows(pou.variables),declarationRows(declarations.variables)))throw Error('Saved/native POU declaration identity disagrees: '+pou.name);
 }
 const tasks=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(({name,kind,instances})=>({name,kind,instances}));
 if(!same(tasks(saved.tasks),tasks(native.structure.tasks)))throw Error('Saved/native task inventories disagree');
}

export async function exportPouPackage(args,deps){
 if(args.baseline_saved!==true)throw Error('Reconcile/save edits before native export');
 if(!/^[A-Za-z_][A-Za-z_0-9]{0,29}$/.test(args.pou??''))throw Error('Exact POU name required');
 if((await deps.status()).is_modified!==false)throw Error('Unsaved or unknown native baseline');
 const saved=await deps.saved(),native=await deps.snapshot(),pou=exact(saved.pous,args.pou),meta=exact(native.structure.pous,args.pou);
 aligned(saved,native);
 if(!pou||!meta||meta.read_only||!['ST','LD','FBD'].includes(pou.language))throw Error('Exact writable supported POU required');
 const result=await deps.mutate({operation:'export',pou:args.pou,before_state:native,before_files:saved.file_hashes});
 const after=await deps.saved(),afterNative=await deps.snapshot(),status=await deps.status();
 if(result.return_code!==0||status.is_modified!==false||!identical(saved,after)||!same(native,afterNative))throw Error('Native export or complete source/declaration preservation unverified');
 const manifest=await deps.manifest();
 if(!manifest.length||!manifest.some(f=>f.path.toLowerCase()==='pou.tre')||!manifest.some(f=>f.path.toLowerCase()===args.pou.toLowerCase()+'/src.st1'))throw Error('Native package inventory incomplete');
 return {saved,native,pou,meta,manifest,result};
}

export async function importPouPackage(args,receipt,deps){
 if(args.baseline_saved!==true||args.dependencies_reviewed!==true)throw Error('Saved baseline and dependency review required');
 if(receipt.used)throw Error('Package import was already attempted; inspect retained evidence');
 if((await deps.status()).is_modified!==false)throw Error('Unsaved or unknown native baseline');
 const before=await deps.saved(),native=await deps.snapshot(),name=receipt.pou.name;
 aligned(before,native);
 if(before.pous.some(p=>p.name.toLowerCase()===name.toLowerCase())||native.structure.pous.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('POU name already exists; package import never overwrites');
 if(!same(receipt.manifest,await deps.manifest()))throw Error('Native package changed since export');
 if(!same(native.libraries,receipt.native.libraries))throw Error('Native library bindings changed; inspect dependencies');
 for(const v of receipt.pou.variables.filter(v=>v.section==='VAR_EXTERNAL')){
  if(!before.globals.some(g=>g.name.toUpperCase()===v.name.toUpperCase()&&g.type.toUpperCase()===v.type.toUpperCase()))throw Error('Missing/mismatched external: '+v.name);
 }
 await deps.consume();
 const result=await deps.mutate({operation:'import',pou:name,before_state:native,before_files:before.file_hashes,package_manifest:receipt.manifest});
 const after=await deps.saved(),afterNative=await deps.snapshot(),status=await deps.status(),errors=[];
 if(result.return_code!==0||result.saved!==true||status.is_modified!==false)errors.push('Native import/save not proven');
 if(!same(receipt.pou,exact(after.pous,name)))errors.push('Imported body/declarations differ from native export');
 if(!same([...before.pous,receipt.pou].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),after.pous))errors.push('Saved POU inventory/collateral differs from plan');
 for(const key of ['tasks','globals'])if(!same(before[key],after[key]))errors.push('Unrelated '+key+' changed');
 for(const key of ['program_sources','translation_files']){
  for(const file of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
   const expected=prefix(file,name)?receipt.saved[key][file]:before[key][file];
   if(!same(expected,after[key][file]))errors.push('Source/translation differs: '+file);
  }
  for(const file of Object.keys(receipt.saved[key]).filter(f=>prefix(f,name)))if(!same(receipt.saved[key][file],after[key][file]))errors.push('Imported source missing/different: '+file);
 }
 const expectedNative=structuredClone(native);expectedNative.structure.pous.push(receipt.meta);
 expectedNative.declarations['pou:'+name]=receipt.native.declarations['pou:'+name];
 if(!same(expectedNative,afterNative))errors.push('Complete native metadata/groups/declaration flags differ from plan');
 return {accepted:!errors.length,errors,result,before,after,native_before:native,native_after:afterNative};
}
