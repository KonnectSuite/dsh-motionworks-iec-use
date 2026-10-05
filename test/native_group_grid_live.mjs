// Fresh scoped fixture experiment; retain raw grid bytes without interpreting away differences.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
const mode=process.argv[2];
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5');
const directory=join(workspace,'.motionworks/verification'),resume=process.env.MW_GRID_EVIDENCE;
if(resume)assert.match(resume,/^native-group-grid-[a-f0-9-]+\.json$/);
const id=resume?resume.slice('native-group-grid-'.length,-5):randomUUID();
const path=join(directory,'native-group-grid-'+id+'.json');
const record=resume?JSON.parse(readFileSync(path,'utf8')):{project,phase:'requested',events:[],accepted:false};
assert.equal(record.project,project);
const retain=()=>writeFileSync(path,JSON.stringify(record,null,2));
const tools=new Map(i.defineTools().map(t=>[t.name,t]));
async function act(name,args={}){
 record.pending={name,args};retain();const result=await tools.get(name).execute({project,baseline_saved:true,...args});
 record.events.push({name,args,result});delete record.pending;retain();
 console.log(JSON.stringify({name,accepted:result.verification?.accepted??result.accepted}));
 if(result.verification)assert.equal(result.verification.accepted,true,JSON.stringify(result.verification));
 else if(typeof result.accepted==='boolean')assert.equal(result.accepted,true,JSON.stringify(result));
 return result;
}
const reader=`import sys,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.grid import parse
raw=CompoundFile(Path(sys.argv[2])).read_stream('Global_Variables.VGR')
Path(sys.argv[3]).write_bytes(raw)
result={'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw),'header':struct.unpack_from('<3I',raw)}
try:
 records=parse(raw)
 result['records']=[{'name':r['name'],'fields':r['fields'],'cells':r['cells'],'tail':r['tail'].hex(),'raw':raw[r['offset']:r['end']].hex()} for r in records]
except Exception as error:result['parse_error']=str(error)
print(json.dumps(result))`;
function capture(phase){
 const file=join(directory,'native-group-grid-'+id+'-'+phase+'.bin');
 const summary=JSON.parse(execFileSync(i.pythonExe(),['-B','-c',reader,join(i.CODE_DIR,'engine'),join(project,'C/Configuration/R/Resource/src.st1'),file],{encoding:'utf8',windowsHide:true}));
 record[phase+'_grid']={file,...summary};retain();return summary;
}
try{
 if(mode==='verify_counters'){
  assert.ok(resume);assert.equal(record.phase,'stopped');assert.equal(record.events.length,5);assert.ok(!record.pending);
  assert.equal(record.events.at(-1).name,'mw_ide_variable_group_change');assert.equal(record.events.at(-1).args.operation,'delete');
  assert.ok(record.events.slice(1).every(e=>(e.result.verification?.accepted??e.result.accepted)===true));
  assert.deepEqual(record.native_before,record.native_after);assert.equal(record.records_identical,true);
  const proof=`import sys,json,struct,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from motionworks_iec_mcp.grid import parse
a=Path(sys.argv[2]).read_bytes();b=Path(sys.argv[3]).read_bytes()
ra=parse(a);rb=parse(b)
assert len(a)==len(b) and len(ra)==len(rb)==164
end=ra[-1]['end'];assert end==rb[-1]['end']
assert all(a[x['offset']:x['end']]==b[y['offset']:y['end']] for x,y in zip(ra,rb))
expected=bytearray(a)
for at in (4,end):
 old=struct.unpack_from('<I',a,at)[0];new=struct.unpack_from('<I',b,at)[0]
 assert new==old+1
 struct.pack_into('<I',expected,at,new)
assert bytes(expected)==b
print(json.dumps({'variable_high_water_before':struct.unpack_from('<I',a,4)[0],'variable_high_water_after':struct.unpack_from('<I',b,4)[0],'group_trailer_counter_before':struct.unpack_from('<I',a,end)[0],'group_trailer_counter_after':struct.unpack_from('<I',b,end)[0],'counter_offsets':[4,end],'all_other_bytes_identical':True}))`;
  record.counter_proof=JSON.parse(execFileSync(i.pythonExe(),['-B','-c',proof,join(i.CODE_DIR,'engine'),record.before_grid.file,record.after_grid.file],{encoding:'utf8',windowsHide:true}));
  record.reconciled=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.after[key],record.reconciled[key],key);
  for(const key of ['pous','tasks','globals','translation_files'])assert.deepEqual(record.before[key],record.reconciled[key],key);
  const expected=structuredClone(record.before.program_sources);
  expected['C/Configuration/R/Resource/src.st1']['Global_Variables.VGR']=record.after_grid.sha256;
  assert.deepEqual(expected,record.reconciled.program_sources);
  record.previous_cleanup_failure=record.error;record.phase='counters_reconciled';retain();
  for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
  assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
  record.final=await i.runCode('structure_snapshot',{project});
  for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.reconciled[key],record.final[key],key);
  record.phase='cleaned_with_verified_counters';record.accepted=true;record.binary_identical=false;record.cleanup_verified=true;retain();
  console.log(JSON.stringify({accepted:true,binary_identical:false,counter_proof:record.counter_proof,evidence_path:path}));
 }else{
 if(!resume){
 const old=JSON.parse(readFileSync(join(directory,'native-groups-live-6a819978-4402-414e-9dfb-f9dc335ab909.json'),'utf8'));
 assert.equal(old.phase,'stopped');assert.equal(old.after.pous.length,7);assert.equal(old.after.globals.length,164);
 assert.equal((await act('mw_ide_compile_state')).is_modified,false);
 record.before=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],old.after[key],key);
 record.native_before=await i.verb('variable_group_snapshot',{},180000);retain();
 const before=capture('before');assert.ok(before.records);const name='CodexGridRoundtrip';
 assert.ok(!record.native_before.groups.some(g=>g.name===name));
 await act('mw_ide_variable_group_change',{operation:'create',name});capture('created');
 await act('mw_ide_variable_change',{operation:'add',declaration:{name:'CodexGridMember',type:'INT',section:'VAR_GLOBAL',group:name,address:null,initial_value:'3',description:null},flags:{retain:true,opc:true}});
 capture('populated');
 }else{
 assert.equal(record.phase,'stopped');assert.equal(record.events.length,3);
 const last=record.events.at(-1);assert.equal(last.name,'mw_ide_variable_change');assert.equal(last.args.operation,'add');assert.equal(last.result.verification.accepted,true);
 assert.equal(last.args.declaration.name,'CodexGridMember');
 const raw=readFileSync(join(directory,'native-group-grid-'+id+'-populated.bin'));
 const observed=capture('reconciled_populated');
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(raw).digest('hex'),observed.sha256);
 const state=await i.runCode('structure_snapshot',{project});
 assert.deepEqual(state.globals,last.result.expected_variables);
 record.previous_failure=record.error;record.phase='reconciled_before_cleanup';retain();
 }
 const name='CodexGridRoundtrip',before=record.before_grid;
 await act('mw_ide_variable_change',{operation:'delete',name:'CodexGridMember',user_approved:true,references_reviewed:true});capture('emptied');
 await act('mw_ide_variable_group_change',{operation:'delete',name,user_approved:true});
 record.native_after=await i.verb('variable_group_snapshot',{},180000);assert.deepEqual(record.native_before,record.native_after);
 const after=capture('after');record.after=await i.runCode('structure_snapshot',{project});
 record.grid_identical=before.sha256===after.sha256;
 record.header_identical=JSON.stringify(before.header)===JSON.stringify(after.header);
 record.records_identical=JSON.stringify(before.records)===JSON.stringify(after.records);retain();
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],record.after[key],key);
 for(const name of ['mw_ide_build','mw_ide_make'])assert.equal((await act(name)).is_compiled,true);
 assert.equal((await act('mw_ide_errors',{pane:'Errors'})).count,0);
 record.final=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','program_sources','translation_files'])assert.deepEqual(record.before[key],record.final[key],key);
 record.phase='cleaned';record.accepted=true;retain();console.log(JSON.stringify({accepted:true,evidence_path:path,grid_identical:record.grid_identical}));
 }
}catch(error){record.phase='stopped';record.error=error.message;retain();console.error(JSON.stringify({accepted:false,evidence_path:path,error:error.message}));process.exitCode=1;}
finally{await i.stopBridge();}
