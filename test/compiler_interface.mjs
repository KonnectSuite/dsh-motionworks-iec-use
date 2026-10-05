import assert from 'node:assert/strict';
import {compilerInterface} from '../compiler-interface.js';
const h='a'.repeat(64);
const block={name:'Example',library:'Vendor',kind:'FUNCTION_BLOCK',hidden:false,evidence_kind:'installed-compiled-block-interface',insertion_eligible:false,compiler_pin_types_verified:true,pins:[{name:'Execute',type:'BOOL',direction:'input'}],source_declaration_count:1,compiler_declaration_count:2,
 ...Object.fromEntries(['source_sha256','registry_sha256','worksheet_sha256','cache_sha256','compiler_dependency_sha256','compiler_type_table_sha256'].map(k=>[k,h])),
 ...Object.fromEntries(['source_file','reference_registry','worksheet_file','cache_file','compiler_dependency','compiler_type_table'].map(k=>[k,'synthetic/'+k]))};
const saved={pous:[],tasks:[],globals:[],program_sources:{},translation_files:{}},native={structure:{pous:[]},libraries:[{name:'Vendor'}],declarations:{}};
async function run(change={}){
 let count=0,reads=0,built=false;const events=[];
 const deps={status:async()=>({is_modified:false,is_compiled:true}),native:async()=>{reads++;return native;},saved:async()=>saved,
 interface:async()=>block,catalog:async()=>({blocks:[{name:'Example',library:'Vendor',kind:'FUNCTION_BLOCK'}],unavailable_libraries:[]}),
 library:async()=>({files:['source'],digest:h}),artifacts:async()=>[0,1].map(n=>({path:'artifact'+n,sha256:h,modified_ms:built?Date.now():Date.now()-10000})),
 build:async()=>{events.push('build');count++;built=true;return {fresh_compile:true,settled:true,is_compiled:true};},make:async()=>{events.push('make');return {is_compiled:true,is_modified:false};},...change};
 const result=await compilerInterface({name:'Example',library:'Vendor',baseline_saved:true},deps);assert.equal(count,1);assert.deepEqual(events,['build','make']);assert.equal(reads,2);return result;
}
const good=await run();assert.equal(good.project_compiler_freshness_verified,true);assert.equal(good.compiler_library_binding_verified,true);assert.equal(good.compiler_source_binding_verified,false);assert.equal(good.insertion_eligible,true);
for(const bad of [
 {status:async()=>({is_modified:true})},
 {catalog:async()=>({blocks:[{name:'Example',library:'Vendor',kind:'FUNCTION_BLOCK'},{name:'Example',library:'project',kind:'FUNCTION_BLOCK'}]})},
 {catalog:async()=>({blocks:[],unavailable_libraries:['missing']})},
 {interface:async()=>({...block,compiler_pin_types_verified:false})},
 {build:async()=>({fresh_compile:false,settled:true,is_compiled:true})},
 {make:async()=>({is_compiled:true,is_modified:true})},
 {artifacts:async()=>[0,1].map(n=>({path:'artifact'+n,sha256:h,modified_ms:Date.now()-100000}))},
])await assert.rejects(()=>run(bad));
let n=0;await assert.rejects(()=>run({library:async()=>({files:['source'],digest:(++n===1?'a':'b').repeat(64)})}),/library changed/);
n=0;await assert.rejects(()=>run({saved:async()=>++n===1?saved:{...saved,tasks:['changed']}}),/Sources/);
n=0;await assert.rejects(()=>run({native:async()=>++n===1?native:{...native,libraries:[]}}),/Sources/);
n=0;await assert.rejects(()=>run({interface:async()=>++n===1?block:{...block,pins:[]}}),/declarations changed/);
console.log('Fresh compiler interface: complete unique binding, baseline/library preservation, native Build/Make and artifact freshness guards passed; no IDE invoked');
