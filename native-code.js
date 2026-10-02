import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>stable(a)===stable(b);
const canonical=text=>text.replace(/\r\n?/g,'\n');
const sorted=rows=>rows.sort((a,b)=>a.name.localeCompare(b.name));
const inventory=s=>({pous:sorted(s.pous.map(({name,type})=>({name,type}))),tasks:sorted(s.tasks.map(({name,kind,instances})=>({name,kind,instances})))});
export async function nativeCodeChange(args,deps){
  if(args.baseline_saved!==true||(await deps.status()).is_modified!==false)throw new Error('Reconcile/save native edits before code import');
  if(!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(args.pou??''))throw new Error('Invalid POU name');
  if(typeof args.code!=='string'||typeof args.expected_body!=='string'||/[^\x09\x0a\x0d\x20-\x7e]/.test(args.code))throw new Error('Supply exact expected_body and printable ASCII ST/IL code');
  const before=await deps.saved(),live=await deps.snapshot(),body=await deps.read();
  const target=before.pous.find(p=>p.name.toLowerCase()===args.pou.toLowerCase());
  const native=live.pous.find(p=>p.name.toLowerCase()===args.pou.toLowerCase());
  const languages={ST:2,IL:1};
  if(!target||!Object.hasOwn(languages,target.language)||!native||native.language!==languages[target.language]||native.read_only)throw new Error('Target must be an existing writable ST/IL POU with matching saved/native language');
  if(!same(inventory(before),inventory(live)))throw new Error('Native/saved inventories disagree');
  if(body.body_error||typeof body.body!=='string'||canonical(body.body)!==canonical(args.expected_body))throw new Error('Saved code differs from expected_body or cannot be resolved');
  const document=await deps.document();
  const code=canonical(args.code).replace(/\n/g,'\r\n');
  const input_text=code&&!code.endsWith('\r\n')?code+'\r\n':code;
  const declarations=await deps.declarations();
  const input=await deps.prepare(input_text,target.language);
  const request={pou:target.name,language:target.language,worksheet:document.urn.split('.').at(-1),before_native:live,before_files:before.file_hashes,before_declarations:declarations,input_text,...input};
  await deps.retain({args,baseline:before,native_baseline:live,body_before:body.body,expected_body:input_text,request});
  const result=await deps.mutate(request),after=await deps.saved(),read=await deps.read(),errors=[];
  if(result.saved!==true||result.is_modified!==false)errors.push('Native save not proven');
  if(!same(result.snapshot,live))errors.push('Native structure changed');
  if(!same(await deps.declarations(),declarations))errors.push('Native declaration flags changed');
  if(!same(before.globals,after.globals)||!same(before.tasks,after.tasks))errors.push('Globals/tasks changed');
  if(!same(inventory(before),inventory(after)))errors.push('Saved structure changed');
  for(const old of before.pous){
    const current=after.pous.find(p=>p.name===old.name);
    if(old.name!==target.name&&!same(old,current))errors.push('Unrelated POU changed: '+old.name);
    if(old.name===target.name){
      const omit=({body_sha256,body_blank,identifiers,...rest})=>rest;
      if(!current||!same(omit(old),omit(current)))errors.push('Target declarations/metadata changed');
    }
  }
  const targetFile='POE/'+target.name+'/src.st1';
  const bodyExtension=target.language==='IL'?'.AB':'.STB';
  if(!same(Object.keys(before.program_sources).sort(),Object.keys(after.program_sources).sort()))errors.push('Program source inventory changed');
  const targetBefore=before.program_sources[targetFile]??{},targetAfter=after.program_sources[targetFile]??{};
  const vb=Object.keys(targetBefore).find(name=>name.toUpperCase().endsWith('.VB'));
  // Reading a new blank POU's native variable collection initializes its empty
  // Default-group storage at the next Save. Permit only this observed header,
  // with complete declarations, groups and raw native flags still unchanged.
  const initialized_empty_storage=target.variables.length===0&&vb&&targetBefore[vb]===hash('')&&targetAfter[vb]===hash('\r\n(*Group:Default*)\r\n\r\n');
  for(const [file,streams] of Object.entries(before.program_sources)){
    const omitBody=rows=>Object.fromEntries(Object.entries(rows).filter(([name])=>!name.toUpperCase().endsWith(bodyExtension)&&!(initialized_empty_storage&&name.toUpperCase().endsWith('.VB'))&&!(initialized_empty_storage&&name.toUpperCase().endsWith('.VGR'))));
    if(!same(file===targetFile?omitBody(streams):streams,file===targetFile?omitBody(after.program_sources[file]??{}):after.program_sources[file]))errors.push('Unexpected program stream change: '+file);
  }
  const translation='POE/'+target.name+'/'+request.worksheet+'Translation.xml';
  const otherTranslations=rows=>Object.fromEntries(Object.entries(rows??{}).filter(([file])=>file.toLowerCase()!==translation.toLowerCase()));
  const beforeComments=otherTranslations(before.translation_files),afterComments=otherTranslations(after.translation_files);
  const emptyNewVariableTranslation='POE/'+target.name+'/'+document.variable_worksheet+'Translation.xml';
  if(initialized_empty_storage){
    for(const file of Object.keys(afterComments)){
      if(!Object.hasOwn(beforeComments,file)&&file.toLowerCase()===emptyNewVariableTranslation.toLowerCase()&&after.empty_translation_files?.includes(file))delete afterComments[file];
    }
  }
  if(!same(beforeComments,afterComments))errors.push('Unrelated comment translations changed');
  if(read.body_error||typeof read.body!=='string'||canonical(read.body)!==canonical(input_text))errors.push('Saved code/comments differ from requested code');
  return {pou:target.name,language:target.language,action_performed:true,method:'native_dde_ChangeCodeWS',native_result:result,verification:{accepted:errors.length===0,errors,initialized_empty_storage:!!initialized_empty_storage},body:read.body,baseline:before,saved_result:after,next_step:'Fresh Build/Make; compilation and controller acceptance are separate.'};
}
