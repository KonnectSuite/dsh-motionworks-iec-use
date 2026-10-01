// Supervised live smoke: no mouse/keyboard input, saves, closes or controller calls.
// Operator/agent uses native IDE dialog between prepare and verify commands.
import {apply,__internals} from '../index.js';
import {createInterface} from 'node:readline';
const tools=new Map();apply({get:()=>undefined,tools:{register:t=>tools.set(t.name,t)},on(){}});
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
if(!workspace)throw new Error('Explicit disposable workspace required');
const project=workspace+'/.motionworks/stage/TopCutterS5';
const run=(name,args={})=>tools.get(name).execute(args,{agent:{id:'dialog-smoke',session:{header:{cwd:workspace}}}});
let plan;
console.log('Commands: local, global, external, verify, view, build, quit. Native input is never sent by this script.');
try {
  for await(const command of createInterface({input:process.stdin,terminal:false})) {
    try {
      if(command==='quit')break;
      if(command==='view')console.log(JSON.stringify(await run('mw_ide_active_view')));
      if(['local','global','external'].includes(command)) {
        const global=command==='global',external=command==='external';
        plan=await run('mw_ide_variable_plan',{project,baseline_saved:true,...(!global?{pou:'TopCutterCutControl'}:{}),
          declaration:{name:external||global?'CodexDialogGlobal':'CodexDialogLocal',type:'INT',
            section:global?'VAR_GLOBAL':external?'VAR_EXTERNAL':'VAR',group:global?'User Variables':'Default',address:null,
            initial_value:external?null:'42',description:external?null:'Disposable native dialog smoke'}});
        console.log(JSON.stringify(plan));
      }
      if(command==='verify'){if(!plan)throw new Error('No retained plan');console.log(JSON.stringify(await run('mw_ide_variable_verify',{token:plan.token})));}
      if(command==='build')console.log(JSON.stringify(await run('mw_ide_verify',{project})));
    }catch(e){console.log('REFUSED/FAILED: '+e.message);}
  }
}finally{await __internals.stopBridge();}
