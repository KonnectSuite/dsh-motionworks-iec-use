import assert from 'node:assert/strict';
import {__internals as i} from '../index.js';
const tool=i.defineTools().find(t=>t.name==='mw_code_check_program');
for(const request of [{refresh_compiler:true},{refresh_compiler:true,installed_interfaces:true,baseline_saved:true},
 {refresh_compiler:true,installed_interfaces:true,baseline_saved:true,interface_libraries:{One:'Vendor',Two:'Vendor'}}]){
 await assert.rejects(()=>tool.execute(request),/Compiled review requires/);
}
const report={findings:[
 {pou:'Example',severity:'warning',code:'scope-review',line:1,message:'Review global scope.',reference:{path:'scope-reference',sha256:'a'.repeat(64)}},
 {pou:'Example',severity:'error',code:'last-error',line:500,message:'LAST FINDING MUST BE VISIBLE',reference:{path:'last-reference',sha256:'b'.repeat(64)}}
],coverage:[{pou:'Example',status:'ST_reviewed',unresolved_signatures:['UnresolvedVendorFB']},{pou:'Graphical',status:'graphical_body_not_analyzed'}],installed_interfaces:[],errors:1,warnings:1,verification:'static_review_only',automatic_changes:false,limitations:['No arbitrary LD/FBD analysis','Saved task ownership is not runtime execution proof']};
const blocks=tool.output.render({}, {ok:true,result:report});
assert.equal(blocks.length,1);assert.equal(blocks[0].type,'text');
const text=blocks[0].text;
assert.match(text,/errors=1, warnings=1/);
assert.match(text,/LAST FINDING MUST BE VISIBLE/);
assert.match(text,/last-reference/);
assert.match(text,/UnresolvedVendorFB/);
assert.match(text,/graphical_body_not_analyzed/);
assert.match(text,/not runtime execution proof/);
const retained=JSON.parse(text.slice(text.indexOf('{')));assert.deepEqual(retained,report);
const empty=tool.output.render({}, {result:{...report,findings:[],errors:0,warnings:0}})[0].text;
assert.match(empty,/Static source review only/);assert.match(empty,/No arbitrary LD\/FBD analysis/);
const missing=tool.output.render({}, {ok:true})[0].text;
assert.match(missing,/unverified/);assert.doesNotMatch(missing,/errors=0|warnings=0/);
console.log('Programming review preserves every finding, reference, unresolved interface and coverage limit');
