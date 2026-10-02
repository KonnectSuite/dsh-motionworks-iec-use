import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const evidence_path=workspace+'/.motionworks/verification/graphical-pins-live-'+randomUUID()+'.json';
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
const record={project,phase:'requested',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
retain();
try {
 record.before=await i.runCode('structure_snapshot',{project});
 assert.equal(record.before.pous.length,7);
 assert.equal((await i.verb('compile_state',{},30000)).is_modified,false);
 for(const pou of ['ServoTaskSlow','ServoHoming','EIP_ToCLX']) {
  const listing=await tools.get('mw_ide_graphical_listing').execute({project,pou,baseline_saved:true,limit:50});
  record.events.push({pou,listing});retain();
  assert.equal(listing.accepted,true,JSON.stringify(listing));
  assert.equal(listing.compiler_dependency_freshness_verified,true);
  const pins=listing.networks.flatMap(n=>n.lines.flatMap(l=>l.symbols)).filter(s=>s.pin_ordinal!==undefined);
  if(pou==='EIP_ToCLX')assert.equal(pins.length,0,'EIP uses function calls rather than FB pin references');
  else assert.ok(pins.length>0,pou+' has FB pins');
  assert.ok(pins.every(p=>p.resolved&&p.instance&&p.declaration&&p.dependency_sha256),pou+' pins resolved');
  console.log(JSON.stringify({pou,pins:pins.length,dependencies:listing.dependency_artifacts.length,accepted:true}));
 }
 record.make=await tools.get('mw_ide_make').execute({});
 assert.equal(record.make.is_compiled,true);assert.equal(record.make.is_modified,false);
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],record.after[key],key);
 record.phase='accepted';retain();console.log(JSON.stringify({evidence_path,source_baseline_unchanged:true}));
} catch(error) {record.phase='stopped';record.error=error.message;retain();throw error;}
finally {await i.stopBridge();}
