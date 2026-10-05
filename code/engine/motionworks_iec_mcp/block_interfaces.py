"""Read block interfaces from the project's bound, installed libraries.

Firmware .PT parameter tables explicitly encode direction/type. User library
interfaces come from declaration streams, never from compiled identifier heaps.
Unsupported worksheets can expose independently counted, explicit cache
declarations as diagnostic evidence only, with insertion eligibility false.
This module only reads; no library is opened for editing or copied into a POU.
"""
import hashlib
import re
from pathlib import Path
from .cfb import CompoundFile
from .project import Project
from .tree import parse_document
from .variables import decode_declarations,read_grid_variable_count,cross_check,parse_declarations,CompressedStreamError
from .graphical_listing import DEPENDENCY_DECLARATION,identity as compiler_identity

SECTIONS={'VAR_INPUT':'input','VAR_OUTPUT':'output','VAR_IN_OUT':'in_out'}
KINDS={'FUNCTION':'FUNCTION','FUNCTION_BLOCK':'FUNCTION_BLOCK','FUNCTIONBLOCK':'FUNCTION_BLOCK','PROGRAM':'PROGRAM'}
IDENTIFIER=re.compile(r'^[A-Za-z_][A-Za-z_0-9]*$')

def parse_compiled_interface(listing,dependency,name,worksheet):
    """Diagnostic pins from explicit cache declarations, independently counted.

    This does not establish freshness against a protected source worksheet and
    intentionally has a different evidence kind from insertion-eligible tables.
    """
    if '\0' in listing or '\0' in dependency:raise ValueError('Unsupported compiled interface encoding')
    listing=listing.replace('\r','')
    header=re.match(r'\A\(\*\n(.*?)\n\*\)\nFUNCTION_BLOCK ([A-Za-z_][A-Za-z_0-9]*)\n',listing,re.S)
    if not header or header[2]!=name:raise ValueError('Compiled library interface identity mismatch')
    counts=re.findall(r'^NVD:\s*(\d+)\s*$',header[1],re.M)
    kinds=re.findall(r'^T:\s*(\w+)\s*$',header[1],re.M)
    if kinds!=['FUNCTION_BLOCK'] or len(counts)!=1:raise ValueError('Compiled library header absent or ambiguous')
    markers=list(re.finditer(r'^@WS (.+)$',listing,re.M))
    expected='POE/'+name+'/'+worksheet
    if len(markers)<2 or markers[0][1].replace('\\','/').casefold()!=expected.casefold():
        raise ValueError('Compiled declaration worksheet identity mismatch')
    declaration=listing[markers[0].end():markers[1].start()]
    handles=re.findall(r'^@V (\d+) (\d+)\s+',declaration,re.M)
    if not handles or len(set(handles))!=len(handles):raise ValueError('Compiled source declaration handles absent or duplicate')
    cleaned=re.sub(r'^@V \d+ \d+\s*','',declaration,flags=re.M)
    table=parse_declarations(cleaned)
    if table.warnings or len(table.variables)!=len(handles):raise ValueError('Compiled source declarations incomplete')
    names=[v.name.casefold() for v in table.variables]
    if len(set(names))!=len(names):raise ValueError('Duplicate compiled source declaration name')
    if compiler_identity(dependency)!=('FUNCTION_BLOCK',name):raise ValueError('Compiler dependency block identity mismatch')
    dep_header=dependency.split('*)',1)[0]
    dep_counts=re.findall(r'^QVE:\s*(\d+)\s*$',dep_header,re.M)
    par_counts=re.findall(r'^QPar:\s*(\d+)\s*$',dep_header,re.M)
    rows=list(DEPENDENCY_DECLARATION.finditer(dependency))
    if len(dep_counts)!=1 or int(dep_counts[0])!=int(counts[0]) or len(rows)!=int(counts[0]):raise ValueError('Compiler declaration count mismatch')
    if {int(r[2]) for r in rows}!=set(range(1,len(rows)+1)) or len({r[1].casefold() for r in rows})!=len(rows):
        raise ValueError('Compiler declaration ordinals/names incomplete or duplicate')
    source={(v.name,v.section) for v in table.variables}
    ordinary={(r[1],r[3]) for r in rows if not re.fullmatch(r'@T_Code_\d+',r[1])}
    if source!=ordinary or any(r[3]!='VAR' for r in rows if r[1].startswith('@')):
        raise ValueError('Library/dependency declaration identities differ')
    pins=[dict(name=v.name,type=v.type_name,section=v.section,direction=SECTIONS[v.section],initial_value=v.initial_value,description=v.description)
          for v in table.variables if v.section in SECTIONS]
    if par_counts!=[str(len(pins))] or not pins:raise ValueError('Compiler public parameter count mismatch')
    return dict(pins=pins,source_declaration_count=len(table.variables),compiler_declaration_count=len(rows))

