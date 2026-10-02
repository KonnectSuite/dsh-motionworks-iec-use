// Read-only saved/native ownership comparison; no task or project mutation.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const evidence_path=workspace+'/.motionworks/verification/native-task-ownership-'+randomUUID()+'.json';
const record={project,phase:'started'};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
try {
 record.before=await i.runCode('structure_snapshot',{project});assert.equal(record.before.pous.length,7);retain();
 record.saved=await tools.get('mw_code_tasks').execute({project});
 assert.equal(record.saved.binding_resolution,'exact_saved_tree');assert.equal(record.saved.task_count,5);
 record.native=await tools.get('mw_code_task_model').execute({});retain();
 for(const task of record.saved.bindings) {
  const native=record.native.tasks[task.name];assert.ok(native,task.name);
  assert.equal(task.kind,native.cycle);
  assert.deepEqual(task.instances.map(({name,type})=>({name,type})),native.instances.map(({name,type})=>({name,type})));
  assert.deepEqual(task.settings,record.before.tasks.find(t=>t.name===task.name).settings);
 }
 const actual=record.saved.bindings.flatMap(t=>t.instances);
 assert.ok(actual.some(x=>x.name!==x.type),'Known fixture has differently named PROGRAM instances');
 const assigned=new Set(actual.map(x=>x.type.toUpperCase()));
 assert.ok(!record.saved.unassigned.some(x=>assigned.has(x.toUpperCase())));
 record.review=(await tools.get('mw_code_check_program').execute({project})).result;
 assert.ok(record.review.coverage.some(c=>c.tasks==='exact_saved_tree'));
 assert.ok(!record.review.findings.some(f=>f.code==='program-task-binding-review'&&[...assigned].some(name=>f.message.toUpperCase().startsWith(name+' '))));
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],record.after[key],key);
 record.phase='accepted';record.accepted=true;retain();console.log(JSON.stringify({accepted:true,evidence_path,task_count:record.saved.task_count,unassigned:record.saved.unassigned}));
} catch(error) {record.phase='stopped';record.error=error.message;retain();throw error;}
finally {await i.stopBridge();}
