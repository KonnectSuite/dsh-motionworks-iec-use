import assert from 'node:assert/strict';
import {nativeVariableChange,variableChangePlan} from '../native-variables.js';
import {__internals} from '../index.js';
const row={name:'Existing',type:'INT',section:'VAR',group:'Default',address:null,initial_value:null,description:null};
const addition={...row,name:'NewVar',initial_value:'7'};
const flags={retain:false,pdd:false,opc:false,disabled:false,not_on_plc:false,redundant:false};
const args={operation:'add',pou:'Main',baseline_saved:true,declaration:addition};
async function run(input=args,override={}) {
  let mutated=0,reads=0;
  const expected=variableChangePlan([row],input).expected;
  const deps={status:async()=>({is_modified:false}),saved:async()=>({variables:reads++?[...expected]:[row]}),
    snapshot:async()=>({variables:[{...row,...flags}],groups:[{name:'Default',read_only:false}]}),
    mutate:async()=>{mutated++;return {saved:true,is_modified:false,variables:expected.map(v=>({...v,...flags}))};},
    compare:__internals.compareVariables,globals:async()=>({variables:[]}),...override};
  try{return await nativeVariableChange(input,deps);}finally{if(override.noMutation)assert.equal(mutated,0);}
}
assert.equal((await run()).verification.accepted,true);
{
  let reads=0,mutations=0;
  const emptyDeps={status:async()=>({is_modified:false}),saved:async()=>({variables:reads++?[addition]:[]}),snapshot:async()=>({variables:[],groups:[{name:'Default',read_only:false}]}),mutate:async()=>{mutations++;return {saved:true,is_modified:false,variables:[{...addition,...flags}]};},compare:__internals.compareVariables,globals:async()=>({variables:[]})};
  assert.equal((await nativeVariableChange(args,emptyDeps)).verification.accepted,true);
  assert.equal(mutations,1);
  reads=0;mutations=0;
  await assert.rejects(nativeVariableChange(args,{...emptyDeps,snapshot:async()=>({variables:[],groups:[{name:'Default',read_only:true}]})}),/read-only/);
  assert.equal(mutations,0);
  reads=0;
  await assert.rejects(nativeVariableChange(args,{...emptyDeps,snapshot:async()=>({variables:[],groups:[]})}),/Group/);
  assert.equal(mutations,0);
}
const padded={...row,description:'Comment '};
let paddingReads=0;
assert.equal((await run(args,{
  saved:async()=>({variables:paddingReads++?[{...row,description:'Comment'},addition]:[{...row,description:'Comment'}]}),
  snapshot:async()=>({variables:[{...padded,...flags}],groups:[{name:'Default',read_only:false}]}),
  mutate:async()=>({saved:true,is_modified:false,variables:[{...padded,...flags},{...addition,...flags}]})
})).verification.accepted,true);
assert.equal((await run({...args,operation:'edit',name:row.name,declaration:{...row,initial_value:'9'}})).verification.accepted,true);
await assert.rejects(()=>nativeVariableChange({...args,operation:'edit',name:row.name,declaration:{...row,group:'Destination'}},{
 status:async()=>({is_modified:false}),saved:async()=>({variables:[row]}),
 snapshot:async()=>({variables:[{...row,...flags}],groups:[{name:'Default',read_only:false},{name:'Destination',read_only:false}]}),
 compare:__internals.compareVariables,mutate:async()=>assert.fail('Group refusal must precede mutation')
}),/Variable.Group is read-only/);
assert.equal((await run({...args,operation:'delete',name:row.name,declaration:undefined,user_approved:true,references_reviewed:true})).verification.accepted,true);
assert.throws(()=>variableChangePlan([row],{operation:'delete',name:row.name}),/approval/);
assert.throws(()=>variableChangePlan([row],{...args,operation:'edit',name:row.name}),/renaming/);
await assert.rejects(()=>run({...args,baseline_saved:false},{noMutation:true}),/Save/);
await assert.rejects(()=>run(args,{status:async()=>({is_modified:true}),noMutation:true}),/unsaved/);
await assert.rejects(()=>run(args,{snapshot:async()=>({variables:[{...row,type:'BOOL',...flags}],groups:[]}),noMutation:true}),/disagree/);
await assert.rejects(()=>run({...args,declaration:{...addition,section:'VAR_EXTERNAL',initial_value:null}},{noMutation:true}),/existing global/);
assert.equal((await run(args,{mutate:async()=>({saved:true,is_modified:false,variables:[{...row,...flags}]})})).verification.accepted,false);
assert.equal((await run(args,{mutate:async()=>({saved:true,is_modified:false})})).verification.accepted,false);
assert.equal((await run(args,{mutate:async()=>({saved:true,is_modified:false,variables:[{...row,...flags,retain:true},{...addition,...flags}]})})).verification.accepted,false);
assert.equal((await run(args,{mutate:async()=>({saved:true,is_modified:true,variables:[{...row,...flags},{...addition,...flags}]})})).verification.accepted,false);
console.log('Native variable lifecycle, baseline drift, consent, external scope, complete read-back and flag guards passed');
for(const field of Object.keys(flags)) {
  const requested={...args,flags:{[field]:true}};
  assert.equal((await run(requested,{mutate:async()=>({saved:true,is_modified:false,variables:[{...row,...flags},{...addition,...flags,[field]:true}]})})).verification.accepted,true);
  assert.equal((await run(requested)).verification.accepted,false,'Ignored explicit flag must fail');
  assert.equal((await run(requested,{mutate:async()=>({saved:true,is_modified:false,variables:[{...row,...flags,[field]:true},{...addition,...flags,[field]:true}]})})).verification.accepted,false,'Collateral flag change must fail');
}
for(const bad of [null,[],true,{unknown:true},{retain:'true'},{opc:1}])await assert.rejects(()=>run({...args,flags:bad},{noMutation:true}),/flags/);
await assert.rejects(()=>run({...args,operation:'delete',name:row.name,declaration:undefined,user_approved:true,references_reviewed:true,flags:{retain:false}},{noMutation:true}),/add\/edit/);
console.log('Six explicit native flags, ignored setter/collateral refusal and invalid/delete flag guards passed');
