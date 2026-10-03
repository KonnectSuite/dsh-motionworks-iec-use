"""MotionWorks Use - file-level CODE engine.

WHY THIS EXISTS
---------------
The public plugin edits code through native ExecuteDdeCommand/ChangeCodeWS in
the IDE bridge. This engine independently reads saved source, declarations,
library interfaces and verification evidence. Legacy private format writers
remain only for regression coverage; they are retired public operations and
are not an alternative to native IDE editing.

PROTOCOL
--------
    python mw_code.py <verb> <request.json> <response.json>

Files rather than stdio: a confined harness cannot open named pipes, so a piped
child fails with EPERM. The response is written to a temp file and renamed into
place, and carries no BOM so the Node half can JSON.parse it.

SAFETY
------
* Session/stage provenance is checked before project access.
* Retired offline writes are not callable public editing tools.
* This module never downloads to a controller and never commands motion.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

# The engine lives in the sibling package; the caller passes its root so this
# file carries no hard-coded absolute path.
# The engine is VENDORED beside this file (code/engine/motionworks_iec_mcp), so the
# plugin is self-contained and does not depend on any other checkout. MW_SRC still
# overrides it, for developing against a different engine tree.
_SRC = os.environ.get("MW_SRC")
if not _SRC:
    _SRC = str(Path(__file__).resolve().parent / "engine")
if _SRC and _SRC not in sys.path:
    sys.path.insert(0, _SRC)


def _ok(**kw):
    return {"ok": True, **kw}


def _fail(message: str, **kw):
    return {"ok": False, "error": message, **kw}


def _project(root: str):
    from motionworks_iec_mcp import project as P

    return P.Project(root=Path(root))


def verb_worksheet_target(req):
    from motionworks_iec_mcp.navigation import worksheet_target
    return _ok(**worksheet_target(_project(req['project']), req['kind'], req.get('pou')))


def verb_graphical_listing(req):
    from motionworks_iec_mcp.graphical_listing import inspect
    return _ok(**inspect(_project(req['project']), req['pou'], req.get('start', 1), req.get('limit', 10)))


def verb_compiled_source_evidence(req):
    from motionworks_iec_mcp.graphical_listing import inspect
    return _ok(**inspect(_project(req['project']), req['pou'], source_only=True))


def verb_structure_snapshot(req):
    from motionworks_iec_mcp.structure import snapshot
    return _ok(**snapshot(Path(req['project'])))

def verb_block_interface(req):
    from motionworks_iec_mcp.block_interfaces import inspect
    return _ok(**inspect(Path(req['project']),req['native_libraries'],req.get('name'),req.get('library')))

def verb_installed_help(req):
    from motionworks_iec_mcp.installed_help import search
    return _ok(**search(req.get('module'),req.get('query',''),req.get('topic'),req.get('limit',5)))

# â”€â”€ read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def verb_pous(req):
    """List the POUs of a project directory, straight from its files."""
    proj = _project(req["project"])
    out = []
    for info in proj.pous():
        # NOTE: `name` is a dataclass FIELD on PouInfo, while language/st_body
        # are methods. Measured with inspect, not assumed.
        entry = {"name": info.name}
        try:
            entry["language"] = info.language()
        except Exception as exc:
            entry["language"] = None
            entry["language_error"] = str(exc)
        try:
            stream = info.body_stream()
            entry["body_stream"] = stream[0] if stream else None
            entry["stream_language"] = stream[1] if stream else None
            if stream:
                import hashlib
                body = info.st_body() if stream[1] == 'ST' else None
                raw = body.encode('utf-8') if body is not None else info.source().read_stream(stream[0])
                entry["body_sha256"] = hashlib.sha256(raw).hexdigest()
                # Native bodies can contain comment references whose actual text
                # is in Translation.xml. Keep the raw hash for conversion guards,
                # and expose a distinct hash of the exact readable ST/IL body.
                if stream[1] in ('ST', 'IL'):
                    try:
                        readable = info.text_body_text()
                        if readable is not None:
                            entry["text_body_sha256"] = hashlib.sha256(readable.encode('utf-8')).hexdigest()
                    except Exception as exc:
                        entry["text_body_error"] = str(exc)
        except Exception as exc:
            entry["body_error"] = str(exc)
        try:
            entry["has_st_body"] = info.st_body() is not None
        except Exception as exc:
            entry["has_st_body"] = None
        out.append(entry)
    return _ok(project=req["project"], count=len(out), pous=out)


def verb_read_st(req, text=False):
    """Read one POU: language, ST body text, and its variable declarations."""
    proj = _project(req["project"])
    info = proj.pou(req["pou"])
    body = None
    body_error = None
    try:
        body = info.text_body_text() if text else info.st_body_text()
    except Exception as exc:
        body_error = str(exc)

    variables = []
    try:
        # DeclarationTable exposes `.variables` (a flat list of Variable), plus
        # `warnings` and `source_stream`. It has NO `.blocks` â€” iterating that
        # silently produced an empty list, so callers could read a POU's body but
        # never its declarations.
        table = info.declarations()
        for v in getattr(table, "variables", []) or []:
            variables.append({
                "name": getattr(v, "name", None),
                "type": getattr(v, "type_name", None),
                "section": getattr(v, "section", None),
                "group": getattr(v, "group", None),
                "address": getattr(v, "address", None),
                "initial_value": getattr(v, "initial_value", None),
                "description": getattr(v, "description", None),
            })
    except Exception as exc:
        variables = [{"error": f"{type(exc).__name__}: {exc}"}]

    return _ok(
        pou=req["pou"],
        language=info.language() if hasattr(info, "language") else None,
        body=body,
        body_error=body_error,
        variables=variables,
        summary=info.summary() if hasattr(info, "summary") else None,
    )


def verb_unsupported(req):
    """Name the POUs whose bodies cannot be edited safely."""
    proj = _project(req["project"])
    blocked = []
    for info in proj.pous():
        try:
            if info.text_body() is None:
                stream = None
                try:
                    bs = info.body_stream()
                    stream = bs[0] if bs else None
                except Exception:
                    pass
                blocked.append({
                    "name": info.name,
                    "reason": "no supported ST/IL text body (graphical LD/FBD or compressed)",
                    "body_stream": stream,
                })
        except Exception as exc:
            blocked.append({"name": info.name, "reason": str(exc)})
    return _ok(blocked=blocked, count=len(blocked))


# â”€â”€ write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def verb_write_st(req):
    """Replace a POU's Structured Text body. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    from motionworks_iec_mcp.program_checks import check_project
    programming_review = check_project(root, pou=req["pou"], body=req["body"])
    plan = W.plan_st_body(root, req["pou"], req["body"], run_lint=bool(req.get("run_lint", True)))
    result = W.apply_st_body(plan, root, dry_run=dry)
    return _ok(dry_run=dry, result=_jsonable(result), programming_review=programming_review)


