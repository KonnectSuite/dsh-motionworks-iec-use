// Read-only reconciliation of the retained completed fixture flag matrix.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {__internals as i} from '../index.js';
const workspace=process.env.MOTIONWORKS_MCP_WORKSPACE;
assert.match(workspace??'',/motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266$/);
const project=join(workspace,'.motionworks/stage/TopCutterS5'),dir=join(workspace,'.motionworks/verification');
const matrix=JSON.parse(readFileSync(join(dir,'native-variable-flag-matrix-6074b197-42ad-46b0-bf3e-3636e69daf4f.json'),'utf8'));
const baseline=JSON.parse(readFileSync(join(dir,'arya-engineering-lifecycle.json'),'utf8'));
const reference=JSON.parse(readFileSync(join(dir,'sdk-reader-package-859ee054-0f7d-40ed-963f-7551247569e7.json'),'utf8'));
const file=join(dir,'sdk-variable-flags-cleanup.json');
const record={project,accepted:false,binary_identical:false,controller_downloaded:false};
const retain=()=>writeFileSync(file,JSON.stringify(record,null,2));
try{
 assert.equal(matrix.phase,'stopped');assert.equal(matrix.cursor,42);
 assert.match(matrix.error,/program_sources/);
 assert.deepEqual(matrix.events.slice(-2).map(e=>e.tool),['mw_ide_build','mw_ide_make']);
 assert.ok(matrix.events.slice(-2).every(e=>e.result.is_compiled===true));
 const stream='C/Configuration/R/Resource/src.st1',name='Global_Variables.VGR';
 const beforeHash=matrix.before.program_sources[stream][name];
 assert.equal(beforeHash,baseline.saved.program_sources[stream][name]);
 const reader=`import sys,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.grid import parse
raw=CompoundFile(Path(sys.argv[2])).read_stream('Global_Variables.VGR')
rows=parse(raw)
assert len(rows)==164 and struct.unpack_from('<I',raw)[0]==524289
current=struct.unpack_from('<I',raw,4)[0]
assert current>0
original=bytearray(raw);struct.pack_into('<I',original,4,current-1)
assert hashlib.sha256(original).hexdigest()==sys.argv[3]
Path(sys.argv[4]).write_bytes(raw)
Path(sys.argv[5]).write_bytes(original)
print(json.dumps({'offset':4,'before':current-1,'after':current,'rows':len(rows),'all_other_bytes_identical':True,'current_sha256':hashlib.sha256(raw).hexdigest(),'reconstructed_before_sha256':hashlib.sha256(original).hexdigest()}))`;
 record.counter_proof=JSON.parse(execFileSync(i.pythonExe(),['-B','-c',reader,join(i.CODE_DIR,'engine'),join(project,stream),beforeHash,join(dir,'sdk-flags-grid-current.bin'),join(dir,'sdk-flags-grid-reconstructed-before.bin')],{encoding:'utf8',windowsHide:true}));retain();
 record.saved=await i.runCode('structure_snapshot',{project});
 for(const key of ['pous','tasks','globals','translation_files'])assert.deepEqual(record.saved[key],baseline.saved[key],key);
 const expected=structuredClone(baseline.saved.program_sources);
 expected[stream][name]=record.counter_proof.current_sha256;
 assert.deepEqual(record.saved.program_sources,expected);
 record.native=await i.verb('pou_package_snapshot',{},180000);
 assert.deepEqual(record.native,reference.observations[1].snapshot);
 record.state=await i.verb('compile_state',{},30000);
 assert.equal(record.state.is_modified,false);assert.equal(record.state.is_compiled,true);
 record.phase='cleaned_with_verified_counter';record.accepted=true;retain();
}catch(error){record.error=String(error);retain();throw error;}
finally{await i.stopBridge();console.log(JSON.stringify({accepted:record.accepted,binary_identical:false,evidence_path:file}));}
