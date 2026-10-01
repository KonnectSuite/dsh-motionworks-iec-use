const eq=(a,b)=>a.toUpperCase()===b.toUpperCase();
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>stable(a)===stable(b);
const sorted=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name));
const inventory=s=>({pous:sorted(s.pous.map(({name,type})=>({name,type}))),tasks:sorted(s.tasks.map(({name,kind,instances})=>({name,kind,instances})))});
const identifier=(name,max=30)=>typeof name==='string'&&new RegExp(`^[A-Za-z_][A-Za-z0-9_]{0,${max-1}}$`).test(name);
const byName=(rows,name)=>rows.find(r=>eq(r.name,name??''));
function references(saved,name){
  const found=[];
  for(const p of saved.pous){
    if(eq(p.name,name))continue;
    // references_reviewed also covers graphical/indirect calls, which this
    // saved ST scan cannot prove absent. Preserve that limitation in evidence.
    if(p.identifiers.includes(name.toUpperCase())||p.variables.some(v=>new RegExp(`\\b${name}\\b`,'i').test(v.type)))found.push(p.name);
  }
  if(saved.globals.some(v=>new RegExp(`\\b${name}\\b`,'i').test(v.type)))found.push('resource globals');
  if(saved.tasks.some(t=>t.instances.some(i=>eq(i.type,name))))found.push('task assignment');
  return found;
}
export function structurePlan(scope,args,saved,live){
  const native=structuredClone(live),op=args.operation;
  if(!identifier(args.name,scope==='task'?7:30))throw new Error('Invalid native object name');
  const target=byName(scope==='pou'?native.pous:native.tasks,args.name);
  const plan={native,target,affected:[]};
  if(scope==='pou'){
    if(!['create','copy','rename','delete'].includes(op))throw new Error('Unknown POU operation');
    if(op==='create'){
      if(target)throw new Error('POU already exists');
      const type=args.pou_type??'PROGRAM';
      if(!['PROGRAM','FUNCTION_BLOCK','FUNCTION'].includes(type))throw new Error('Unknown POU type');
      if(type==='FUNCTION'&&!identifier(args.return_type))throw new Error('Function requires a simple explicit return type');
      if(type!=='FUNCTION'&&args.return_type)throw new Error('Return type applies only to functions');
      native.pous.push({name:args.name,type,language:2,plc_type:'',processor_type:'',read_only:false});
      plan.affected=[args.name];
    }else{
      if(!target||target.read_only)throw new Error('POU missing or read-only');
      if(op==='copy'||op==='rename'){
        if(!identifier(args.new_name)||byName(native.pous,args.new_name))throw new Error('New POU name invalid or already exists');
        plan.affected=[args.new_name,...(op==='rename'?[target.name]:[])];
      }
      if(op==='rename'||op==='delete'){
        if(args.references_reviewed!==true||op==='delete'&&args.user_approved!==true)throw new Error('Explicit reference review/deletion approval required');
        const refs=references(saved,target.name);
        if(refs.length)throw new Error('POU has remaining references: '+refs.join(', '));
      }
      if(op==='copy')native.pous.push({...target,name:args.new_name});
      if(op==='rename')target.name=args.new_name;
      if(op==='delete'){native.pous=native.pous.filter(p=>p!==target);plan.affected=[target.name];}
    }
  }else{
    if(!['create','edit','delete','assign','unassign'].includes(op))throw new Error('Unknown task operation');
    if(op==='create'){
      if(target)throw new Error('Task already exists');
      const kind=args.kind??'CYCLIC';
      if(!['CYCLIC','DEFAULT','SYSTEM'].includes(kind))throw new Error('Unknown task kind');
      native.tasks.push({name:args.name,kind,instances:[]});
    }else{
      if(!target)throw new Error('Task missing');
      if(op==='delete'){
        if(args.user_approved!==true)throw new Error('Task deletion approval required');
        if(target.instances.length)throw new Error('Unassign programs before deleting task');
        native.tasks=native.tasks.filter(t=>t!==target);
      }
      if(op==='assign'){
        const pou=byName(native.pous,args.pou),instance=args.instance??args.pou;
        if(!pou||pou.type!=='PROGRAM'||!identifier(instance)||byName(target.instances,instance))throw new Error('Invalid program or duplicate instance');
        target.instances.push({name:instance,type:pou.name});
      }
      if(op==='unassign'){
        if(args.user_approved!==true)throw new Error('Unassignment approval required');
        const instance=byName(target.instances,args.instance);
        if(!instance)throw new Error('Exact instance missing');
        target.instances=target.instances.filter(i=>i!==instance);
      }
      if(op==='edit'){
        const old=byName(saved.tasks,args.name).settings,changes=args.settings_changes;
        if(!changes||!Object.keys(changes).length)throw new Error('Supply task settings changes');
        for(const [key,value] of Object.entries(changes)){
          if(!Object.hasOwn(old,key)||typeof value!=='string'||/[^\x20-\x7e]|[,;():=]/.test(value))throw new Error('Unsupported task setting field/value');
          if(key==='INTERVAL'&&(!/^T#[0-9]+(?:\.[0-9]+)?(?:ns|us|ms|s|m|h)$/i.test(value)||Number(value.slice(2).replace(/[a-z]+$/i,''))<=0))throw new Error('Invalid cyclic interval');
          if(key==='PRIORITY'&&!/^\d+$/.test(value))throw new Error('Invalid task priority');
          if(key==='WATCHDOG'&&!/^\d+$/.test(value))throw new Error('Invalid watchdog');
          if(key==='WATCHDOG_ENABLED'&&!['YES','NO'].includes(value))throw new Error('Invalid watchdog state');
        }
        plan.settings={...old,...changes};
        if(!['CYCLIC','DEFAULT','SYSTEM'].includes(plan.settings.TYPE))throw new Error('Invalid task type');
        target.kind=plan.settings.TYPE;
        plan.settings_text=`TASK ${target.name}\r\n(`+Object.entries(plan.settings).map(([k,v])=>`${k} := ${v}`).join(',\r\n')+'\r\n);\r\n';
      }
    }
  }
  return plan;
}
export async function nativeStructureChange(scope,args,{status,saved,snapshot,mutate,prepareSettings,retainPlan}){
  if(args.baseline_saved!==true||(await status()).is_modified!==false)throw new Error('Reconcile/save native edits before structural changes');
  const before=await saved(),live=await snapshot();
  if(!same(inventory(before),inventory(live)))throw new Error('Saved and native structural inventories disagree');
  const plan=structurePlan(scope,args,before,live);
  const settings=plan.settings_text?await prepareSettings(plan.settings_text):{};
  if(retainPlan)await retainPlan({scope,args,baseline:before,native_baseline:live,expected_native:plan.native,expected_settings:plan.settings});
  const result=await mutate({...args,scope,before_native:live,before_files:before.file_hashes,expected_native:plan.native,...settings});
  const after=await saved(),errors=[];
  if(!same(result.snapshot,plan.native))errors.push('Complete native result differs from plan');
  if(!same(inventory(after),inventory(plan.native)))errors.push('Saved structural inventory differs from plan');
  if(result.saved!==true||result.is_modified!==false)errors.push('Native save not proven');
  if(!same(before.globals,after.globals))errors.push('Global declarations changed unexpectedly');
  for(const old of before.pous){
    if(plan.affected.some(n=>eq(n,old.name)))continue;
    if(!same(old,byName(after.pous,old.name)))errors.push('Unrelated POU changed: '+old.name);
  }
  for(const [file,streams] of Object.entries(before.program_sources)){
    if(plan.affected.some(n=>file.toLowerCase().startsWith('poe/'+n.toLowerCase()+'/')))continue;
    if(!same(streams,after.program_sources[file]))errors.push('Unrelated program streams changed: '+file);
  }
  if(scope==='pou'){
    const created=byName(after.pous,args.operation==='create'?args.name:args.new_name);
    if(args.operation==='create'&&(!created?.body_blank||created.variables.length||created.return_type!==(args.return_type??'')))errors.push('New POU defaults/return type not proven');
    if(['rename','copy'].includes(args.operation)){
      const old=byName(before.pous,args.name);
      if(!created||!same({...old,name:created.name},created))errors.push('Renamed/copied POU source differs from retained source');
    }
  }
  for(const old of before.tasks){
    if(scope==='task'&&eq(old.name,args.name))continue;
    if(!same(old,byName(after.tasks,old.name)))errors.push('Unrelated task changed: '+old.name);
  }
  if(scope==='task'&&args.operation!=='delete'){
    const actual=byName(after.tasks,args.name),old=byName(before.tasks,args.name);
    const expected=plan.settings??old?.settings;
    if(expected&&!same(expected,actual?.settings))errors.push('Task settings differ from plan');
  }
  return {scope,operation:args.operation,action_performed:true,native_result:result,verification:{accepted:!errors.length,errors},
    baseline:before,saved_result:after,expected_native:plan.native,next_step:errors.length?'STOP: inspect retained evidence; no automatic retry/repair.':'Run fresh Build/Make after intended edits.'};
}
