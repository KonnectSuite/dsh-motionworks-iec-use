// Prepare or inspect an IDE-only smoke session. Never writes POU/global native code.
// UI editing is performed by the agent using the computer tool, not this script.
import {apply, __internals} from '../index.js';
import {randomUUID, createHash} from 'node:crypto';
import {cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {basename, join, resolve, relative, isAbsolute} from 'node:path';
const args=process.argv.slice(2);
const opt=k=>{const i=args.indexOf(k);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${k} value`);return args[i+1];};
const mode=args[0];
const tools=new Map();
apply({get:()=>undefined,tools:{register:t=>tools.set(t.name,t)},on(){}});
const ctx=workspace=>({agent:{id:'ide-ui-smoke',session:{header:{cwd:workspace}}}});
const hashes=root=>{
  const result={};
  const walk=(dir,rel='')=>{for(const e of readdirSync(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())throw new Error('Fixture links refused');
    const name=rel?`${rel}/${e.name}`:e.name;
    if(e.isDirectory())walk(join(dir,e.name),name);
    else if(e.isFile())result[name]=createHash('sha256').update(readFileSync(join(dir,e.name))).digest('hex');
  }};walk(root);return result;
};
try {
  if(mode==='prepare') {
    if(!args.includes('--workspace')||!args.includes('--source'))throw new Error('Explicit workspace and source required');
    const parent=resolve(opt('--workspace')),source=resolve(opt('--source'));
    const sourceRelative=relative(parent,source);
    if(!sourceRelative||sourceRelative.startsWith('..')||isAbsolute(sourceRelative)||!/\.mwt$/i.test(source))
      throw new Error('Source must be a .mwt inside the explicitly supplied workspace');
    const discovered=await tools.get('mw_project_find').execute({},ctx(parent));
    console.log('DISCOVERY',JSON.stringify(discovered));
    const workspace=join(parent,'motionworks-ide-smoke-'+randomUUID());
    mkdirSync(workspace);
    const input=join(workspace,basename(source));
    const sourceDir=source.replace(/\.mwt$/i,'');
    const before=hashes(sourceDir);
    cpSync(source,input);cpSync(sourceDir,input.replace(/\.mwt$/i,''),{recursive:true});
    const run=(name,params={})=>tools.get(name).execute(params,ctx(workspace));
    await run('mw_project_find');
    const stage=await run('mw_ide_stage',{source:input});
    const project=stage.staged_directory;
    const evidence={workspace,source,stage,before_source:before,
      before:await run('mw_code_source_manifest',{project}),
      ready:await run('mw_workflow_check',{project}),
      guides:[],ui_edits:[],verdict:'prepared-not-edited',controller_downloaded:false};
    for(const operation of ['st','variables','pou','graphical','tasks','libraries'])
      evidence.guides.push(await run('mw_ide_edit_guide',{operation}));
    writeFileSync(join(workspace,'ide-ui-evidence.json'),JSON.stringify(evidence,null,2));
    console.log('PREPARED',JSON.stringify({workspace,project,ready:evidence.ready}));
  } else if(mode==='inspect'||mode==='verify'||mode==='reopen-inspect') {
    const workspace=resolve(opt('--workspace'));
    const evidence=JSON.parse(readFileSync(join(workspace,'ide-ui-evidence.json'),'utf8'));
    const project=evidence.stage.staged_directory;
    const run=(name,params={})=>tools.get(name).execute(params,ctx(workspace));
    const inspection={pous:await run('mw_code_pous',{project}),tasks:await run('mw_code_tasks',{project}),
      smoke:await run('mw_code_read_st',{project,pou:'CodexIdeSmoke'}),
      source_unchanged:JSON.stringify(hashes(evidence.source.replace(/\.mwt$/i,'')))===JSON.stringify(evidence.before_source),
      wrapper_unchanged:readFileSync(evidence.source).equals(readFileSync(join(workspace,basename(evidence.source))))};
    if(mode==='reopen-inspect') {
      if(!evidence.inspection)throw new Error('Run verify before the separately approved UI close/reopen');
      const persistence={checked_at:new Date().toISOString(),
        saved_smoke_unchanged:JSON.stringify(inspection.smoke)===JSON.stringify(evidence.inspection.smoke),
        task_inventory_unchanged:JSON.stringify(inspection.tasks)===JSON.stringify(evidence.inspection.tasks),
        pou_inventory_unchanged:JSON.stringify(inspection.pous)===JSON.stringify(evidence.inspection.pous),
        source_unchanged:inspection.source_unchanged,wrapper_unchanged:inspection.wrapper_unchanged,
        note:'Disk read-back comparison only. Actual close/reopen and UI/compiler evidence must be observed separately.'};
      evidence.reopen_readback=persistence;
      writeFileSync(join(workspace,'ide-ui-evidence.json'),JSON.stringify(evidence,null,2));
      console.log(JSON.stringify(persistence));
      if(Object.entries(persistence).some(([k,v])=>k.endsWith('_unchanged')&&v!==true))throw new Error('Reopen read-back mismatch; inspect evidence before proceeding');
    } else if(mode==='verify') {
      evidence.inspection=inspection;
      evidence.verification=await run('mw_ide_verify',{project});
      evidence.verdict=evidence.verification.verdict;
      writeFileSync(join(workspace,'ide-ui-evidence.json'),JSON.stringify(evidence,null,2));
      console.log(JSON.stringify({source_unchanged:inspection.source_unchanged,wrapper_unchanged:inspection.wrapper_unchanged,
        verdict:evidence.verification.verdict,report_path:evidence.verification.report_path}));
    } else console.log(JSON.stringify(inspection));
  } else throw new Error('Supported modes: prepare, inspect, verify, reopen-inspect');
} finally {await __internals.stopBridge();}
