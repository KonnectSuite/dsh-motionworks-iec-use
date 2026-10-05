import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {assertStageClosed} from '../stage-copy.js';
const target=resolve('fixture-stage/Probe'),running={ide_running:true,blocked:false};
assert.doesNotThrow(()=>assertStageClosed(target,{ide_running:false}));
assert.doesNotThrow(()=>assertStageClosed(target,running,{is_project_open:false}));
assert.doesNotThrow(()=>assertStageClosed(target,running,{is_project_open:true,active_project:target+'Other.mwt'}));
for(const active of [target,target+'.mwt',join(target,'POE','Logic','src.st1')])
 assert.throws(()=>assertStageClosed(target,running,{is_project_open:true,active_project:active}),/open in the IDE/);
for(const state of [undefined,{}, {ide_running:false,blocked:true},{ide_running:false,verifier_running:true}])
 assert.throws(()=>assertStageClosed(target,state),/unknown|unresolved/);
for(const status of [undefined,{}, {is_project_open:true},{is_project_open:true,active_project:''}])
 assert.throws(()=>assertStageClosed(target,running,status),/unknown/);
console.log('Stage replacement refuses open/unknown/modal targets and allows a closed or different active project');
