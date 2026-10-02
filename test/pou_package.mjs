import assert from 'node:assert/strict';
import {exportPouPackage,importPouPackage} from '../pou-package.js';
import {__internals as i} from '../index.js';
const variable={name:'Run',type:'BOOL',section:'VAR_EXTERNAL',group:'Default',address:null,initial_value:null,description:null};
const pou={name:'Main',type:'PROGRAM',language:'LD',body_sha256:'graph',variables:[variable]};
const meta={name:'Main',type:'PROGRAM',language:4,read_only:false};
const global={...variable,section:'VAR_GLOBAL'};
const saved={pous:[pou],globals:[global],tasks:[],program_sources:{'POE/Main/src.st1':{GB:'graph'}},translation_files:{'POE/Main/MainTranslation.xml':'comments'},file_hashes:{source:'sourcehash'}};
const declaration={variables:[{...variable,retain:false,opc:true}],groups:[{name:'Default',read_only:false}]};
const native={structure:{pous:[meta],tasks:[]},declarations:{globals:{variables:[global],groups:[]},'pou:Main':declaration},libraries:[{name:'Firmware',full_name:'bound.fwl'}]};
const manifest=[{path:'pou.tre',bytes:1,sha256:'tree'},{path:'Main/src.st1',bytes:1,sha256:'source'}];
const empty={...saved,pous:[],program_sources:{},translation_files:{}};
const emptyNative={...native,structure:{pous:[],tasks:[]},declarations:{globals:native.declarations.globals}};
function exports(overrides={}){return {status:async()=>({is_modified:false}),saved:async()=>structuredClone(saved),snapshot:async()=>structuredClone(native),manifest:async()=>manifest,mutate:async()=>({return_code:0}),...overrides};}
const receipt=await exportPouPackage({pou:'Main',baseline_saved:true},exports());
assert.equal(receipt.pou.body_sha256,'graph');
const inheritedSaved=structuredClone(saved),inheritedNative=structuredClone(native);
inheritedSaved.globals[0].description='Global description';
inheritedSaved.pous[0].variables[0].description='Global description';
inheritedNative.declarations.globals.variables[0].description='Global description';
await exportPouPackage({pou:'Main',baseline_saved:true},exports({saved:async()=>inheritedSaved,snapshot:async()=>inheritedNative}));
inheritedSaved.pous[0].variables[0].type='INT';
await assert.rejects(()=>exportPouPackage({pou:'Main',baseline_saved:true},exports({saved:async()=>inheritedSaved,snapshot:async()=>inheritedNative})),/declaration identity/);
await assert.rejects(()=>exportPouPackage({pou:'Main',baseline_saved:false},exports()),/save/);
await assert.rejects(()=>exportPouPackage({pou:'Main',baseline_saved:true},exports({status:async()=>({is_modified:null})})),/unknown/);
await assert.rejects(()=>exportPouPackage({pou:'Main',baseline_saved:true},exports({snapshot:async()=>({...native,structure:{pous:[],tasks:[]}})})),/inventories/);
let calls=0;
await assert.rejects(()=>exportPouPackage({pou:'Main',baseline_saved:true},exports({saved:async()=>++calls===1?saved:{...saved,translation_files:{unexpected:'change'}}})),/preservation/);
function imports(overrides={}){let savedCalls=0,nativeCalls=0;return {status:async()=>({is_modified:false}),saved:async()=>structuredClone(++savedCalls===1?empty:saved),snapshot:async()=>structuredClone(++nativeCalls===1?emptyNative:native),manifest:async()=>manifest,consume:async()=>{},mutate:async()=>({return_code:0,saved:true}),...overrides};}
const args={baseline_saved:true,dependencies_reviewed:true};
assert.equal((await importPouPackage(args,receipt,imports())).accepted,true);
for(const [overrides,regex] of [[{saved:async()=>saved,snapshot:async()=>native},/already exists/],[{manifest:async()=>[]},/package changed/],[{snapshot:async()=>({...emptyNative,libraries:[]})},/library/],[{saved:async()=>({...empty,globals:[]}),snapshot:async()=>({...emptyNative,declarations:{globals:{variables:[]}}})},/external/]]){
 let mutated=false;
 await assert.rejects(()=>importPouPackage(args,receipt,imports({...overrides,mutate:async()=>{mutated=true;throw Error('bad');}})),regex);assert.equal(mutated,false);
}
await assert.rejects(()=>importPouPackage(args,{...receipt,used:true},imports()),/already attempted/);
await assert.rejects(()=>importPouPackage({...args,dependencies_reviewed:false},receipt,imports()),/review/);
calls=0;
const altered=structuredClone(native);altered.declarations['pou:Main'].variables[0].opc=false;
const flags=await importPouPackage(args,receipt,imports({snapshot:async()=>++calls===1?emptyNative:altered}));assert.equal(flags.accepted,false);assert.match(flags.errors.join(),/flags/);
calls=0;
const collateral=await importPouPackage(args,receipt,imports({saved:async()=>++calls===1?empty:{...saved,program_sources:{...saved.program_sources,'POE/Other/src.st1':{GB:'unexpected'}}}}));assert.equal(collateral.accepted,false);
assert.ok(i.defineTools().find(t=>t.name==='mw_ide_pou_package'));
console.log('POU package export/import guards, collisions, dependencies, flags and collateral-source checks passed');
