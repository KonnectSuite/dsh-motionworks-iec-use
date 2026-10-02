// Opt-in acceptance on the sole disposable fixture; no controller actions.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-[a-f0-9-]+$/i);
const project=workspace+'/.motionworks/stage/TopCutterS5';
const source='CodexFbdSource',copy='CodexFbdCopy',renamed='CodexFbdRenamed';
const resume=process.env.MOTIONWORKS_FBD_RESUME;
if(resume)assert.match(resume,/^native-fbd-lifecycle-[a-f0-9-]+\.json$/);
const evidence_path=workspace+'/.motionworks/verification/'+(resume??('native-fbd-lifecycle-'+randomUUID()+'.json'));
const record=resume?JSON.parse(readFileSync(evidence_path,'utf8')):{project,phase:'started',events:[]};
const retain=()=>writeFileSync(evidence_path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(tool,args={}) {
 const result=await tools.get(tool).execute({project,baseline_saved:true,...args});
 record.events.push({tool,args,result});retain();
 assert.equal(result.verification?.accepted??result.accepted,true,JSON.stringify(result));
 if(['mw_ide_build','mw_ide_make'].includes(tool)) {
  assert.equal(result.is_compiled,true);
  if(tool==='mw_ide_make')assert.equal(result.is_modified,false);
 }
 console.log(JSON.stringify({tool,operation:args.operation,accepted:true,evidence_path:result.evidence_path}));
 return result;
}
const saved=()=>i.runCode('structure_snapshot',{project});
function equalSources(a,b) {for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(a[key],b[key],key);}
function sameGraph(a,from,b,to) {
 const original=a.pous.find(p=>p.name===from),target=b.pous.find(p=>p.name===to);
 assert.deepEqual({...original,name:to},target);
 // Native copy can retain the original worksheet name. Compare every unique
 // source stream by its role/extension, keeping every byte hash unchanged.
 const streams=(state,name)=>{
  const entries=Object.entries(state.program_sources['POE/'+name+'/src.st1']);
  const normalized=Object.fromEntries(entries.map(([key,value])=>[key.slice(key.lastIndexOf('.')),value]));
  assert.equal(Object.keys(normalized).length,entries.length,'Ambiguous stream role');return normalized;
 };
 assert.deepEqual(streams(a,from),streams(b,to));
}
try {
 if(resume) {
  assert.equal(record.project,project);assert.equal(record.phase,'stopped');
  assert.equal(record.events.at(-1).tool,'mw_ide_pou_change');
  assert.equal(record.events.at(-1).args.operation,'copy');
  const receipt=JSON.parse(readFileSync(record.events.at(-1).result.evidence_path,'utf8'));
  equalSources(receipt.saved_result,await saved());
  sameGraph(record.graph,source,await saved(),copy);
  record.resume_verified=true;record.phase='resumed_after_copy';retain();
 } else {
 record.baseline=await saved();assert.equal(record.baseline.pous.length,7);retain();
 await act('mw_ide_pou_change',{operation:'create',name:source,language:'ST'});
 for(const [name,type,initial_value] of [['Run','BOOL','FALSE'],['Ready','BOOL','FALSE'],['Elapsed','TIME','T#0ms']])
  await act('mw_ide_variable_change',{pou:source,operation:'add',declaration:{name,type,section:'VAR',group:'Default',address:null,initial_value,description:null}});
 await act('mw_ide_fb_insert',{pou:source,block:'TON',library:'IEC',instance:'ProbeTimer',expected_body:'',bindings:{IN:'Run',PT:'T#100ms',Q:'Ready',ET:'Elapsed'}});
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou:source,instance:'CodexFbdInstance'});
 const st=await saved();
 await act('mw_ide_pou_convert',{pou:source,language:'FBD',expected_body_sha256:st.pous.find(p=>p.name===source).body_sha256,conversion_reviewed:true});
 record.graph=await saved();assert.equal(record.graph.pous.find(p=>p.name===source).language,'FBD');retain();
 await act('mw_ide_pou_change',{operation:'copy',name:source,new_name:copy});
 sameGraph(record.graph,source,await saved(),copy);
 }
 await act('mw_ide_pou_change',{operation:'rename',name:copy,new_name:renamed,references_reviewed:true});
 record.renamed=await saved();sameGraph(record.graph,source,record.renamed,renamed);retain();
 const exported=await act('mw_ide_pou_package',{operation:'export',pou:renamed});
 await act('mw_ide_pou_change',{operation:'delete',name:renamed,user_approved:true,references_reviewed:true});
 await act('mw_ide_pou_package',{operation:'import',package_token:exported.package_token,dependencies_reviewed:true});
 record.imported=await saved();equalSources(record.renamed,record.imported);retain();
 await act('mw_ide_task_change',{operation:'assign',name:'BG',pou:renamed,instance:'CodexFbdCopyInstance'});
 const beforeCompile=await saved();
 const listing=await act('mw_ide_graphical_listing',{pou:renamed,limit:10});
 assert.equal(listing.network_count,1);
 const pins=listing.networks.flatMap(n=>n.lines.flatMap(l=>l.symbols)).filter(s=>s.pin_ordinal!==undefined);
 assert.equal(pins.length,4);assert.ok(pins.every(p=>p.resolved));
 assert.deepEqual(pins.map(p=>p.declaration.name).sort(),['ET','IN','PT','Q']);
 await act('mw_ide_make');equalSources(beforeCompile,await saved());
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexFbdCopyInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name:renamed,user_approved:true,references_reviewed:true});
 await act('mw_ide_task_change',{operation:'unassign',name:'BG',instance:'CodexFbdInstance',user_approved:true});
 await act('mw_ide_pou_change',{operation:'delete',name:source,user_approved:true,references_reviewed:true});
 await act('mw_ide_build');await act('mw_ide_make');
 record.after=await saved();equalSources(record.baseline,record.after);
 record.phase='cleaned';record.accepted=true;retain();console.log(JSON.stringify({accepted:true,evidence_path}));
} catch(error) {record.phase='stopped';record.error=error.message;retain();throw error;}
finally {await i.stopBridge();}
