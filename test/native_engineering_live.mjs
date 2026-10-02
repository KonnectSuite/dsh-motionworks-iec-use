// Opt-in: diagnose proposed mistakes without writing them; native compilation
// verifies the corrected firmware and toolbox FB calls in a disposable POU.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5',pou='CodexEngineeringProbe';
const resume=process.env.MOTIONWORKS_ENGINEERING_RESUME;
if(resume)assert.match(resume,/^native-engineering-[a-f0-9-]+\.json$/);
const evidence_path=workspace+'/.motionworks/verification/'+(resume??('native-engineering-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(evidence_path,'utf8')):{project,pou,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const saved=()=>i.runCode('structure_snapshot',{project});
const equalSources=(a,b)=>{for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);};
async function act(tool,args={}) {
 const result=await tools.get(tool).execute({project,baseline_saved:true,...args});
 record.events.push({tool,args,result});retain();
 assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));
 console.log(JSON.stringify({tool,accepted:true}));return result;
}
async function review(body,interface_libraries={TON:'IEC'}) {
 const result=(await tools.get('mw_code_check_program').execute({project,pou,body,installed_interfaces:true,interface_libraries})).result;
 record.events.push({tool:'mw_code_check_program',body,interface_libraries,result});retain();
 assert.equal(result.interface_resolution,'bound_installed_requested');
 assert.ok(result.coverage.some(c=>c.pou===pou&&c.status==='ST_reviewed'));
 return result;
}
try {
 if(resume) {
  assert.equal(record.project,project);assert.equal(record.pou,pou);assert.equal(record.phase,'stopped');
  assert.ok(record.before_review&&record.correct);
  equalSources(record.before_review,await saved());
  assert.equal((await i.runCode('read_text',{project,pou})).body,record.correct);
  record.phase='resumed_read_only_review';retain();
 } else {
 record.baseline=await saved();assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'create',name:pou,language:'ST'});
 for(const [name,type] of [['TimerQ','BOOL'],['TimerET','TIME'],['Accum','TIME'],['RetQ','BOOL']])
  await act('mw_ide_variable_change',{pou,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value:null,description:null}});
 await act('mw_ide_fb_insert',{pou,expected_body:'',block:'TON',library:'IEC',instance:'BasicTimer',bindings:{IN:'FALSE',PT:'T#100ms',Q:'TimerQ',ET:'TimerET'}});
 const initial=(await i.runCode('read_text',{project,pou})).body;
 await act('mw_ide_fb_insert',{pou,expected_body:initial,block:'TON_Retentive',library:'Yaskawa_Toolbox_v375',instance:'RetentiveTimer',bindings:{Accum:'Accum',Enable:'FALSE',Preset:'T#100ms',Reset:'TRUE',Q:'RetQ'}});
 record.before_review=await saved();record.correct=(await i.runCode('read_text',{project,pou})).body;retain();
 }
 const unselected=await review('BasicTimer(IN := FALSE, PT := T#100ms);',{});
 assert.ok(unselected.installed_interfaces.some(x=>x.type==='TON'&&x.status==='unresolved'&&/ambiguous/.test(x.error)));
 const bad=await review('BasicTimer(IN := FALSE, PT := TimerQ, Wrong := TRUE);\r\nRetentiveTimer(Accum := TRUE, Enable := TimerET, Preset := T#100ms, Reset := TRUE);\r\n');
 for(const code of ['unknown-fb-parameter','fb-parameter-type','fb-inout-needs-variable'])
  assert.ok(bad.findings.some(f=>f.pou===pou&&f.code===code&&f.severity==='error'&&f.reference.source_sha256),code);
 assert.deepEqual(bad.installed_interfaces.map(x=>x.status),['bound_installed_interface','bound_installed_interface']);
 assert.deepEqual(new Set(bad.installed_interfaces.map(x=>x.citation.library)),new Set(['IEC','Yaskawa_Toolbox_v375']));
 const good=await review(record.correct);
 assert.equal(good.errors,0);assert.deepEqual(good.coverage.find(c=>c.pou===pou).unresolved_signatures,[]);
 equalSources(record.before_review,await saved());record.read_only_review_verified=true;retain();
 for(const tool of ['mw_ide_build','mw_ide_make']) {const result=await act(tool);assert.equal(result.is_compiled,true);if(tool==='mw_ide_make')assert.equal(result.is_modified,false);}
 equalSources(record.before_review,await saved());
 await act('mw_ide_pou_change',{operation:'delete',name:pou,user_approved:true,references_reviewed:true});
 for(const tool of ['mw_ide_build','mw_ide_make']) {const result=await act(tool);assert.equal(result.is_compiled,true);if(tool==='mw_ide_make')assert.equal(result.is_modified,false);}
 record.after=await saved();equalSources(record.baseline,record.after);
 record.phase='cleaned';record.accepted=true;retain();console.log(JSON.stringify({accepted:true,evidence_path}));
} catch(error) {record.phase='stopped';record.error=error.message;retain();throw error;}
finally {await i.stopBridge();}