def verb_var_add(req):
    """Add a variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_add(
        root,
        req.get("pou"),
        req["name"],
        req["type"],
        section=req.get("section", "VAR"),
        address=req.get("address"),
        initial_value=req.get("initial_value"),
        description=req.get("description"),
        donor=req.get("donor"), donor_pou=req.get("donor_pou"),
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_var_add_many(req):
    """Declare many variables in one call, atomically by default.

    WHY THIS EXISTS: a port with twenty signals took twenty tool calls, and a caller declaring a
    twenty-field structure has to sequence them by hand. Every item here goes through exactly the
    per-item machinery verb_var_add uses - the same planner, the same donor matching, the same
    grid update - so this is a loop and not a second implementation.

    A failed write item raises with its index and name. The surrounding project transaction then
    restores every file, including earlier items in this batch. Explicit allow_partial=True keeps
    the old best-effort behavior, but still executes within one recoverable transaction.

    dry_run defaults to True, and is all-or-nothing in the other direction: a dry run plans every
    item and applies none, so the report shows what WOULD happen without changing the project.
    """
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    allow_partial = req.get("allow_partial", False) is True
    items = req.get("variables")
    if not isinstance(items, list) or not items:
        raise ValueError("variables must be a non-empty array of {name, type, ...} objects")

    pou = req.get("pou")
    applied: list[dict] = []
    failed: list[dict] = []

    for index, raw in enumerate(items):
        if not isinstance(raw, dict):
            if not dry and not allow_partial:
                raise ValueError(f"variable batch item [{index}] is not an object")
            failed.append({"index": index, "name": None,
                           "error": "not an object; expected {name, type, section, ...}"})
            continue
        # Per-item overrides fall back to the call-level values, so a caller declaring twenty
        # globals writes `pou` once and a caller mixing sections sets it on the items that differ.
        name = raw.get("name")
        type_name = raw.get("type")
        # CHECKED HERE, not left to the planner. Measured: an item with no `type` reached the donor
        # matcher and came back as `AttributeError: 'NoneType' object has no attribute 'casefold'`,
        # which names neither the item nor the field. A batch reports per item, so the message has
        # to be about the item.
        missing = [field for field, value in (("name", name), ("type", type_name)) if not value]
        if missing:
            if not dry and not allow_partial:
                raise ValueError(
                    f"variable batch item [{index}] {name or '(unnamed)'} missing required "
                    f"field(s): {', '.join(missing)}"
                )
            failed.append({"index": index, "name": name,
                           "error": f"missing required field(s): {', '.join(missing)}"})
            continue
        try:
            plan = W.plan_variable_add(
                root,
                raw.get("pou", pou),
                name,
                type_name,
                section=raw.get("section", req.get("section", "VAR")),
                address=raw.get("address"),
                initial_value=raw.get("initial_value"),
                description=raw.get("description"),
                donor=raw.get("donor", req.get("donor")),
                donor_pou=raw.get("donor_pou", req.get("donor_pou")),
            )
            if dry:
                applied.append({"index": index, "name": name, "planned": True,
                                **_plan_summary(plan)})
            else:
                result = _jsonable(W.apply_declaration(plan, root, dry_run=False))
                applied.append({"index": index, "name": name, "applied": True, "result": result})
        except Exception as exc:
            if not dry and not allow_partial:
                raise ValueError(
                    f"variable batch item [{index}] {name or '(unnamed)'} failed: "
                    f"{type(exc).__name__}: {exc}"
                ) from exc
            failed.append({"index": index, "name": name,
                           "error": f"{type(exc).__name__}: {exc}"})

    return _ok(
        dry_run=dry,
        pou=pou,
        requested=len(items),
        applied=len(applied),
        failed=len(failed),
        results=applied,
        failures=failed,
        note=("partial application was explicitly requested; read failures and re-issue only "
              "those items" if allow_partial else "write batches are atomic; any failure "
              "rolls back the whole batch"),
    )


def verb_var_edit(req):
    """Edit an existing variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_edit(
        root,
        req.get("pou"),
        req["name"],
        new_name=req.get("new_name"),
        type_name=req.get("type"),
        address=req.get("address"),
        initial_value=req.get("initial_value"),
        description=req.get("description"),
        clear_address=bool(req.get("clear_address", False)),
        force=bool(req.get("force", False)),
        donor=req.get("donor"),
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def verb_var_delete(req):
    """Delete a variable declaration. dry_run defaults to True."""
    from motionworks_iec_mcp import writer as W

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = W.plan_variable_delete(
        root, req.get("pou"), req["name"], force=bool(req.get("force", False))
    )
    return _ok(dry_run=dry, result=_jsonable(W.apply_declaration(plan, root, dry_run=dry)))


def _plan_summary(plan):
    """Flatten a planner's dataclass into JSON-friendly fields (no methods)."""
    out = {}
    for key, value in vars(plan).items():
        if callable(value):
            continue
        out[key] = _jsonable(value)
    return out


def _backup_dir(req, root: Path) -> Path:
    """Backups go beside the plugin, NOT inside the staging root.

    Writing into stage/ creates a directory that a naive "newest staged project"
    search can then mistake for a project, so the staging root is kept to
    projects only.
    """
    raw = req.get("backup_dir")
    from motionworks_iec_mcp.staging import workspace_root
    workspace = workspace_root()
    directory = Path(raw) if raw else workspace / ".motionworks" / "backups"
    if not directory.resolve().is_relative_to(workspace):
        raise ValueError("REFUSED: backups must remain inside the workspace")
    from uuid import uuid4
    directory = directory / uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    return directory


def verb_pou_create(req):
    """Create a new POU by cloning a template POU already in the project.

    ``template`` must be the name of an existing POU: creation clones that POU's
    directory and renames its streams, so there is no way to author a POU from
    nothing. dry_run defaults to True and returns the plan instead of applying it.
    """
    from motionworks_iec_mcp import pou_writer as PW

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = PW.plan_pou_creation(root, req["name"], req["template"])
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan))
    result = PW.apply_pou_creation(
        plan, backup_dir=_backup_dir(req, root), project_root=root
    )
    return _ok(dry_run=False, result=_jsonable(result))


