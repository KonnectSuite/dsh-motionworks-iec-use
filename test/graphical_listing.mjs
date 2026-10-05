import assert from 'node:assert/strict';
import {graphicalListing} from '../graphical-listing.js';
import {__internals as i} from '../index.js';
const args={pou:'Main',baseline_saved:true};
const baseline={pous:[{name:'Main',language:'LD'}],tasks:[],globals:[],program_sources:{body:'abc'},translation_files:{}};
function dependencies(overrides={}){return {saved:async()=>structuredClone(baseline),status:async()=>({is_modified:false,is_compiled:true}),build:async()=>({is_compiled:true,evidence_kind:'observed_compile_transition'}),read:async()=>({networks:[{number:1}],artifacts:Array.from({length:4},()=>({modified_ms:Date.now()})),dependency_artifacts:[],compiler_cache_freshness_verified:false}),...overrides};}
const result=await graphicalListing(args,dependencies());
assert.equal(result.accepted,true);assert.equal(result.compiler_cache_freshness_verified,true);assert.equal(result.wiring_verified,false);
assert.equal(result.action_performed,true);assert.equal(result.code_edit_performed,false);
assert.equal(result.compiler_dependency_freshness_verified,true);
for(const dependency_artifacts of [undefined,[{modified_ms:0}],[{modified_ms:Date.now()+100000}]])
 await assert.rejects(()=>graphicalListing(args,dependencies({read:async()=>({artifacts:Array.from({length:4},()=>({modified_ms:Date.now()})),dependency_artifacts})})),/pin freshness/);
await assert.rejects(()=>graphicalListing(args,dependencies({read:async()=>({artifacts:Array.from({length:4},()=>({modified_ms:0}))})})),/not regenerated/);
for(const build of [{is_compiled:false,evidence_kind:'observed_compile_transition'},{is_compiled:true,evidence_kind:'up_to_date'}]){
 await assert.rejects(()=>graphicalListing(args,dependencies({build:async()=>build,read:async()=>{throw Error('must not read cache');}})),/Build completion/);
}
await assert.rejects(()=>graphicalListing({...args,baseline_saved:false},dependencies()),/save/);
await assert.rejects(()=>graphicalListing(args,dependencies({status:async()=>({is_modified:null})})),/unknown/);
let calls=0;
await assert.rejects(()=>graphicalListing(args,dependencies({saved:async()=>++calls===1?baseline:{...baseline,translation_files:{changed:true}}})),/source changed/);
calls=0;
await assert.rejects(()=>graphicalListing(args,dependencies({status:async()=>({is_modified:++calls>2,is_compiled:true})})),/state changed/);
const tool=i.defineTools().find(t=>t.name==='mw_ide_graphical_listing');assert.ok(tool);assert.ok(tool.parameters.required.includes('baseline_saved'));
for(const invalid of [{limit:0},{limit:51},{limit:100},{limit:1.5},{limit:null},{start:0},{start:1.5},{start:null}]){
 const untouched=new Proxy({}, {get(){throw Error('Invalid range reached a native dependency');}});
 await assert.rejects(()=>graphicalListing({...args,...invalid},untouched),/listing (start|limit) must/);
 // No project/workspace supplied: refusal must precede even native identity checks.
 await assert.rejects(()=>tool.execute({...args,...invalid}),/listing (start|limit) must/);
}
for(const valid of [{start:1,limit:1},{start:2,limit:50}])assert.equal((await graphicalListing({...args,...valid},dependencies())).accepted,true);
console.log('Graphical listing fresh-build and source/native-state guards passed');
