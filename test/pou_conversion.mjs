import assert from 'node:assert/strict';
import {convertPou} from '../pou-conversion.js';
import {__internals as i} from '../index.js';
const hash='a'.repeat(64);
const variable={name:'Timer',type:'TON',section:'VAR',group:'Default',address:null,initial_value:null,description:null};
const pou={name:'Main',type:'PROGRAM',return_type:'',language:'ST',body_sha256:hash,body_blank:false,variables:[variable]};
const other={...pou,name:'Other'};
const before={pous:[pou,other],globals:[],tasks:[],program_sources:{'POE/Main/src.st1':{ST:hash},'POE/Other/src.st1':{ST:'unchanged'}},translation_files:{'POE/Other/Translation.xml':'comment'},file_hashes:{source:hash}};
const native={structure:{pous:[{name:'Main',type:'PROGRAM',language:2,read_only:false},{name:'Other',type:'PROGRAM',language:2,read_only:false}],tasks:[]},declarations:{globals:{variables:[],groups:[]},'pou:Main':{variables:[{...variable,retain:true,opc:true}],groups:[{name:'Default',read_only:false}]},'pou:Other':{variables:[variable],groups:[]}},libraries:[{name:'IEC',full_name:'exact.fwl'}]};
for(const sheet of Object.values(native.declarations))sheet.variables=sheet.variables.map(v=>({retain:false,pdd:false,opc:false,disabled:false,not_on_plc:false,redundant:false,...v}));
const after=structuredClone(before);after.pous[0]={...pou,language:'FBD',body_sha256:'b'.repeat(64)};after.program_sources['POE/Main/src.st1']={GB:after.pous[0].body_sha256};
const afterNative=structuredClone(native);afterNative.structure.pous[0].language=3;
const args={pou:'Main',language:'FBD',expected_body_sha256:hash,baseline_saved:true,conversion_reviewed:true};
function fixture(overrides={}){
 let savedCalls=0,nativeCalls=0,mutations=0,listings=0;
 return {deps:{status:async()=>({is_modified:false,is_compiled:true}),saved:async()=>structuredClone(++savedCalls<=2?before:after),snapshot:async()=>structuredClone(++nativeCalls<=2?native:afterNative),build:async()=>({is_compiled:true,evidence_kind:'observed_compile_transition'}),source:async()=>({pou:'Main',language:'ST',artifacts:Array.from({length:4},()=>({modified_ms:Date.now()}))}),mutate:async()=>{mutations++;return {name:'Main',saved:true,language:3};},listing:async()=>{listings++;return {accepted:true,compiler_cache_freshness_verified:true};},...overrides},counts:()=>({mutations,listings})};
}
const f=fixture(),result=await convertPou(args,f.deps);assert.equal(result.verification.accepted,true);assert.deepEqual(f.counts(),{mutations:1,listings:1});assert.equal(result.wiring_verified,false);
for(const change of [{baseline_saved:false},{conversion_reviewed:false},{language:'ST'},{expected_body_sha256:'stale'},{expected_body_sha256:'c'.repeat(64)},{pou:'Absent'}]){const f=fixture();await assert.rejects(()=>convertPou({...args,...change},f.deps));assert.equal(f.counts().mutations,0);}
for(const overrides of [{status:async()=>({is_modified:null})},{snapshot:async()=>({...native,libraries:[],structure:{...native.structure,pous:native.structure.pous.map(p=>({...p,read_only:true}))}})},{build:async()=>({is_compiled:true,evidence_kind:'up_to_date'})},{status:async()=>({is_modified:false,is_compiled:null})}]){const f=fixture(overrides);await assert.rejects(()=>convertPou(args,f.deps));assert.equal(f.counts().mutations,0);}
let calls=0;
const drift=fixture({saved:async()=>++calls===1?before:{...before,translation_files:{unexpected:'drift'}}});await assert.rejects(()=>convertPou(args,drift.deps),/baseline/);assert.equal(drift.counts().mutations,0);
const unknown=structuredClone(native);unknown.declarations['pou:Main'].variables[0].opc=null;const unknownFlags=fixture({snapshot:async()=>unknown});await assert.rejects(()=>convertPou(args,unknownFlags.deps),/unknown/);assert.equal(unknownFlags.counts().mutations,0);
for(const source of [{pou:'Main',language:'ST',artifacts:[{modified_ms:0}]},{pou:'Other',language:'ST',artifacts:[]},{pou:'Main',language:'ST',artifacts:Array.from({length:4},()=>({modified_ms:0}))}]){const f=fixture({source:async()=>source});await assert.rejects(()=>convertPou(args,f.deps),/compiler artifacts/);assert.equal(f.counts().mutations,0);}
for(const alter of [a=>{a.pous[0].variables=[];},a=>{a.pous[0].body_blank=true;},a=>{a.globals=[variable];},a=>{a.program_sources['POE/Unexpected/src.st1']={GB:'new'};},a=>{delete a.translation_files['POE/Other/Translation.xml'];}]){
 const altered=structuredClone(after);alter(altered);let calls=0;const f=fixture({saved:async()=>structuredClone(++calls<=2?before:altered)});const r=await convertPou(args,f.deps);assert.equal(r.verification.accepted,false);assert.equal(f.counts().listings,0);
}
const alteredNative=structuredClone(afterNative);alteredNative.declarations['pou:Main'].variables[0].retain=false;calls=0;
const flagDrift=fixture({snapshot:async()=>structuredClone(++calls<=2?native:alteredNative)});assert.equal((await convertPou(args,flagDrift.deps)).verification.accepted,false);assert.equal(flagDrift.counts().listings,0);
const listingFailure=fixture({listing:async()=>({accepted:false})});await assert.rejects(()=>convertPou(args,listingFailure.deps),/listing/);assert.equal(listingFailure.counts().mutations,1);
const wrongIdentity=fixture({mutate:async()=>({name:'Other',saved:true,language:3})});assert.equal((await convertPou(args,wrongIdentity.deps)).verification.accepted,false);assert.equal(wrongIdentity.counts().listings,0);
calls=0;const finalDrift=fixture({saved:async()=>structuredClone(++calls<=2?before:calls===3?after:{...after,tasks:[{name:'Unexpected'}]})});await assert.rejects(()=>convertPou(args,finalDrift.deps),/final/);assert.equal(finalDrift.counts().mutations,1);
assert.ok(i.defineTools().find(t=>t.name==='mw_ide_pou_convert'));
console.log('Native POU conversion stale-source/review, fresh-build, declaration-flag, collateral-source and partial-failure guards passed');
