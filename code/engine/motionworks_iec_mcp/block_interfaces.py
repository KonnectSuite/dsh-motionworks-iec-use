"""Read block interfaces from the project's bound, installed libraries.

Firmware .PT parameter tables explicitly encode direction/type. User library
interfaces come from declaration streams, never from compiled identifier heaps.
This module only reads; no library is opened for editing or copied into a POU.
"""
import hashlib
import re
from pathlib import Path
from .cfb import CompoundFile
from .project import Project

SECTIONS={'VAR_INPUT':'input','VAR_OUTPUT':'output','VAR_IN_OUT':'in_out'}
KINDS={'FUNCTION':'FUNCTION','FUNCTION_BLOCK':'FUNCTION_BLOCK','FUNCTIONBLOCK':'FUNCTION_BLOCK','PROGRAM':'PROGRAM'}
IDENTIFIER=re.compile(r'^[A-Za-z_][A-Za-z_0-9]*$')

def parse_parameter_table(data):
    headers={}; pins=[]; started=False
    for line in data.decode('latin1').splitlines():
        if not line.strip():continue
        if line=='parameters:':started=True;continue
        if not started:
            key,sep,value=line.partition(':')
            if not sep or key in headers:raise ValueError('Malformed parameter-table header')
            headers[key]=value.strip()
        else:
            columns=line.split('\t')
            if len(columns)<4 or columns[0] or columns[1] not in SECTIONS:raise ValueError('Unsupported parameter-table row')
            section,name,type_name=columns[1:4]
            if not IDENTIFIER.fullmatch(name) or not type_name:raise ValueError('Invalid parameter identity')
            pins.append(dict(name=name,type=type_name,section=section,direction=SECTIONS[section],native_attributes=columns[4:]))
    name=headers.get('pouName','');kind=KINDS.get(headers.get('pouKind',''))
    if not IDENTIFIER.fullmatch(name) or not kind or not started or not headers.get('parNum','').isdigit():raise ValueError('Unsupported parameter-table identity/count')
    if len(pins)!=int(headers['parNum']) or len({p['name'].casefold() for p in pins})!=len(pins):raise ValueError('Parameter-table count/identity mismatch')
    return dict(name=name,kind=kind,pins=pins,native_headers=headers)

def _registry(path):
    rows=[]
    for line in path.read_text(encoding='latin1').splitlines():
        if not line.strip():continue
        cols=line.split('\t');kind=KINDS.get(cols[0].upper())
        if not kind or len(cols)<2 or not IDENTIFIER.fullmatch(cols[1]):raise ValueError('Unsupported library registry row')
        alias=cols[5] if len(cols)>5 and cols[5] else cols[1]
        if not IDENTIFIER.fullmatch(alias):raise ValueError('Unsupported library worksheet alias')
        rows.append(dict(name=cols[1],kind=kind,alias=alias,hidden=any(c=='HIDDEN=1' for c in cols)))
    if len({r['name'].casefold() for r in rows})!=len(rows):raise ValueError('Duplicate library registry name')
    return rows

def _same_path(a,b):return str(Path(a).resolve()).casefold()==str(Path(b).resolve()).casefold()

def sources(root,native_libraries):
    root=Path(root);project=Project(root)
    native={r['name'].casefold():r for r in native_libraries}
    if len(native)!=len(native_libraries):raise ValueError('Ambiguous native library inventory')
    result=[dict(library='project',kind='PROJECT',root=root,registry=root/'LIST.POU',binding='active_project')]
    lines=(root/'@LIBRARY.LST').read_text(encoding='latin1').splitlines()
    if not lines or lines[0]!='Library List, V40':raise ValueError('Unsupported saved library registry')
    used=set()
    for line in lines[1:]:
        if not line.strip():continue
        fields=line.split(';')
        if len(fields)!=4 or fields[0] not in ['FW','USER']:raise ValueError('Unsupported saved library reference')
        kind,path,label,flags=fields;directory=Path(path)
        library=directory.name if kind=='USER' else label
        if not IDENTIFIER.fullmatch(library):raise ValueError('Unsupported library name')
        row=native.get(library.casefold())
        expected=Path(str(directory)+'.mwt') if kind=='USER' else directory/(label+'.fwl')
        if row:
            if not _same_path(row['full_name'],expected):raise ValueError('Saved/native library paths disagree: '+library)
            used.add(library.casefold());binding='native_reference'
        elif kind=='FW' and library.casefold() in ['iec','eclr']:
            binding='saved_implicit_reference'
        else:raise ValueError('Saved/native library inventories disagree: '+library)
        registry=directory/'LIST.POU' if kind=='USER' else directory/(label+'.POU')
        result.append(dict(library=library,kind=kind,root=directory,registry=registry,binding=binding,reference_file=expected,flags=flags))
    if used!=set(native):raise ValueError('Native library absent from saved references')
    return result

def inspect(root,native_libraries,name=None,library=None):
    candidates=[];unavailable=[]
    for source in sources(root,native_libraries):
        if library and source['library'].casefold()!=library.casefold():continue
        try:rows=_registry(source['registry'])
        except (OSError,ValueError) as error:
            unavailable.append(dict(library=source['library'],error=str(error)));continue
        for row in rows:
            if name and row['name'].casefold()!=name.casefold():continue
            candidates.append({**row,'library':source['library'],'binding':source['binding'],'_source':source})
    if not name:
        return dict(blocks=[{k:v for k,v in row.items() if k!='_source'} for row in candidates],unavailable_libraries=unavailable,
                    evidence_kind='bound-installed-block-catalog',action_performed=False)
    if len(candidates)!=1:raise ValueError('Block absent or ambiguous; specify its library. Candidates: '+str([(c['library'],c['name']) for c in candidates])+'; unavailable: '+str(unavailable))
    row=candidates[0];source=row.pop('_source')
    if source['kind']=='FW':
        file=source['root']/'tmp.sto';container=CompoundFile(file)
        matches=[n for n in container.stream_names() if n.casefold()==(row['alias']+'.PT').casefold()]
        if len(matches)!=1:raise ValueError('Firmware parameter table absent or ambiguous')
        data=container.read_stream(matches[0]);interface=parse_parameter_table(data)
        if interface['name'].casefold()!=row['name'].casefold() or interface['kind']!=row['kind']:raise ValueError('Registry/parameter interface identity mismatch')
        row.update(interface);row.update(source_stream=matches[0],source_sha256=hashlib.sha256(data).hexdigest(),origin='firmware_parameter_table')
    else:
        pou=Project(source['root']).pou(row['name']);table=pou.declarations()
        if table.warnings:raise ValueError('Declaration interface parse warnings: '+str(table.warnings))
        file=pou.source_path
        row['pins']=[dict(name=v.name,type=v.type_name,section=v.section,direction=SECTIONS[v.section],initial_value=v.initial_value,description=v.description)
                     for v in table.variables if v.section in SECTIONS]
        row.update(source_sha256=hashlib.sha256(file.read_bytes()).hexdigest(),source_stream=table.source_stream,origin='project_declarations' if source['kind']=='PROJECT' else 'user_library_declarations')
    row.update(source_file=str(file),reference_registry=str(source['registry']),registry_sha256=hashlib.sha256(source['registry'].read_bytes()).hexdigest(),
               evidence_kind='installed-declared-block-interface',action_performed=False,
               note='Pin directions/types come from declarations or native parameter tables. Implicit references are identified separately. Verify the selected controller/firmware profile and Build/Make before machine use.')
    return row
