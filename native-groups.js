import {isDeepStrictEqual as same} from 'node:util';
const fields=['name','type','section','group','address','initial_value','description'];
const flags=['retain','pdd','opc','disabled','not_on_plc','redundant'];
const projection=rows=>rows.map(v=>Object.fromEntries(fields.map(k=>[k,k==='description'?(v[k]?.trim()||null):k==='group'?v[k]?.trim():v[k]??null]))).sort((a,b)=>a.name.localeCompare(b.name));
const fold=name=>name.toLowerCase();
export function groupPlan(args,before,live){
 if(args.pou!==undefined&&(typeof args.pou!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(args.pou)))throw Error('Exact POU identifier required; omit pou only for globals');
 if(!['create','rename','delete'].includes(args.operation))throw Error('Unsupported group operation');
 if(typeof args.name!=='string'||!args.name.trim()||args.name.length>255||/[\x00-\x1f]/.test(args.name))throw Error('Exact nonempty group name required');
 if(args.operation==='delete'&&args.user_approved!==true)throw Error('Explicit empty-group deletion approval required');
 if(args.operation!=='rename'&&args.new_name!==undefined)throw Error('new_name applies only to rename');
 const destination=args.operation==='rename'?args.new_name:args.name;
 if(args.operation!=='delete'&&(typeof destination!=='string'||destination!==destination.trim()||!destination||destination.length>255||/[\x00-\x1f]/.test(destination)))throw Error('New group name must be nonempty, trimmed and contain no control characters');
 if(!Array.isArray(live.variables)||!Array.isArray(live.groups)||live.groups.some(g=>typeof g.name!=='string'||!g.name.trim()||typeof g.read_only!=='boolean')||live.variables.some(v=>flags.some(k=>typeof v[k]!=='boolean')))throw Error('Complete native groups and declaration flags required');
 if(new Set(live.groups.map(g=>fold(g.name.trim()))).size!==live.groups.length)throw Error('Ambiguous native group inventory');
 const pou=args.pou?before.pous.find(p=>p.name===args.pou):null;
 if(args.pou&&(!pou||live.structure.pous.find(p=>p.name===args.pou)?.read_only!==false))throw Error('Exact writable POU required');
 const savedRows=args.pou?pou.variables:before.globals;
 if(!same(projection(savedRows),projection(live.variables)))throw Error('Saved/native declarations disagree; no group action');
 const inventories=rows=>rows.map(({name,type,language})=>({name,type,language})).sort((a,b)=>a.name.localeCompare(b.name));
 if(!same(inventories(before.pous.map(p=>({...p,language:{IL:1,ST:2,FBD:3,LD:4}[p.language]}))),inventories(live.structure.pous)))throw Error('Saved/native POU inventories disagree');
 const tasks=rows=>rows.map(({name,kind,instances})=>({name,kind,instances})).sort((a,b)=>a.name.localeCompare(b.name));
 if(!same(tasks(before.tasks),tasks(live.structure.tasks)))throw Error('Saved/native task inventories disagree');
 const sheets={globals:before.globals,...Object.fromEntries(before.pous.map(p=>['pou:'+p.name,p.variables]))};
 if(!live.group_membership||!same(Object.keys(sheets).sort(),Object.keys(live.group_membership).sort()))throw Error('Complete native group membership inventory required');
 for(const [key,rows] of Object.entries(sheets)){
  const groups=live.group_membership[key];
  if(!Array.isArray(groups)||groups.some(g=>typeof g.name!=='string'||!g.name.trim()||typeof g.read_only!=='boolean'||!Array.isArray(g.members)||g.members.some(name=>typeof name!=='string'||!name)))throw Error('Complete group metadata required');
  if(new Set(groups.map(g=>fold(g.name.trim()))).size!==groups.length)throw Error('Ambiguous native group inventory: '+key);
  const memberRows=groups.flatMap(g=>g.members.map(name=>({name,group:g.name.trim()}))).sort((a,b)=>a.name.localeCompare(b.name));
  if(!same(memberRows,rows.map(v=>({name:v.name,group:v.group?.trim()})).sort((a,b)=>a.name.localeCompare(b.name))))throw Error('Saved/native group membership disagrees: '+key);
 }
 const key=args.pou?'pou:'+args.pou:'globals';
 if(!same(live.group_membership[key].map(({name,read_only})=>({name,read_only})),live.groups))throw Error('Target group metadata disagrees');
 const target=live.groups.find(g=>g.name===args.name);
 if(args.operation==='create'&&live.groups.some(g=>fold(g.name)===fold(args.name)))throw Error('Group already exists');
 if(args.operation!=='create'&&(!target||target.read_only!==false))throw Error('Exact writable group required');
 if(args.operation==='rename'&&live.groups.some(g=>g!==target&&fold(g.name)===fold(destination)))throw Error('Destination group already exists');
 if(args.operation==='rename'&&target.name===destination)throw Error('Group already has requested name');
 const members=live.variables.filter(v=>v.group===args.name);
 if(live.variables.some(v=>!live.groups.some(g=>g.name===v.group)))throw Error('Native variable has unknown group');
 if(args.operation==='delete'&&(members.length||live.groups.length<=1))throw Error('Delete requires an empty group and another remaining group');
 const expected=structuredClone(live),savedExpected=structuredClone(before);
 if(args.operation==='create'){expected.groups.push({name:destination,read_only:false});expected.group_membership[key].push({name:destination,read_only:false,members:[]});}
 if(args.operation==='delete'){expected.groups=expected.groups.filter(g=>g.name!==args.name);expected.group_membership[key]=expected.group_membership[key].filter(g=>g.name!==args.name);}
 if(args.operation==='rename'){
  expected.groups.find(g=>g.name===args.name).name=destination;
  expected.group_membership[key].find(g=>g.name===args.name).name=destination;
  for(const v of expected.variables)if(v.group===args.name)v.group=destination;
  const names=new Set(members.map(v=>v.name));
  for(const v of args.pou?savedExpected.pous.find(p=>p.name===args.pou).variables:savedExpected.globals)if(names.has(v.name)&&v.group?.trim()===args.name.trim())v.group=destination;
 }
 const prefix=args.pou?`poe/${args.pou.toLowerCase()}/`:'c/configuration/r/resource/';
 const sources=Object.entries(before.program_sources).filter(([path])=>path.replaceAll('\\','/').toLowerCase().startsWith(prefix));
 if(sources.length!==1)throw Error('Exact declaration source container required');
 const [source,streams]=sources[0],vb=Object.keys(streams).filter(s=>s.toUpperCase().endsWith('.VB'));
 if(vb.length!==1)throw Error('Exact variable worksheet stream required');
 return {expected,savedExpected,members,source,allowed:new Set([vb[0],vb[0].slice(0,-3)+'.VGR'])};
}
export async function nativeGroupChange(args,deps){
 if(args.baseline_saved!==true||(await deps.status()).is_modified!==false)throw Error('Reconcile/save native edits before group changes');
 const before=await deps.saved(),live=await deps.snapshot(),plan=groupPlan(args,before,live);
 await deps.retain({before,live,expected:plan.expected,members:plan.members,source:plan.source});
 const result=await deps.mutate({...args,before_state:live,expected_state:plan.expected,before_files:before.file_hashes});
 const after=await deps.saved(),nativeAfter=await deps.snapshot(),state=await deps.status(),errors=[];
 if(result.saved!==true||result.is_modified!==false||state.is_modified!==false)errors.push('Native save completion unverified');
 if(!same(plan.expected,nativeAfter))errors.push('Native groups, declaration flags, structure or libraries differ from plan');
 for(const key of ['pous','tasks','globals','translation_files'])if(!same(plan.savedExpected[key],after[key]))errors.push('Saved '+key+' differs from plan');
 for(const path of new Set([...Object.keys(before.program_sources),...Object.keys(after.program_sources)])){
  const old=before.program_sources[path],now=after.program_sources[path];
  if(path!==plan.source){if(!same(old,now))errors.push('Unrelated program streams changed: '+path);continue;}
  for(const stream of new Set([...Object.keys(old??{}),...Object.keys(now??{})]))if(!plan.allowed.has(stream)&&old?.[stream]!==now?.[stream])errors.push('Unrelated worksheet stream changed: '+stream);
 }
 return {accepted:!errors.length,operation:args.operation,action_performed:true,member_count:plan.members.length,errors,before,after,native_before:live,native_after:nativeAfter};
}
