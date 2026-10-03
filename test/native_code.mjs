import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeCodeChange,patchedCode} from '../native-code.js';
const pou={name:'Main',type:'PROGRAM',language:'ST',variables:[],return_type:'',reference_scan_complete:true,body_sha256:'old',body_blank:false,identifiers:[]};
const baseline={pous:[pou,{...pou,name:'Other'}],tasks:[],globals:[],program_sources:{'POE/Main/src.st1':{'Main.STB':'old','MainV.VB':'vars'},'POE/Other/src.st1':{'Other.STB':'other'}},translation_files:{'POE/Other/OtherTranslation.xml':'comment'},file_hashes:{'src.st1':'hash'}};
const live={pous:baseline.pous.map(p=>({name:p.name,type:p.type,language:2,read_only:false})),tasks:[]};
const args={pou:'Main',baseline_saved:true,expected_body:'RETURN;\n',code:'IF FALSE THEN\n RETURN;\nEND_IF;'};
async function run(overrides={},input=args){
  let reads=0,bodies=0,mutations=0,retained=false;
  const after=structuredClone(baseline);after.pous[0].body_sha256='new';after.program_sources['POE/Main/src.st1']['Main.STB']='new';
  const code='IF FALSE THEN\r\n RETURN;\r\nEND_IF;\r\n';
  const deps={status:async()=>({is_modified:false}),saved:async()=>structuredClone(reads++?after:baseline),snapshot:async()=>structuredClone(live),read:async()=>({body:bodies++?code:'RETURN;\r\n'}),document:async()=>({urn:'@POUS.Main.Main'}),declarations:async()=>({variables:[],groups:[{name:'Default',read_only:false}]}),prepare:async()=>({code_import_path:'input'}),retain:async()=>{retained=true;},mutate:async r=>{assert.equal(retained,true);assert.deepEqual(r.before_files,baseline.file_hashes);mutations++;return {saved:true,is_modified:false,snapshot:live};},...overrides};
  try{return await nativeCodeChange(input,deps);}finally{if(overrides.noMutation)assert.equal(mutations,0);}
}
assert.equal((await run()).verification.accepted,true);
{
  const patch={pou:'Main',baseline_saved:true,expected_body_sha256:createHash('sha256').update('RETURN;\r\n').digest('hex'),changes:[{find:'RETURN;',replace:'IF FALSE THEN\n RETURN;\nEND_IF;'}]};
  assert.equal((await run({},patch)).verification.accepted,true);
  for(const bad of [{...patch,expected_body_sha256:'0'.repeat(64)},
    {...patch,code:'RETURN;'}, {...patch,changes:[]},
    {...patch,changes:[{find:'missing',replace:''}]},
    {...patch,changes:[{find:'RETURN;',replace:'é'}]}])await assert.rejects(run({noMutation:true},bad));
  const large=Array.from({length:2322},(_,i)=>`(* line ${i} *) x${i} := ${i};`).join('\r\n');
  const changed=patchedCode(large,{changes:[{find:'x900 := 900;',replace:'x900 := 901;'},
    {find:'x901 := 901;',replace:'x901 := 902;'}]});
  assert.equal(changed,large.replace(/\r\n/g,'\n').replace('x900 := 900;','x900 := 901;').replace('x901 := 901;','x901 := 902;'));
  assert.throws(()=>patchedCode('same same',{changes:[{find:'same',replace:'other'}]}),/found 2/);
  assert.equal(patchedCode('same same',{changes:[{find:'same',replace:'other',count:2}]}),'other other');
  assert.throws(()=>patchedCode('a',{changes:[{find:'a',replace:'b'},{find:'missing',replace:'c'}]}),/found 0/);
  assert.equal(patchedCode('a\r\nb',{changes:[{find:'a\nb',replace:'c'}]}),'c');
}
{
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const empty=structuredClone(baseline),initialized=structuredClone(baseline);
  empty.program_sources['POE/Main/src.st1']['MainV.VB']=hash('');
  initialized.program_sources['POE/Main/src.st1']['MainV.VB']=hash('\r\n(*Group:Default*)\r\n\r\n');
  initialized.program_sources['POE/Main/src.st1']['MainV.VGR']='initialized';
  empty.program_sources['POE/Main/src.st1']['MainV.VGR']='empty';
  initialized.translation_files['POE/Main/MainVTranslation.xml']='empty xml';
  initialized.empty_translation_files=['POE/Main/MainVTranslation.xml'];
  let reads=0;
  const result=await run({document:async()=>({urn:'@POUS.Main.Main',variable_worksheet:'MainV'}),saved:async()=>structuredClone(reads++?initialized:empty)});
  assert.equal(result.verification.accepted,true);
  assert.equal(result.verification.initialized_empty_storage,true);
  initialized.empty_translation_files=[];reads=0;
  assert.equal((await run({document:async()=>({urn:'@POUS.Main.Main',variable_worksheet:'MainV'}),saved:async()=>structuredClone(reads++?initialized:empty)})).verification.accepted,false);
}
for(const input of [{...args,baseline_saved:false},{...args,expected_body:'drift'},{...args,code:'\x07bad'},{...args,code:'é'},{...args,pou:'Main ; anything'}])await assert.rejects(run({noMutation:true},input));
await assert.rejects(run({noMutation:true,status:async()=>({is_modified:true})}));
await assert.rejects(run({noMutation:true,snapshot:async()=>({...live,pous:live.pous.map(p=>({...p,read_only:true}))})}));
assert.equal((await run({read:async()=>({body:'RETURN;\r\n'})})).verification.accepted,false);
for(const change of [s=>s.globals.push({name:'Extra'}),s=>s.tasks.push({name:'Extra'}),s=>s.pous[1].body_sha256='damage',s=>s.program_sources['POE/Main/src.st1']['MainV.VB']='damage',s=>s.translation_files['POE/Other/OtherTranslation.xml']='damage']){
  let reads=0;const damaged=structuredClone(baseline);change(damaged);
  assert.equal((await run({saved:async()=>structuredClone(reads++?damaged:baseline)})).verification.accepted,false);
}
assert.equal((await run({mutate:async()=>({saved:true,is_modified:true,snapshot:live})})).verification.accepted,false);
{
  let reads=0;
  const result=await run({declarations:async()=>({variables:[{name:'Keep',retain:reads++>0}],groups:[]})});
  assert.equal(result.verification.accepted,false);
  assert.ok(result.verification.errors.includes('Native declaration flags changed'));
}
console.log('Native code guards, stale bodies, readonly targets, save failures, declaration/source/comment collateral and exact saved body checks passed');
{
 const before=structuredClone(baseline),after=structuredClone(baseline),native=structuredClone(live);
 before.pous[0].language=after.pous[0].language='IL';native.pous[0].language=1;
 delete before.program_sources['POE/Main/src.st1']['Main.STB'];delete after.program_sources['POE/Main/src.st1']['Main.STB'];
 before.program_sources['POE/Main/src.st1']['Main.AB']='old';after.program_sources['POE/Main/src.st1']['Main.AB']='new';
 let reads=0;
 const deps={saved:async()=>structuredClone(reads++?after:before),snapshot:async()=>structuredClone(native),mutate:async r=>{
  assert.equal(r.language,'IL');return {saved:true,is_modified:false,snapshot:native};}};
 assert.equal((await run(deps)).verification.accepted,true);
 native.pous[0].language=2;reads=0;
 await assert.rejects(()=>run({...deps,noMutation:true}),/matching/);
 native.pous[0].language=1;reads=0;
 after.program_sources['POE/Main/src.st1']['Unexpected.STB']='extra';
 assert.equal((await run(deps)).verification.accepted,false);
}
