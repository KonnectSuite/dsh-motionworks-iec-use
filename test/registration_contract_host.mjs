// Opt-in: run with the installed Electron executable in ELECTRON_RUN_AS_NODE mode
// and DSH_TOOLS_ENTRY pointing at its actual app.asar dsh-tools entry URL.
// No IDE, controller, profile settings or user projects are touched.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const entry=process.env.DSH_TOOLS_ENTRY;
assert.ok(entry,'Set DSH_TOOLS_ENTRY to the actual host dsh-tools module URL');
const host=await import(entry);
const plugin=await import(process.env.MW_PLUGIN?pathToFileURL(process.env.MW_PLUGIN+'/index.js').href:'../index.js');
const registered=new Map();
const runtime={ctx:{},layers:{effect(_ctx,fn){fn({tools:{insert(name,definition){assert.ok(!registered.has(name));registered.set(name,definition);}}});return ()=>{};}}};
const ctx={get:()=>undefined,on(){},logger:{warn(){}},tools:{register(definition){
  host.assertObjectJsonSchema(definition.parameters);
  return host.ToolRuntime.prototype.register.call(runtime,definition);
}}};
try{
  plugin.apply(ctx);
  assert.equal(registered.size,plugin.__internals.defineTools().length);
  console.log(`Actual installed host register() accepted ${registered.size} tools and their parameter schemas`);
}finally{await plugin.__internals.stopBridge();}
