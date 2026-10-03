// Opt-in read-only diagnostic acceptance on the sole disposable fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const path=join(workspace,'.motionworks/verification','native-output-pane-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false,panes:[]};
try{
 record.before=await i.runCode('structure_snapshot',{project});
 const read=i.defineTools().find(t=>t.name==='mw_ide_errors');
 for(const pane of ['Errors','Warnings','Infos','Build']){
  const result=await read.execute({pane,limit:200});record.panes.push(result);
  assert.equal(result.pane,pane);assert.equal(result.count,result.lines.length);
 }
 assert.deepEqual(record.panes[0].lines,["The VAR_IN_OUT parameter 'Accum' is not connected to a variable!"]);
 assert.equal(record.panes[1].lines.at(-1),"Variable 'TopCutter_Homing' is never used!");
 assert.equal(record.panes[2].lines.at(-1),'Tokens count: 1');
 assert.ok(record.panes[3].lines.some(line=>line.includes('CodexFbHash')),'Expected retained compiler output from assigned target');
 await assert.rejects(read.execute({pane:'MissingPane'}),/No exact output pane/);
 record.after=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.before[key],key);
 record.accepted=true;console.log(JSON.stringify({accepted:true,evidence_path:path,counts:record.panes.map(p=>({pane:p.pane,count:p.count}))}));
}catch(error){record.error=error.message;throw error;}
finally{writeFileSync(path,JSON.stringify(record,null,2));await i.stopBridge();}
