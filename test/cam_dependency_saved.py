"""Opt-in read-only comparison of the exact fixture's retained CamGenerator caches.

This proves saved metadata parsing, not freshness, insertion or machine behavior.
No native bridge, Build or desktop input is invoked.
"""
import hashlib,json,os,re,sys,uuid
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'code'/'engine'))
from motionworks_iec_mcp.cfb import CompoundFile
from motionworks_iec_mcp.variables import parse_declarations
from motionworks_iec_mcp.graphical_listing import pin_bindings,DEPENDENCY_DECLARATION

workspace=Path(os.environ['MOTIONWORKS_MCP_WORKSPACE'])
assert workspace.name=='motionworks-ide-smoke-58d23aaa-bb28-4c44-aad8-5ad9d9cbd266'
project=workspace/'.motionworks/stage/TopCutterS5'
dependency=project/'C/Configuration/R/Resource/ICI00036.DIT'
library=Path(r'C:\Users\Public\Documents\MotionWorks IEC 3 Pro\Libraries\Cam_Toolbox_v375')
source=library/'POE/CamGenerator/src.st1';cache=library/'POE/CamGenerator/tmp.sto'
file=workspace/'.motionworks/verification'/('cam-dependency-saved-'+str(uuid.uuid4())+'.json')
record=dict(accepted=False,scope='read-only saved compiler metadata',freshness_verified=False,controller_downloaded=False)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
try:
 watched=[dependency,source,cache,library/'LIST.POU']
 before={str(p):digest(p) for p in watched}
 text=CompoundFile(cache).read_stream('@$@$@$@$.clu').decode('latin1').replace('\r','')
 assert re.search(r'^FUNCTION_BLOCK CamGenerator$',text,re.M)
 markers=list(re.finditer(r'^@WS (.+)$',text,re.M))
 assert len(markers)>=2 and markers[0][1]==r'POE\CamGenerator\Variables.vb'
 declarations=text[markers[0].end():markers[1].start()]
 declarations=re.sub(r'^@V \d+ \d+\s*','',declarations,flags=re.M)
 table=parse_declarations(declarations)
 assert not table.warnings and len(table.variables)==140
 sections={'VAR_INPUT':'input','VAR_OUTPUT':'output','VAR_IN_OUT':'in_out'}
 declared=[dict(name=v.name,type=v.type_name,direction=sections[v.section]) for v in table.variables if v.section in sections]
 expected=[('CamData','CamSegmentStruct','in_out'),('CamTable','Y_MS_CAM_STRUCT','in_out'),('Execute','BOOL','input'),('TableSize','UDINT','input'),('Done','BOOL','output'),('Busy','BOOL','output'),('Error','BOOL','output'),('ErrorID','UINT','output')]
 assert [(p['name'],p['type'],p['direction']) for p in declared]==expected
 # Synthetic caller binding selects the actual saved dependency. It does not
 # create an instance or fabricate a public interface in the project.
 caller='ProbeCam\t1\tVAR\t@FB:36\n\n;\n'
 pins,artifacts=pin_bindings('@IFBP 1.1',caller,[SimpleNamespace(name='ProbeCam',type_name='CamGenerator')],dependency.with_name('ICI00001.CIC'),project)
 assert [(p['declaration']['name'],p['pin_direction']) for p in pins.values()]==[(name,direction) for name,_,direction in expected]
 rows=list(DEPENDENCY_DECLARATION.finditer(dependency.read_text('latin1')))
 assert len(rows)==141 and rows[-1][1]=='@T_Code_00' and rows[-1][3]=='VAR'
 assert all(p['declaration']['name']!='@T_Code_00' for p in pins.values())
 assert before=={str(p):digest(p) for p in watched}
 record.update(accepted=True,source_declaration_count=140,compiler_declaration_count=141,public_pins=declared,hashes=before,dependency_artifacts=artifacts)
 print(json.dumps(dict(accepted=True,evidence=str(file),pins=len(pins),freshness_verified=False)))
except Exception as error:
 record['error']=str(error);raise
finally:
 file.write_text(json.dumps(record,indent=2))
