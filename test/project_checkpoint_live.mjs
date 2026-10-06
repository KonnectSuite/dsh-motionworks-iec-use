// Opt-in registered read-only tool acceptance; exact disposable fixture only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','checkpoint-live-'+randomUUID()+'.json');
const tool=i.defineTools().find(t=>t.name==='mw_ide_verify'),record={accepted:false,controller_action:false};
try{
 record.capture=await tool.execute({project,mode:'capture_baseline',baseline_saved:true});
 assert.equal(record.capture.accepted,true,record.capture.next_step);assert.equal(record.capture.verdict,'baseline_captured');
 const receipt=JSON.parse(readFileSync(record.capture.baseline_path));
 assert.equal(receipt.snapshot.native.libraries.length,7);assert.equal(receipt.snapshot.libraries.length,7);
 assert.equal(receipt.snapshot.saved.pous.length,7);assert.equal(receipt.snapshot.saved.globals.length,164);
 const existing=JSON.parse(readFileSync(join(workspace,'.motionworks/verification/arya-live-compiler-checkpoint.json')));
 assert.deepEqual(receipt.snapshot.native,existing.native);
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(receipt.snapshot.saved[key],existing.saved[key]);
 record.compare=await tool.execute({project,mode:'compare_baseline',baseline_id:record.capture.baseline_id,baseline_saved:true});
 assert.equal(record.compare.accepted,true,record.compare.next_step);assert.equal(record.compare.comparison.fresh_compile_verified,false);
 record.tampered=await tool.execute({project,mode:'compare_baseline',baseline_id:record.capture.baseline_id.slice(0,-1)+(record.capture.baseline_id.endsWith('0')?'1':'0'),baseline_saved:true});
 assert.equal(record.tampered.accepted,false);assert.match(JSON.parse(readFileSync(record.tampered.report_path)).error,/integrity/);
 assert.equal(readFileSync(record.capture.baseline_path,'utf8'),JSON.stringify(receipt,null,2));
 record.accepted=true;
}finally{writeFileSync(file,JSON.stringify(record,null,2));await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,evidence:file,capture:record.capture?.report_path,compare:record.compare?.report_path}));}
