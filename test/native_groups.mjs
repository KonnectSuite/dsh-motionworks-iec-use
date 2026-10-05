import assert from 'node:assert/strict';
import {groupPlan,nativeGroupChange} from '../native-groups.js';
const row={name:'Value',type:'INT',section:'VAR',group:'Default',address:null,initial_value:'3',description:null};
const flags={retain:true,pdd:false,opc:true,disabled:false,not_on_plc:false,redundant:false};
const saved={pous:[{name:'Main',language:'ST',type:'PROGRAM',body_sha256:'body',variables:[row]}],tasks:[],globals:[],program_sources:{'POE/Main/src.st1':{'MainV.VB':'variables','MainV.VGR':'grid','MainT.STB':'code'},'Other/src.st1':{'Other.GB':'graph'}},translation_files:{'POE/Main/Translation.xml':'comments'},file_hashes:{}};
const live={variables:[{...row,...flags}],groups:[{name:'Default',read_only:false}],structure:{pous:[{name:'Main',read_only:false,type:'PROGRAM',language:2}],tasks:[]},libraries:[{name:'IEC',path:'IEC.fwl',logical_name:'IEC'}],group_membership:{globals:[],'pou:Main':[{name:'Default',read_only:false,members:['Value']}]} };
const input={pou:'Main',operation:'rename',name:'Default',new_name:'Working',baseline_saved:true};
function fixture(args=input,overrides={}){
 const before=structuredClone(saved),native=structuredClone(live),plan=groupPlan(args,before,native);
 let mutations=0,retained=0,reads=0,snapshots=0;
 const deps={status:async()=>({is_modified:false}),saved:async()=>structuredClone(reads++?plan.savedExpected:before),snapshot:async()=>structuredClone(snapshots++?plan.expected:native),retain:async()=>{retained++;},mutate:async()=>{assert.equal(retained,1);mutations++;return {saved:true,is_modified:false};},...overrides};
 return {deps,counts:()=>({mutations,retained})};
}
assert.equal((await nativeGroupChange(input,fixture().deps)).accepted,true);
assert.deepEqual(groupPlan(input,saved,live).expected.variables,[{...row,...flags,group:'Working'}]);
const ilSaved=structuredClone(saved),ilLive=structuredClone(live);
ilSaved.pous[0].language='IL';ilLive.structure.pous[0].language=1;
assert.equal(groupPlan(input,ilSaved,ilLive).expected.structure.pous[0].language,1);
const globalSaved=structuredClone(saved),globalLive=structuredClone(live);
globalSaved.globals=[{...row,section:'VAR_GLOBAL'}];
globalSaved.program_sources['C/Configuration/R/Resource/src.st1']={'GlobalV.VB':'vars','GlobalV.VGR':'grid'};
globalLive.variables=[{...row,...flags,section:'VAR_GLOBAL'}];
globalLive.group_membership.globals=[{name:'Default',read_only:false,members:['Value']}];
const globalPlan=groupPlan({...input,pou:undefined},globalSaved,globalLive);
assert.equal(globalPlan.savedExpected.globals[0].group,'Working');
assert.equal(globalPlan.savedExpected.pous[0].variables[0].group,'Default');
const create={...input,operation:'create',name:'Empty',new_name:undefined};
assert.equal((await nativeGroupChange(create,fixture(create).deps)).accepted,true);
const withEmpty=structuredClone(live);withEmpty.groups.push({name:'Empty',read_only:false});
withEmpty.group_membership['pou:Main'].push({name:'Empty',read_only:false,members:[]});
const remove={...input,operation:'delete',name:'Empty',new_name:undefined,user_approved:true};
assert.deepEqual(groupPlan(remove,saved,withEmpty).expected.groups,live.groups);
for(const [args,change,pattern] of [
 [{...input,pou:''},()=>{},/POU identifier/],
 [{...create,name:'default'},()=>{},/already exists/],
 [{...input,new_name:' Working'},()=>{},/trimmed/],
 [{...input,new_name:'Working\n'},()=>{},/control|trimmed/],
 [{...input,new_name:'Default'},()=>{},/already has/],
 [{...input,name:'default'},()=>{},/writable group/],
 [input,n=>{n.groups[0].read_only=true;n.group_membership['pou:Main'][0].read_only=true;},/writable group/],
 [input,n=>{n.structure.pous[0].read_only=true;},/writable POU/],
 [input,n=>{n.variables[0].retain=null;},/flags/],
 [input,n=>{n.variables[0].initial_value='4';},/declarations disagree/],
 [input,n=>{n.groups.push({name:'working',read_only:false});n.group_membership['pou:Main'].push({name:'working',read_only:false,members:[]});},/Destination/],
 [input,n=>{n.group_membership['pou:Main'][0].name='Wrong';},/membership disagrees/],
 [input,n=>{n.group_membership.globals=[{name:'Empty',read_only:false,members:[]},{name:' empty',read_only:false,members:[]}];},/Ambiguous/],
 [input,n=>{n.group_membership.globals=[{name:'Empty',read_only:false,members:[null]}];},/metadata/],
 [input,n=>{n.groups.push({name:' Default',read_only:false});},/Ambiguous/],
 [{...remove,name:'Default'},()=>{},/empty group/],
 [{...remove,user_approved:false},()=>{},/approval/],
 ]){const n=structuredClone(live);change(n);assert.throws(()=>groupPlan(args,saved,n),pattern);}
for(const alteration of [
 n=>{n.variables[0].retain=false;},n=>{n.groups[0].read_only=true;},
 n=>{n.structure.tasks.push({name:'Other'});},n=>{n.libraries[0].path='Wrong.fwl';},
 ]){let calls=0;const expected=groupPlan(input,saved,live).expected;
 const f=fixture(input,{snapshot:async()=>{if(!calls++)return structuredClone(live);const n=structuredClone(expected);alteration(n);return n;}});
 assert.equal((await nativeGroupChange(input,f.deps)).accepted,false);assert.equal(f.counts().mutations,1);
}
for(const alteration of [
 s=>{s.pous[0].body_sha256='wrong';},s=>{s.tasks.push({name:'Unexpected'});},
 s=>{s.globals.push(row);},s=>{s.translation_files['POE/Main/Translation.xml']='wrong';},
 s=>{s.program_sources['POE/Main/src.st1']['MainT.STB']='wrong';},
 s=>{s.program_sources['Other/src.st1']['Other.GB']='wrong';},
 ]){let calls=0;const expected=groupPlan(input,saved,live).savedExpected;
 const f=fixture(input,{saved:async()=>{if(!calls++)return structuredClone(saved);const s=structuredClone(expected);alteration(s);return s;}});
 assert.equal((await nativeGroupChange(input,f.deps)).accepted,false);
}
const valid=fixture(input,{status:async()=>({is_modified:true})});
await assert.rejects(()=>nativeGroupChange(input,valid.deps),/Reconcile/);assert.equal(valid.counts().mutations,0);
console.log('Native group planning, empty-only deletion, name/read-only/flag guards and complete saved/native collateral refusal passed; no IDE invoked');