def verb_pou_delete(req):
    """Delete a POU, its task assignments and its registry entries.

    The POU directory is moved to an archive rather than removed, so the deletion
    is recoverable. Refuses when another POU still calls it unless ``force`` is set.
    dry_run defaults to True and returns the plan instead of applying it.
    """
    from motionworks_iec_mcp import pou_writer as PW

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    plan = PW.plan_pou_deletion(root, req["name"], force=bool(req.get("force", False)))
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan))
    result = PW.apply_pou_deletion(plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_tasks(req):
    """List exact saved instance/type bindings and settings in native order."""
    from motionworks_iec_mcp.task_bindings import inspect
    root = Path(req["project"])
    report = inspect(root)
    duplicate_names=len({t['name'].casefold() for t in report['bindings']})!=len(report['bindings'])
    assignments={t['path'] if duplicate_names else t['name']:[x['name'] for x in t['instances']] for t in report['bindings']}
    return _ok(
        project=str(root),
        tasks={k: list(v) for k, v in assignments.items()},
        task_count=len(assignments),
        unassigned=report['unassigned'],bindings=report['bindings'],
        binding_resolution=report['binding_resolution'],source_hashes=report['source_hashes'],
        unassigned_note=(
            "PROGRAM types without direct saved task instances; instance names are resolved to their types. "
            "Indirect calls and current unsaved IDE state still require inspection. This does not prove runtime execution."
        ),
        next_step="Compare mw_code_task_model for the live IDE state. Use mw_ide_task_change for authorized native assignment/settings changes; then verify saved bindings and fresh Build/Make.",
    )


def verb_assign(req):
    """Assign a POU to a task. dry_run defaults to True.

    Without this, a created POU is inert: it is not called by anything, so it never
    executes and the compiler does not check it.
    """
    from motionworks_iec_mcp.cfb import CompoundFile
    from motionworks_iec_mcp.tree import parse_document
    from motionworks_iec_mcp.tree_writer import apply_assignment, plan_assign

    root = Path(req["project"])
    src = root / "src.st1"
    dry = bool(req.get("dry_run", True))
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    kwargs = {}
    if req.get("cycle"):
        kwargs["cycle"] = str(req["cycle"])
    if req.get("controller"):
        kwargs["controller"] = str(req["controller"])
    plan = plan_assign(document, str(req["task"]), str(req["pou"]), **kwargs)
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan), summary=plan.summary())
    result = apply_assignment(src, root, plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_unassign(req):
    """Remove a POU's assignment from a task. dry_run defaults to True."""
    from motionworks_iec_mcp.cfb import CompoundFile
    from motionworks_iec_mcp.tree import parse_document
    from motionworks_iec_mcp.tree_writer import apply_assignment, plan_unassign

    root = Path(req["project"])
    src = root / "src.st1"
    dry = bool(req.get("dry_run", True))
    document = parse_document(
        CompoundFile(src).read_stream("PROJECT.TRE").decode("latin1")
    )
    plan = plan_unassign(document, str(req["task"]), str(req["pou"]))
    if dry:
        return _ok(dry_run=True, plan=_plan_summary(plan), summary=plan.summary())
    result = apply_assignment(src, root, plan, backup_dir=_backup_dir(req, root))
    return _ok(dry_run=False, result=_jsonable(result))


def verb_globals(req):
    """List the project's VAR_GLOBAL declarations.

    The automation API exposes NO project-level variable collection - measured:
    project.Variables, project.Globals and project.VariableGroups are all absent or
    empty - so the live variable model cannot show globals even though it reads
    POU-scoped declarations well. Without this an agent can ADD a global and never see
    it again, and cannot discover the tags several POUs share.
    """
    proj = _project(req["project"])
    table = proj.global_variables()
    out = []
    for v in getattr(table, "variables", []) or []:
        out.append({
            "name": getattr(v, "name", None),
            "type": getattr(v, "type_name", None),
            "section": getattr(v, "section", None),
            "group": getattr(v, "group", None),
            "address": getattr(v, "address", None),
            "initial_value": getattr(v, "initial_value", None),
            "description": getattr(v, "description", None),
        })
    warnings = list(getattr(table, "warnings", []) or [])
    return _ok(
        project=str(req["project"]),
        count=len(out),
        variables=out,
        source_stream=getattr(table, "source_stream", None),
        warnings=warnings,
    )


def verb_ide_closed(req):
    """Report whether the IDE gate would let a write through."""
    from motionworks_iec_mcp import ide as I

    running = None
    for attr in ("motionworks_running", "is_motionworks_running"):
        fn = getattr(I, attr, None)
        if callable(fn):
            try:
                running = bool(fn())
                break
            except Exception:
                pass
    return _ok(running=running, helper_names=[n for n in dir(I) if not n.startswith("_")][:40])


def verb_types(request):
    """Read the project's user-defined data types, or one of them in full.

    Nothing else in this plugin could see a UDT, so an agent editing a POU that declares
    ``CamData : CamSegmentStruct`` had no way to learn what a CamSegmentStruct contains.
    The definitions are plain text in DT/Tyllist.typ, parsed by motionworks_iec_mcp
    .datatypes, whose module docstring records the field layout and how it was measured.

    Returns through ``_ok`` like every other verb: the Node side rejects a response whose
    ``ok`` is not true, so a bare dict here fails as "code engine failed 'types'" with no
    message, which is what happened the first time this verb was wired up.
    """
    from motionworks_iec_mcp import datatypes as DT

    project = Path(request["project"])
    name = request.get("name")
    if name:
        t = DT.find_type(project, str(name))
        return _ok(
            project=str(project),
            name=t.name,
            kind=t.kind,
            type_id=t.type_id,
            container=t.container,
            declared_members=t.declared_members,
            element_type=t.element_type,
            members=[
                {"name": m.name, "type": m.type_name, "type_id": m.type_id,
                 "array_size": m.array_size}
                for m in t.members
            ],
        )

    types, counts = DT.read_types(project)
    return _ok(
        project=str(project),
        defined=len(types),
        header_counts=counts,
        types=[
            {"name": t.name, "kind": t.kind, "type_id": t.type_id,
             "container": t.container, "members": len(t.members),
             "declared_members": t.declared_members, "element_type": t.element_type}
            for t in sorted(types, key=lambda x: (x.container, x.name))
        ],
    )


def verb_library(request):
    """Read the library side: which blocks the project uses, and what one offers.

    Two questions, two sources. ``eCLRPouDependencies.dat`` is a plain-text manifest naming
    every POU and library block with its kind and what it calls, so "what does this POU use"
    needs no binary at all. A block's own members come from its compiled assembly, which is
    a real .NET assembly (BSJB, v4.0.30319) whose identifiers sit in the metadata #Strings
    heap.

    WHAT THE MEMBER LIST IS NOT: it does not record input/output DIRECTION. Execute and Done
    are distinguishable by convention, not by anything in the heap, and this does not guess.
    Use the native block definition or matching versioned reference to establish direction.
    """
    from motionworks_iec_mcp import libraries as L

    project = Path(request["project"])
    name = request.get("name")
    if name:
        m = L.read_block_members(project, str(name))
        return _ok(
            project=str(project),
            name=m.name,
            assembly=m.assembly,
            runtime=m.runtime,
            identifiers=m.identifiers,
            filtered_out=m.filtered_out,
            note=(
                "these are the identifiers the assembly defines; input/output DIRECTION is "
                "not recorded in them, so inspect the native function-block definition or matching versioned manual "
                "(mw_code_reference) to tell an input from an output; caller declarations alone do not establish direction"
            ),
        )

    blocks = L.read_dependencies(project)
    return _ok(
        project=str(project),
        count=len(blocks),
        blocks=[
            {"index": b.index, "name": b.name, "kind": b.kind,
             "library": b.is_library, "depends_on": b.depends_on}
            for b in blocks
        ],
    )


def verb_manual(request):
    """Search installed PDFs and the versioned vendor-reference catalog together."""
    from motionworks_iec_mcp import manuals as M, knowledge as K
    name, term = request.get('name'), request.get('term')
    limit = max(1, min(int(request.get('limit', 5)), 10))
    if not term:
        try: listed = M.list_manuals()
        except Exception: listed = []
        try: topics = M.help_topics()
        except Exception: topics = []
        return _ok(manuals=[{'name': m.name, 'path': str(m.path), 'bytes': m.bytes,
                            'readable': m.readable, 'note': m.note, 'revision': 'not_verified'} for m in listed],
                   help_topics=topics, references=K.search(),
                   note='Use mw_code_reference for reviewed revisions/page citations and mw_code_installed_help for actual installed CHM topic text; this list contains archive names only.')
    try:
        results = M.search(str(term), name=str(name) if name else None, limit=limit)
        for result in results:
            result.update(extraction='legacy_heuristic', revision='not_verified', page_citations_available=False)
    except Exception as exc:
        results = [{'manual': 'installed PDFs', 'hits': 0, 'error': str(exc)}]
    references = K.search(str(term), limit=limit)
    return _ok(term=str(term), found=sum(bool(r.get('hits')) for r in results), results=results,
               references=references, note='Legacy extracted text may be imperfect. Prefer reviewed reference citations and the actual installed FB interface.')



def verb_restore_pou(req):
    """Put a POU back from a snapshot. dry_run defaults to True.

    Added because mw_ide_build now DETECTS a destroyed POU and says to restore it, and there was no
    way to do that. A diagnosis with no remedy is half a fix.
    """
    from motionworks_iec_mcp import restore as R

    root = Path(req["project"])
    dry = bool(req.get("dry_run", True))
    # pou is OPTIONAL: omitting it asks what is restorable rather than naming one. Reading it
    # with [] raised KeyError before the guard below could run - the guard was right and the
    # access above it was wrong, which is the pair written the wrong way round.
    pou = req.get("pou")
    which = int(req.get("which", 0) or 0)

    if not pou:
        # No POU named: report what is restorable and what looks damaged, so a caller that only
        # knows something is wrong can find out what.
        return _ok(dry_run=dry, result=R.list_restorable(root))

    report = R.restore_pou(root, pou, which=which, dry_run=dry)
    return _ok(dry_run=dry, result=_jsonable(report))

def verb_bind_mwt(req):
    """Rewrite the staged .mwt so the path inside it is the staged directory.

    The wrapper is a pointer. Left alone, opening it loads whatever directory
    was stored in it — measured as a project outside the workspace. This only
    accepts paths already inside the staging root.
    """
    from motionworks_iec_mcp.mwt_bind import retarget
    from motionworks_iec_mcp.staging import assert_staged

    mwt = assert_staged(req["mwt"], what="mwt wrapper")
    directory = assert_staged(req["directory"], what="staged directory")
    return _ok(**retarget(mwt, directory))


def verb_check_mwt(req):
    """Reject a wrapper that would open a different project before COM sees it."""
    from motionworks_iec_mcp.mwt_bind import embedded_paths
    from motionworks_iec_mcp.staging import assert_proven
    mwt = assert_proven(req["project"])
    if mwt.suffix.lower() != ".mwt":
        raise ValueError("open requires a .mwt wrapper")
    directory = mwt.with_suffix("").resolve()
    paths = embedded_paths(mwt)
    # Some valid wrappers carry no absolute path and let the IDE open the
    # sibling expanded directory. Staging recorded this exact pair, and the
    # caller checks the IDE's active project after opening. Reject only a
    # concrete embedded path that points elsewhere.
    if paths and any(Path(p).resolve() != directory for p in paths):
        raise ValueError("REFUSED: wrapper is not bound to the staged workspace project; stage it again.")
    import hashlib
    return _ok(bound_to=str(directory), wrapper_sha256=hashlib.sha256(mwt.read_bytes()).hexdigest())


#: Reads that may look at a project outside the staging root when the caller
#: sets reference=true. Everything else still has to be a staged copy.
READ_VERBS = frozenset({
    "worksheet_target",
    "structure_snapshot", "block_interface",
    "pous", "read_st", "read_text", "unsupported", "globals", "tasks", "types", "library",
})

def verb_sync_back(req):
    """Copy the staged edit back to the real project it was staged from. dry_run defaults to True.

    WHY THIS EXISTS: the release loop is close IDE -> edit the stage -> build -> copy back ->
    re-stage -> verify, and every step was a tool except the copy back, which had to be a script
    that knew by convention what to carry. The convention belongs here, next to the staging guard
    that already knows what a staged copy is.

    WHAT IT CARRIES
      * the project tree, minus the .mwt WRAPPER - whose stored path is bound to the stage, so
        copying it to the real project would point the real project at a temp copy of itself;
      * the source project's own .mwt is NOT this function's business and is left byte-for-byte
        alone;
      * build outputs and caches are skipped, so a copy back does not drag the IDE's scratch state
        over a project the IDE will open again.

    WHAT IT REFUSES
      * a staged copy with no recorded source (identity file), because there is nowhere to copy to;
      * a destination outside the staging root's recorded workspace, via the same assert_staged
        gate every other verb passes through;
      * a destination that is itself a staged copy, which would be a copy stage-to-stage and
        almost certainly not what was meant.

    Verified by hash, not by the copy call returning: the report lists the files that landed and
    the ones whose digest differs afterwards, so "synced" is an observation rather than an intent.
    """
    import hashlib

    from motionworks_iec_mcp.staging import assert_proven, assert_staged

    staged = assert_staged(req["project"], what="staged project")
    # assert_proven is the gate that makes the identity file safe to read: it proves the copy was
    # staged from this workspace and that source, wrapper and directory all agree. Reading the
    # identity file without it would trust a file this engine did not necessarily write.
    assert_proven(staged)
    dry = bool(req.get("dry_run", True))

    # The identity file sits beside the staged project and records where the copy came from.
    # Without it there is no destination to guess at, and guessing is how a copy back writes into
    # the wrong project.
    identity_path = staged.parent / f"{staged.name}.identity.json"
    if not identity_path.exists():
        alt = staged.with_suffix(".identity.json")
        identity_path = alt if alt.exists() else identity_path
    if not identity_path.exists():
        raise ValueError(
            f"REFUSED: no identity file beside the staged project ({identity_path.name}). "
            "sync_back needs the recorded source directory, and there is no safe way to guess it."
        )
    identity = json.loads(identity_path.read_text(encoding="utf-8-sig"))
    source_dir = identity.get("source_directory") or identity.get("source")
    if not source_dir:
        raise ValueError(
            f"REFUSED: {identity_path.name} records no source_directory, so there is nowhere to "
            "copy back to."
        )
    destination = Path(source_dir).resolve()

    if destination == staged.resolve():
        raise ValueError("REFUSED: the recorded source is the staged copy itself.")

    # THE PROTECTION THAT MATTERS, and it is NOT the staging guard.
    #
    # Every other verb refuses to touch anything under stage/, because a real project tree holds
    # the owner's work and a mistake there is not recoverable. sync_back is the one verb whose
    # PURPOSE is to write the real tree - a copy back that only wrote the stage would be a no-op
    # - so assert_staged would make it impossible rather than safe, which is what it did when this
    # was first written.
    #
    # The safety comes from the identity file instead, and it is narrower than the guard: the
    # source must be a path mw_ide_stage itself recorded, and it must lie inside the workspace
    # that recording names. That is provenance, not a pattern match on a path, and it is the same
    # evidence assert_proven already checks on the staged side.
    workspace = Path(identity.get("workspace") or "").resolve() if identity.get("workspace") else None
    if workspace is None:
        raise ValueError(
            f"REFUSED: {identity_path.name} records no workspace, so the recorded source cannot "
            "be proven to lie inside the workspace this engine is allowed to write."
        )
    try:
        destination.relative_to(workspace)
    except ValueError:
        raise ValueError(
            f"REFUSED: the recorded source '{destination}' lies outside the recorded workspace "
            f"'{workspace}'. sync_back writes only a project this staging was taken from."
        ) from None
    # Writing the stage again is a no-op the caller did not ask for, and a destination inside
    # stage/ would mean the identity file named the stage as its own source.
    from motionworks_iec_mcp.staging import is_staged
    if is_staged(destination):
        raise ValueError(
            f"REFUSED: the recorded source '{destination}' is itself inside the staging root. "
            "There is nothing to copy back to - stage the project again from the real one."
        )

    if not destination.exists():
        raise ValueError(f"REFUSED: the recorded source directory does not exist: {destination}")

    # WHAT IS CARRIED, and why it is a list of SOURCE roles rather than a list of exclusions.
    #
    # Measured on the real project: a naive "everything that changed" copy back selected 90 files,
    # and the first eight were `__1stResourceEx.DLL`, `__BG.DLL`, `__FastTsk.pdb` and so on - the
    # compiler's own output, which the IDe regenerates and which this engine never edits. Carrying
    # those back over a project the IDE will open again is the "broad sync" a session had to do by
    # hand, and it was the likely cause of the build failure that followed.
    #
    # So the rule is: copy back the files this engine can WRITE, and only those. A blanket copy
    # cannot be made safe by lengthening an exclusion list, because the next build output the IDE
    # invents is not on it; an inclusion list fails safe instead, since an unlisted new artifact is
    # simply not carried.
    SOURCE_SUFFIXES = (
        ".st1",   # a POU container: the .VB declarations, .VGR grid and body streams inside it
        ".vb",    # a bare declaration stream, for a project that stores them separately
        ".vgr",   # a bare grid, likewise
        ".tre",   # the project tree
        ".pou",   # the POU registry
        ".typ",   # the data-type list
        ".xml",   # NodeProperties and the library manifest
        ".dat",   # the dependency manifest
        ".txt",   # the POU's textual sidecars
        ".st",    # an exported source, when one is kept in the tree
        ".set",   # task settings
        ".ldi",
    )
    #: Names that are project state rather than source, even though they match a suffix above.
    SOURCE_NAMES = {"list.pou", "project.tre", "nodes.lst", "tyllist.typ", "eclrpoudependencies.dat"}
    SKIP_DIRS = {"__pycache__", ".git", "node_modules", "backups", ".motionworks"}

    def carry_reason(name: str) -> str | None:
        """None to carry the file, or the reason it is not source."""
        low = name.lower()
        if low.endswith(".mwt"):
            # THE WRAPPER IS NEVER CARRIED. Its stored path names the stage, so copying it would
            # bind the real project to a temporary copy of itself - the exact failure the staging
            # guard exists to prevent, and the one thing the hand-written script also had to know.
            return "the .mwt wrapper stays bound to the stage"
        if low.startswith("tmp.") or low.endswith((".tmp", ".sto", ".log", ".cache")):
            return "scratch or log"
        if low.endswith((".dll", ".pdb", ".exe", ".obj", ".o", ".lib", ".exp", ".ilk")):
            return "compiler output, not source"
        if low in SOURCE_NAMES:
            return None
        if low.endswith(SOURCE_SUFFIXES):
            return None
        return "not a file this engine writes"

    copied: list[dict] = []
    skipped: list[dict] = []
    mismatched: list[dict] = []

    for path in sorted(staged.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(staged)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        reason = carry_reason(path.name)
        if reason is not None:
            skipped.append({"file": str(rel), "reason": reason})
            continue
        target = destination / rel
        record = {
            "file": str(rel),
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        if target.exists():
            current = hashlib.sha256(target.read_bytes()).hexdigest()
            if current == record["sha256"]:
                skipped.append({"file": str(rel), "reason": "already identical"})
                continue
            record["previous_sha256"] = current
        copied.append(record)

    if dry:
        return _ok(
            dry_run=True,
            staged=str(staged),
            destination=str(destination),
            would_copy=len(copied),
            would_skip=len(skipped),
            files=copied,
            skipped=skipped,
            note="nothing was written; pass dry_run=false to apply",
        )

    for record in copied:
        source = staged / record["file"]
        target = destination / record["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        # VERIFIED, not assumed: re-read the file that landed and compare digests.
        landed = hashlib.sha256(target.read_bytes()).hexdigest()
        if landed != record["sha256"]:
            mismatched.append({"file": record["file"], "expected": record["sha256"], "got": landed})
        record["verified"] = landed == record["sha256"]

    return _ok(
        dry_run=False,
        staged=str(staged),
        destination=str(destination),
        copied=len(copied),
        skipped=len(skipped),
        mismatched=len(mismatched),
        files=copied,
        failures=mismatched,
        wrapper="not carried - the .mwt stays bound to the stage",
        note=(
            "files are verified by sha256 after the copy; a non-empty `failures` means the copy "
            "did not land and the release is not synced"
        ),
    )


def verb_wrapper_binding(req):
    """Read-only: how each staged project's .mwt wrapper is bound, and whether it is stale.

    WHY THIS EXISTS: mw_ide_open refuses a wrapper whose stored path is not the staged directory,
    and the refusal was reached in a session where the PROJECT had just been renumbered by a POU
    creation. Re-staging to clear it is worse than the problem - it overwrites the stage and takes
    the new POU with it - so the useful answer is "which wrapper is stale, and is re-binding it
    enough", reported before anything tries to open it.

    Reports every staged project, so a caller does not have to know which one is at fault.
    """
    from motionworks_iec_mcp.mwt_bind import embedded_paths
    from motionworks_iec_mcp.staging import staging_root

    binding: list[dict] = []
    targets = []
    if req.get("project"):
        from motionworks_iec_mcp.staging import assert_staged
        targets.append(assert_staged(req["project"], what="project"))
    else:
        targets = [p for p in sorted(staging_root().glob("*.mwt"))]

    for mwt in targets:
        if mwt.suffix.lower() != ".mwt":
            continue
        directory = mwt.with_suffix("")
        try:
            paths = embedded_paths(mwt)
        except Exception as exc:
            binding.append({"wrapper": str(mwt), "error": f"{type(exc).__name__}: {exc}"})
            continue
        stale = [p for p in paths if Path(p).resolve() != directory.resolve()]
        binding.append({
            "wrapper": str(mwt),
            "should_name": str(directory),
            "stores": paths,
            "bound": not stale,
            "binding_mode": "embedded_path" if paths else "native_sibling_directory",
            "stale_paths": stale,
            "note": (
                "native sibling-directory wrapper; verify the IDE active project after opening" if not paths
                else ("re-binding is enough: mw_ide_stage would overwrite the staged project and "
                      "take any POU created since with it" if stale else "")
            ),
        })

    return _ok(
        count=len(binding),
        wrappers=binding,
        stale=sum(1 for b in binding if b.get("stale_paths")),
    )


def verb_rebind_wrapper(req):
    """Point a staged .mwt back at its staged directory, in place. dry_run defaults to True.

    Idempotent and cheap when already bound - measured: an already-bound wrapper returns
    changed=false and the file digest is unchanged, so a caller may call this unconditionally
    rather than working out whether it needs to.
    """
    from motionworks_iec_mcp.mwt_bind import embedded_paths, retarget
    from motionworks_iec_mcp.staging import assert_staged

    mwt = assert_staged(req["mwt"], what="mwt wrapper")
    if mwt.suffix.lower() != ".mwt":
        raise ValueError("rebind_wrapper needs a .mwt wrapper")
    directory = assert_staged(req["directory"] if req.get("directory") else mwt.with_suffix(""),
                              what="staged directory")
    dry = bool(req.get("dry_run", True))

    if dry:
        paths = embedded_paths(mwt)
        stale = [p for p in paths if Path(p).resolve() != directory.resolve()]
        return _ok(
            dry_run=True,
            would_change=bool(stale),
            bound_to=str(directory),
            stores=paths,
            stale_paths=stale,
            note="nothing was written; pass dry_run=false to re-bind",
        )
    return _ok(dry_run=False, **retarget(mwt, directory))


def verb_eip_map(req):
    """Summarize the EtherNet/IP assembly map: declared size, words used, words left.

    Answers "is there room for another status value?" - the question that comes up every time a
    diagnostic is added - from the two sources that hold the two halves of the answer: the L5X
    module definition for the declared size, the project's IEC addresses for what is used.
    """
    from motionworks_iec_mcp import eip as E

    return _ok(result=E.build_map(
        project_root=req.get("project"),
        l5x=req.get("l5x"),
        module_name=req.get("module_name"),
    ))


def verb_validate(req):
    from motionworks_iec_mcp.validation import validate
    return _ok(result=validate(req['project']))


def verb_reference(req):
    from motionworks_iec_mcp import knowledge as K
    if req.get('block'):
        result = K.signature(req['block'])
        return _ok(result={'block': req['block'], 'signature': result,
                          'note': 'No reviewed signature found; inspect the installed FB definition.' if result is None else 'Historical vendor interface; confirm installed version.'})
    return _ok(result=K.search(req.get('query', ''), source_id=req.get('source_id'), limit=req.get('limit', 5)))


def verb_reference_sync(req):
    from motionworks_iec_mcp.knowledge import sync
    return _ok(result=sync(req.get('source_ids')))


def verb_diagnose(req):
    from motionworks_iec_mcp.knowledge import diagnose
    return _ok(result=diagnose(req['message']))


def verb_pattern(req):
    from motionworks_iec_mcp.knowledge import patterns
    return _ok(result=patterns(req.get('name')))


def verb_check_program(req):
    from motionworks_iec_mcp.program_checks import check_project
    if 'body' in req and not req.get('pou'):
        raise ValueError('A proposed body requires a target POU')
    return _ok(result=check_project(req['project'], pou=req.get('pou'), body=req.get('body'), native_libraries=req.get('native_libraries'), interface_libraries=req.get('interface_libraries')))


VERBS = {
    "workflow_check": lambda req: _ok(**__import__("motionworks_iec_mcp.workflow", fromlist=["check"]).check(req["project"])),
    "source_manifest": lambda req: _ok(**__import__("motionworks_iec_mcp.workflow", fromlist=["source_manifest"]).source_manifest(Path(req["project"]))),
    "reference": verb_reference,
    "reference_sync": verb_reference_sync,
    "diagnose": verb_diagnose,
    "pattern": verb_pattern,
    "check_program": verb_check_program,
    "validate": verb_validate,
    "check_mwt": verb_check_mwt,
    "eip_map": verb_eip_map,
    "types": verb_types,
    "manual": verb_manual,
    "library": verb_library,
    "pous": verb_pous,
    "read_st": verb_read_st,
    "read_text": lambda req: verb_read_st(req, text=True),
    "worksheet_target": verb_worksheet_target,
    "graphical_listing": verb_graphical_listing,
    "compiled_source_evidence": verb_compiled_source_evidence,
    "structure_snapshot": verb_structure_snapshot,
    "block_interface": verb_block_interface,
    "installed_help": verb_installed_help,
    "unsupported": verb_unsupported,
    "write_st": verb_write_st,
    "var_add": verb_var_add,
    "var_add_many": verb_var_add_many,
    "sync_back": verb_sync_back,
    "wrapper_binding": verb_wrapper_binding,
    "rebind_wrapper": verb_rebind_wrapper,
    "restore_pou": verb_restore_pou,
    "var_edit": verb_var_edit,
    "var_delete": verb_var_delete,
    "pou_create": verb_pou_create,
    "pou_delete": verb_pou_delete,
    "globals": verb_globals,
    "tasks": verb_tasks,
    "assign": verb_assign,
    "unassign": verb_unassign,
    "ide_closed": verb_ide_closed,
    "bind_mwt": verb_bind_mwt,
}


def _jsonable(value):
    """Best-effort conversion of engine results into JSON-friendly data."""
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        pass
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "__dict__"):
        return {str(k): _jsonable(v) for k, v in vars(value).items()}
    return str(value)


def main(argv):
    if len(argv) != 4:
        print("usage: mw_code.py <verb> <request.json> <response.json>", file=sys.stderr)
        return 2
    verb, req_path, res_path = argv[1], argv[2], argv[3]
    res = Path(res_path)

    try:
        req = json.loads(Path(req_path).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _write(res, _fail(f"could not read request: {exc}"))
        return 1

    handler = VERBS.get(verb)
    if handler is None:
        _write(res, _fail(f"unknown verb {verb!r}", allowed=sorted(VERBS)))
        return 1

    # THE STAGING GUARD, at the one point every verb passes through.
    #
    # index.js refuses a project outside the staging root, but that only covers the plugin's TOOLS.
    # Measured: the workspace holds 25-odd scripts the agent wrote for itself, and they call this
    # engine directly - Tools/_mw_call.py, Tools/_mw_call2.py, Tools/_real_state.py and the rest -
    # so the agent routed around the tool-level guard by not using the tools, and the owner reported
    # a third time that a project outside the workspace had been opened.
    #
    # Guarding here catches all of them, because every one of them comes through this dispatch. It
    # is also the honest place for it: this engine is what writes the files.
    #
    # A request with no `project` is not refused. That is not a hole - the verbs without one do not
    # touch a project tree - and refusing them would mean a caller could not ask a question like
    # "which POUs exist" without first proving where it stands.
    try:
        from engine.motionworks_iec_mcp.staging import StagingRefused, assert_staged
    except ImportError:  # running from a checkout where the engine is a sibling package
        try:
            from motionworks_iec_mcp.staging import StagingRefused, assert_staged
        except ImportError:
            assert_staged = None
    if req.get("reference") is True and verb not in READ_VERBS:
        _write(res, _fail(
            f"REFUSED: '{verb}' cannot use reference mode. Reference is read-only. "
            "A project outside the workspace can be inspected, and it is never "
            "staged, opened, or edited.",
            refused_by="reference guard",
            verb=verb,
        ))
        return 1

    reference_read = req.get("reference") is True and verb in READ_VERBS
    if assert_staged is not None and req.get("project") and not reference_read:
        try:
            assert_staged(req["project"], what=f"{verb} project")
            try:
                from engine.motionworks_iec_mcp.staging import assert_proven
            except ImportError:
                from motionworks_iec_mcp.staging import assert_proven
            if verb != "workflow_check":
                assert_proven(req["project"])
        except StagingRefused as exc:
            _write(res, _fail(str(exc), refused_by="staging guard", verb=verb))
            return 1

    try:
        if verb in {"write_st", "var_add", "var_add_many", "var_edit", "var_delete", "pou_create", "pou_delete", "restore_pou"} and req.get("dry_run", True) is False:
            from motionworks_iec_mcp.transaction import run
            payload = run(Path(req["project"]), lambda: handler(req))
        else:
            payload = handler(req)
        if reference_read and isinstance(payload, dict):
            payload = dict(payload)
            payload["read_only"] = True
            workspace = req.get("workspace")
            outside = None
            if workspace and req.get("project"):
                try:
                    Path(req["project"]).resolve().relative_to(Path(workspace).resolve())
                    outside = False
                except ValueError:
                    outside = True
            payload["outside_workspace"] = outside
        _write(res, payload)
        return 0
    except Exception as exc:
        _write(res, _fail(
            f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc().splitlines()[-6:],
        ))
        return 1


def _write(path: Path, payload) -> None:
    """Write without a BOM, via a temp file, so a reader never sees a partial file."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
