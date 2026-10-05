// Opt-in read-only native-bound review of the sole authorized disposable fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const file=join(workspace,'.motionworks/verification','program-review-render-'+randomUUID()+'.json');
const record={project,accepted:false,controller_downloaded:false};
const digest=s=>createHash('sha256').update(JSON.stringify(Object.fromEntries(['pous','tasks','globals','program_sources','translation_files'].map(k=>[k,s[k]])))).digest('hex');
try{
 record.before=digest(await i.runCode('structure_snapshot',{project}));
 const tool=i.defineTools().find(t=>t.name==='mw_code_check_program');
 const response=await tool.execute({project,installed_interfaces:true});
 record.response=response;
 assert.notEqual(response.ok,false);assert.equal(response.result.verification,'static_review_only');
 assert.equal(response.result.interface_resolution,'bound_installed_requested');
 assert.ok(response.result.coverage.some(c=>c.status==='graphical_body_not_analyzed'));
 const blocks=tool.output.render({},response);
 record.report=response.result;record.rendered=blocks.map(c=>c.text??'').join('\n');
 assert.deepEqual(JSON.parse(record.rendered.slice(record.rendered.indexOf('{'))),response.result);
 assert.ok(record.rendered.length>400,'Exercise the original truncation boundary');
 record.after=digest(await i.runCode('structure_snapshot',{project}));assert.equal(record.after,record.before);
 record.state=await i.verb('compile_state',{},30000);assert.equal(record.state.is_modified,false);assert.equal(record.state.is_compiled,true);
 record.accepted=true;
 console.log(JSON.stringify({accepted:true,evidence:file,findings:record.report.findings.length,errors:record.report.errors,warnings:record.report.warnings,characters:record.rendered.length,coverage:record.report.coverage.filter(c=>c.pou).map(c=>({pou:c.pou,status:c.status}))}));
}catch(error){record.error=error.message;throw error;}
finally{writeFileSync(file,JSON.stringify(record,null,2));await i.stopBridge();}