def _cached_library_interface(project_root,library_root,pou):
    cache=pou.source_path.parent/'tmp.sto'
    if not cache.resolve().is_relative_to(Path(library_root).resolve()):raise ValueError('Linked library cache escapes its bound root')
    before=hashlib.sha256(cache.read_bytes()).hexdigest()
    source_hash=hashlib.sha256(pou.source_path.read_bytes()).hexdigest()
    container=CompoundFile(cache);stream='@$@$@$@$.clu'
    matches=[n for n in container.stream_names() if n.casefold()==stream.casefold()]
    worksheets=[n for n in pou.source().stream_names() if n.upper().endswith('.VB')]
    if len(matches)!=1 or len(worksheets)!=1:raise ValueError('Compiled library declaration stream absent or ambiguous')
    listing=container.read_stream(matches[0])
    if len(listing)>2_000_000:raise ValueError('Compiled declaration cache exceeds bound')
    dependencies=[]
    for path in (Path(project_root)/'C').rglob('ICI*.DIT'):
        if not path.resolve().is_relative_to(Path(project_root).resolve()):raise ValueError('Linked compiler dependency escapes project')
        if path.stat().st_size>2_000_000:raise ValueError('Compiler dependency exceeds bound')
        raw=path.read_bytes()
        try:kind,name=compiler_identity(raw.decode('latin1'))
        except ValueError:continue
        if kind=='FUNCTION_BLOCK' and name==pou.name:dependencies.append((path,raw))
    if len(dependencies)!=1:raise ValueError('Matching saved compiler dependency absent or ambiguous')
    dependency,raw=dependencies[0]
    identifiers=re.findall(r'^CI#:\s*(\d+)\s*$',raw.decode('latin1').split('*)',1)[0],re.M)
    if len(identifiers)!=1 or int(identifiers[0])!=int(dependency.stem[3:]):raise ValueError('Compiler dependency file/type identity mismatch')
    result=parse_compiled_interface(listing.decode('latin1'),raw.decode('latin1'),pou.name,worksheets[0])
    if before!=hashlib.sha256(cache.read_bytes()).hexdigest() or raw!=dependency.read_bytes() or source_hash!=hashlib.sha256(pou.source_path.read_bytes()).hexdigest():raise ValueError('Compiled interface changed during read')
    result.update(source_stream=matches[0],cache_file=str(cache),cache_sha256=before,
                  worksheet_file=str(pou.source_path),worksheet_sha256=source_hash,
                  compiler_dependency=str(dependency),compiler_dependency_sha256=hashlib.sha256(raw).hexdigest(),
                  origin='user_library_compiled_declarations',compiler_cache_freshness_verified=False,compiler_source_binding_verified=False,
                  insertion_eligible=False,evidence_kind='installed-compiled-block-interface')
    return result

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

def _user_library_declarations(root,pou):
    if pou.declaration_stream_name() is not None:
        return pou.declarations()
    # User libraries can name their worksheets Variables/Code instead of
    # <POU>V/<POU>. Bind the one declaration stream to its saved grid worksheet;
    # do not infer directions from compiler heaps or unrelated streams.
    container=pou.source();names=container.stream_names()
    matches=[n for n in names if n.upper().endswith('.VB')]
    if len(matches)!=1 or not matches[0][:-3]:
        raise ValueError('User-library declaration worksheet absent or ambiguous')
    declaration=matches[0];grid=declaration[:-3]+'.VGR'
    grids=[n for n in names if n.casefold()==grid.casefold()]
    if len(grids)!=1:raise ValueError('User-library declaration/grid worksheet pair absent or ambiguous')
    document=parse_document(CompoundFile(Path(root)/'src.st1').read_stream('PROJECT.TRE').decode('latin1'))
    expected=('POE/'+pou.name+'/'+grids[0]).casefold()
    nodes=[n for n,_ in document.walk_with_ancestors()
           if n.path.split('\t')[0].replace('\\','/').casefold()==expected]
    if document.warnings or len(nodes)!=1 or document.lines[nodes[0].start_line].strip()!='8':
        raise ValueError('User-library variable worksheet tree identity absent or ambiguous')
    table=decode_declarations(container.read_stream(declaration),declaration)
    count=read_grid_variable_count(container.read_stream(grids[0]))
    if count is None:raise ValueError('User-library variable grid count unavailable')
    table.warnings.extend(cross_check(table,count))
    return table

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
        pou=Project(source['root']).pou(row['name'])
        try:
            table=_user_library_declarations(source['root'],pou) if source['kind']=='USER' else pou.declarations()
        except CompressedStreamError:
            if source['kind']!='USER':raise
            row.update(_cached_library_interface(root,source['root'],pou))
            file=Path(row['cache_file'])
            row.update(source_sha256=hashlib.sha256(file.read_bytes()).hexdigest(),source_file=str(file),
                       reference_registry=str(source['registry']),registry_sha256=hashlib.sha256(source['registry'].read_bytes()).hexdigest(),
                       action_performed=False,note='Diagnostic cache declarations matched a saved compiler dependency. Freshness against the protected worksheet is unverified; do not use this interface for insertion. Native Build and complete source/library validation are still required.')
            return row
        if table.warnings:raise ValueError('Declaration interface parse warnings: '+str(table.warnings))
        file=pou.source_path
        row['pins']=[dict(name=v.name,type=v.type_name,section=v.section,direction=SECTIONS[v.section],initial_value=v.initial_value,description=v.description)
                     for v in table.variables if v.section in SECTIONS]
        row.update(source_sha256=hashlib.sha256(file.read_bytes()).hexdigest(),source_stream=table.source_stream,origin='project_declarations' if source['kind']=='PROJECT' else 'user_library_declarations')
    row.update(source_file=str(file),reference_registry=str(source['registry']),registry_sha256=hashlib.sha256(source['registry'].read_bytes()).hexdigest(),
               evidence_kind='installed-declared-block-interface',action_performed=False,
               note='Pin directions/types come from declarations or native parameter tables. Implicit references are identified separately. Verify the selected controller/firmware profile and Build/Make before machine use.')
    return row
