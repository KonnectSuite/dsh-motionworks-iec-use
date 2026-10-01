"""Independent saved structural/source evidence for native IDE mutations."""
import hashlib
import re
from .project import Project
from .cfb import CompoundFile
from .tree import parse_document, task_assignments
from .tasks import read_tasks
from .program_checks import mask
from .workflow import source_manifest

def snapshot(root):
    project=Project(root)
    document=parse_document(CompoundFile(root/'src.st1').read_stream('PROJECT.TRE').decode('latin1'))
    if document.warnings:raise ValueError('Project tree parse warnings')
    registry={}
    for line in project.list_pou_lines():
        columns=line.split('\t')
        kind=columns[0].upper().replace('FUNCTIONBLOCK','FUNCTION_BLOCK')
        if kind not in ('PROGRAM','FUNCTION','FUNCTION_BLOCK') or len(columns)<3:raise ValueError('Unsupported POU registry row')
        if columns[1].casefold() in registry:raise ValueError('Duplicate POU registry row')
        registry[columns[1].casefold()]=(kind,columns[2])
    pous=[]
    for pou in project.pous():
        if pou.name.casefold() not in registry:raise ValueError('Unregistered POU directory')
        table=pou.declarations()
        if table.warnings:raise ValueError('Declaration parse warnings')
        body_stream=pou.body_stream()
        if not body_stream:raise ValueError('Missing POU body')
        body=pou.st_body() if body_stream[1]=='ST' else None
        raw=body.encode('utf-8') if body is not None else pou.source().read_stream(body_stream[0])
        variables=[dict(name=v.name,type=v.type_name,section=v.section,group=v.group,
                        address=v.address,initial_value=v.initial_value,description=v.description) for v in table.variables]
        kind,_=registry[pou.name.casefold()]
        parents=[node for node,_ in document.walk_with_ancestors()
                 if node.name.casefold()==pou.name.casefold() and
                 node.path.split('\t')[0].replace('\\','/').casefold()=='poe/'+pou.name.casefold()]
        if len(parents)!=1:raise ValueError('POU registry/tree identity mismatch')
        return_type=document.lines[parents[0].line+3].strip() if kind=='FUNCTION' else ''
        if kind=='FUNCTION' and not return_type:raise ValueError('Missing function return type in saved tree')
        pous.append(dict(name=pou.name,type=kind,return_type=return_type,language=body_stream[1],
                         body_sha256=hashlib.sha256(raw).hexdigest(),body_blank=body is not None and not body.strip(),
                         variables=variables,identifiers=sorted(set(re.findall(r'[A-Za-z_][A-Za-z_0-9]*',mask(body or '').upper()))),
                         reference_scan_complete=body is not None))
    if len(pous)!=len(registry):raise ValueError('Missing registered POU source')
    task_nodes=[]
    for node,_ in document.walk_with_ancestors():
        path=node.path.split('\t')[0].replace('\\','/').split('/')
        if len(path)==5 and path[0]=='C' and path[2]=='R' and path[-1]==node.name:
            fields=node.path.split('\t')
            instances=[]
            for child in node.children:
                program_type=document.lines[child.line+2].split('\t')[0]
                if not program_type:raise ValueError('Missing saved program type')
                instances.append(dict(name=child.name,type=program_type))
            task_nodes.append(dict(name=node.name,kind=fields[3],instances=instances))
    settings={t.name.casefold():t for t in read_tasks(root)}
    if len(settings)!=len(task_nodes):raise ValueError('Task settings/tree inventory mismatch')
    for task in task_nodes:
        setting=settings[task['name'].casefold()]
        if setting.warnings or setting.type!=task['kind']:raise ValueError('Task settings/tree disagree')
        task['settings']=setting.fields
    globals=project.global_variables()
    if globals.warnings:raise ValueError('Global declaration parse warnings')
    global_rows=[dict(name=v.name,type=v.type_name,section=v.section,group=v.group,
                      address=v.address,initial_value=v.initial_value,description=v.description) for v in globals.variables]
    manifest=source_manifest(root)
    program_sources={file:{name:sha for name,sha in streams.items() if name.upper().endswith(('.VB','.VGR','.STB','.GB','.TXT'))}
                     for file,streams in manifest['streams'].items()}
    file_hashes=dict(manifest['files'])
    for setting in settings.values():
        file_hashes[setting.source.relative_to(root).as_posix()]=hashlib.sha256(setting.source.read_bytes()).hexdigest()
    return dict(pous=pous,tasks=task_nodes,globals=global_rows,program_sources=program_sources,file_hashes=file_hashes)
