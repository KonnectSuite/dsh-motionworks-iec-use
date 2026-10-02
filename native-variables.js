import {variableExpectation} from './edit-session.js';
const fields=['name','type','section','group','address','initial_value','description'];
const equalName=(a,b)=>a.toUpperCase()===b.toUpperCase();
// The saved reader trims comment padding; raw native rows remain the mutation guard.
const savedProjection=rows=>rows.map(v=>Object.fromEntries(fields.map(f=>[f,f==='description'?(v[f]?.trim()||null):v[f]??null])));
export function variableChangePlan(baseline,args,existingGroups=baseline.map(v=>v.group)) {
  if(!['add','edit','delete'].includes(args.operation))throw new Error('Unknown variable operation');
  let old;
  if(args.operation!=='add') {
    old=baseline.find(v=>equalName(v.name,args.name??''));
    if(!old)throw new Error('Target variable does not exist');
  }
  if(args.operation==='delete') {
    if(args.user_approved!==true||args.references_reviewed!==true)throw new Error('Explicit deletion approval and reference review required');
    return {expected:baseline.filter(v=>v!==old),old};
  }
  const declaration=args.declaration;
  if(old && !equalName(old.name,declaration?.name??'') && args.rename_reviewed!==true)
    throw new Error('Review all code/external references before renaming a declaration');
  const rest=old?baseline.filter(v=>v!==old):baseline;
  // Retain original group evidence even when editing its sole declaration.
  const expected=variableExpectation(rest,declaration,args.pou,existingGroups);
  return {expected,old};
}
export async function nativeVariableChange(args,{status,saved,snapshot,mutate,compare,globals}) {
  if(args.baseline_saved!==true)throw new Error('Save/reconcile IDE edits before a native variable operation');
  const state=await status();
  if(state.is_modified!==false)throw new Error('Native project has unsaved changes; save/reconcile first');
  const before=await saved();
  if(before.warnings?.length)throw new Error('Saved declaration parse warnings; no native action performed');
  const live=await snapshot();
  const nativeRows=savedProjection(live.variables);
  const aligned=compare(before.variables,nativeRows);
  if(!aligned.accepted)throw new Error('Live declarations disagree with saved baseline; no native action performed');
  const plan=variableChangePlan(before.variables,args,live.groups.map(g=>g.name));
  if(args.declaration?.section==='VAR_EXTERNAL') {
    const global=await globals();
    const match=global.variables.find(v=>equalName(v.name,args.declaration.name));
    if(!match || match.type.toUpperCase()!==args.declaration.type.toUpperCase())throw new Error('External requires an existing global of the exact name/type');
  }
  const target=live.variables.find(v=>equalName(v.name,args.name??''));
  const group=args.declaration?.group??target?.group;
  if(!live.groups.some(g=>g.name===group&&!g.read_only))throw new Error('Target group is absent or read-only');
  if(args.operation==='edit' && group!==target.group)throw new Error('Native Variable.Group is read-only; use the observed variable-grid move workflow in docs/VARIABLE_WORKSHEET_WORKFLOW.md and verify complete saved/native declarations');
  const result=await mutate({...args,before_native:live.variables});
  const after=await saved();
  const verification=compare(plan.expected,after.variables);
  if(!Array.isArray(result.variables)) {
    verification.accepted=false;verification.errors.push('Complete native read-back is missing');
  } else {
    const nativeExpected=args.operation==='delete'?live.variables.filter(v=>v!==target):
      [...live.variables.filter(v=>args.operation==='add'||v!==target),{...args.declaration}];
    const nativeAfter=compare(nativeExpected,result.variables);
    if(!nativeAfter.accepted){verification.accepted=false;verification.errors.push('Native read-back disagrees with expected declarations');}
  }
  if(result.saved!==true||result.is_modified!==false){verification.accepted=false;verification.errors.push('Native save completion not proven');}
  for(const row of result.variables??[]) {
    const original=live.variables.find(v=>equalName(v.name,row.name))??(plan.old&&equalName(row.name,args.declaration?.name??'')?target:null);
    for(const field of ['retain','pdd','opc','disabled','not_on_plc','redundant']) {
      if(row[field] !== (original?.[field]??false)){verification.accepted=false;verification.errors.push(`Native ${field} changed unexpectedly on ${row.name}`);}
    }
  }
  if(after.warnings?.length){verification.accepted=false;verification.errors.push(...after.warnings);}
  return {operation:args.operation,action_performed:true,native_result:result,verification,
    next_step:verification.accepted?'Run fresh Build/Make after the intended changes are complete.':'STOP: inspect retained before/after evidence; no automatic repair or retry.',
    baseline:before.variables,expected_variables:plan.expected};
}
