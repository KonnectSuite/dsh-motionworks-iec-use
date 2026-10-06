import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {__internals as i} from '../index.js';
import {captureCheckpoint,compareCheckpoint,checkpointDigest,libraryBaseline} from '../project-checkpoint.js';
const variable={name:'Run',type:'BOOL',section:'VAR',group:'Default',address:null,initial_value:null,description:null};
const flags={retain:false,pdd:false,opc:false,disabled:false,not_on_plc:false,redundant:false};
const pou={name:'Main',type:'PROGRAM',language:'IL',variables:[variable]};
const saved={pous:[pou],globals:[],tasks:[{name:'BG',kind:'DEFAULT',instances:[],settings:{watchdog:'5000'}}],program_sources:{source:{AB:'hash'}},translation_files:{comments:'hash'}};
const native={structure:{pous:[{name:'Main',type:'PROGRAM',language:1}],tasks:[{name:'BG',kind:'DEFAULT',instances:[]}]},declarations:{globals:{variables:[],groups:[]},'pou:Main':{variables:[{...variable,...flags}],groups:[{name:'Default',read_only:false}]}},libraries:[]};
const clone=x=>structuredClone(x);
const deps=overrides=>({status:async()=>({is_modified:false,is_compiled:true}),saved:async()=>clone(saved),native:async()=>clone(native),libraries:async()=>[],identity:async()=>{},...overrides});
const args={baseline_saved:true},snapshot=await captureCheckpoint(args,deps());
assert.equal(compareCheckpoint(snapshot,clone(snapshot)).accepted,true);
assert.equal(compareCheckpoint(snapshot,clone(snapshot)).fresh_compile_verified,false);
for(const category of ['tasks','pous','globals','program_sources','translation_files']){
 const changed=clone(snapshot);changed.saved[category]=['changed'];
 assert.equal(compareCheckpoint(snapshot,changed).accepted,false,category);
}
const changed=clone(snapshot);changed.native.declarations['pou:Main'].variables[0].opc=true;
assert.deepEqual(compareCheckpoint(snapshot,changed).changed,['native_package']);
const libraryChanged=clone(snapshot);libraryChanged.libraries=['changed'];assert.equal(compareCheckpoint(snapshot,libraryChanged).accepted,false);
await assert.rejects(()=>captureCheckpoint({},deps()),/Reconcile/);
await assert.rejects(()=>captureCheckpoint(args,deps({libraries:async()=>null})),/Complete bound library/);
await assert.rejects(()=>captureCheckpoint(args,deps({saved:async()=>({...saved,program_sources:[]})})),/Invalid saved/);
await assert.rejects(()=>captureCheckpoint(args,deps({status:async()=>({is_modified:true})})),/Unsaved/);
const incomplete=clone(native);delete incomplete.declarations['pou:Main'].variables[0].opc;
await assert.rejects(()=>captureCheckpoint(args,deps({native:async()=>incomplete})),/flag unavailable/);
await assert.rejects(()=>captureCheckpoint(args,deps({native:async()=>({...native,declarations:{globals:native.declarations.globals}})})),/scope inventory/);
let reads=0;await assert.rejects(()=>captureCheckpoint(args,deps({saved:async()=>++reads===1?saved:{...saved,tasks:[]}})),/changed during capture/);
let states=0;await assert.rejects(()=>captureCheckpoint(args,deps({status:async()=>({is_modified:++states!==1})})),/became modified/);
await assert.rejects(()=>captureCheckpoint(args,deps({identity:async()=>{throw Error('wrong project')}})),/wrong project/);
assert.notEqual(checkpointDigest(snapshot),checkpointDigest(changed));
const root=mkdtempSync(join(tmpdir(),'mw-checkpoint-'));
try{
 const wrapper=join(root,'Vendor.mwt'),directory=join(root,'Vendor');mkdirSync(directory);writeFileSync(wrapper,'wrapper');writeFileSync(join(directory,'pins'),'pins');
 const fwlDir=join(root,'Firmware');mkdirSync(fwlDir);const firmware=join(fwlDir,'Firmware.fwl');writeFileSync(firmware,'firmware');writeFileSync(join(fwlDir,'metadata'),'types');
 const libraries=[{name:'Vendor',full_name:wrapper,logical_name:'/Libraries/Vendor'},{name:'Firmware',full_name:firmware,logical_name:'/Libraries/Firmware'}];
 const manifest=libraryBaseline(libraries);assert.equal(manifest.length,2);assert.equal(manifest[0].files.length,2);assert.equal(manifest[1].files.length,2);
 writeFileSync(join(fwlDir,'metadata'),'changed');assert.notDeepEqual(libraryBaseline(libraries),manifest);
 assert.throws(()=>libraryBaseline([...libraries,libraries[0]]),/Duplicate/);
 assert.throws(()=>libraryBaseline([{...libraries[0],full_name:join(root,'unknown.bin')}]),/Unsupported/);
 assert.throws(()=>libraryBaseline([{name:'Missing'}]),/Incomplete/);
}finally{rmSync(root,{recursive:true,force:true});}
console.log('Checkpoint: complete IL/saved/native flags/tasks/translations, drift, dirty state, identity, bound library files and digest checks passed; no IDE invoked');

const tool=i.defineTools().find(t=>t.name==='mw_ide_verify');
assert.match(tool.output.render({}, {verdict:'baseline_captured',baseline_id:'receipt.hash',report_path:'report.json',next_step:'Compare later'})[0].text,/Baseline ID: receipt.hash/);
assert.match(tool.output.render({}, {verdict:'unverified',report_path:'report.json',error:'wrong project',next_step:'Inspect'})[0].text,/Stopped: wrong project/);
assert.equal(tool.presentCall({mode:'capture_baseline'}).kind,'read');
assert.equal(tool.presentCall({mode:'compare_baseline'}).kind,'read');
assert.equal(tool.presentCall({}).kind,'execute');
